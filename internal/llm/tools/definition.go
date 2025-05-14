package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sst/opencode/internal/lsp"
	"github.com/sst/opencode/internal/lsp/protocol"
)

type DefinitionParams struct {
	FilePath string `json:"file_path"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

type definitionTool struct {
	lspClients map[string]*lsp.Client
}

const (
	DefinitionToolName    = "definition"
	definitionDescription = `Find the definition of a symbol at a specific position in a file.
WHEN TO USE THIS TOOL:
- Use when you need to find where a symbol is defined
- Helpful for understanding code structure and relationships
- Great for navigating between implementation and interface

HOW TO USE:
- Provide the path to the file containing the symbol
- Specify the line number (1-based) where the symbol appears
- Specify the column number (1-based) where the symbol appears
- Results show the location of the symbol's definition

FEATURES:
- Finds definitions across files in the project
- Works with variables, functions, classes, interfaces, etc.
- Returns file path, line, and column of the definition

LIMITATIONS:
- Requires a functioning LSP server for the file type
- May not work for all symbols depending on LSP capabilities
- Results depend on the accuracy of the LSP server

TIPS:
- Use in conjunction with References tool to understand usage
- Combine with View tool to examine the definition
`
)

func NewDefinitionTool(lspClients map[string]*lsp.Client) BaseTool {
	return &definitionTool{
		lspClients,
	}
}

func (b *definitionTool) Info() ToolInfo {
	return ToolInfo{
		Name:        DefinitionToolName,
		Description: definitionDescription,
		Parameters: map[string]any{
			"file_path": map[string]any{
				"type":        "string",
				"description": "The path to the file containing the symbol",
			},
			"line": map[string]any{
				"type":        "integer",
				"description": "The line number (1-based) where the symbol appears",
			},
			"column": map[string]any{
				"type":        "integer",
				"description": "The column number (1-based) where the symbol appears",
			},
		},
		Required: []string{"file_path", "line", "column"},
	}
}

func (b *definitionTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	var params DefinitionParams
	if err := json.Unmarshal([]byte(call.Input), &params); err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error parsing parameters: %s", err)), nil
	}

	lsps := b.lspClients

	if len(lsps) == 0 {
		return NewTextResponse("\nLSP clients are still initializing. Definition lookup will be available once they're ready.\n"), nil
	}

	// Ensure file is open in LSP
	notifyLspOpenFile(ctx, params.FilePath, lsps)

	// Convert 1-based line/column to 0-based for LSP protocol
	line := max(0, params.Line-1)
	column := max(0, params.Column-1)

	output := getDefinition(ctx, params.FilePath, line, column, lsps)

	return NewTextResponse(output), nil
}

func getDefinition(ctx context.Context, filePath string, line, column int, lsps map[string]*lsp.Client) string {
	var results []string

	slog.Debug(fmt.Sprintf("Looking for definition in %s at line %d, column %d", filePath, line+1, column+1))
	slog.Debug(fmt.Sprintf("Available LSP clients: %v", getClientNames(lsps)))

	for lspName, client := range lsps {
		slog.Debug(fmt.Sprintf("Trying LSP client: %s", lspName))
		// Create definition params
		uri := fmt.Sprintf("file://%s", filePath)
		definitionParams := protocol.DefinitionParams{
			TextDocumentPositionParams: protocol.TextDocumentPositionParams{
				TextDocument: protocol.TextDocumentIdentifier{
					URI: protocol.DocumentUri(uri),
				},
				Position: protocol.Position{
					Line:      uint32(line),
					Character: uint32(column),
				},
			},
		}
		slog.Debug(fmt.Sprintf("Sending definition request with params: %+v", definitionParams))

		// Get definition
		definition, err := client.Definition(ctx, definitionParams)
		if err != nil {
			slog.Debug(fmt.Sprintf("Error from %s: %s", lspName, err))
			results = append(results, fmt.Sprintf("Error from %s: %s", lspName, err))
			continue
		}
		slog.Debug(fmt.Sprintf("Got definition result type: %T", definition.Value))

		// Process the definition result
		locations := processDefinitionResult(definition)
		slog.Debug(fmt.Sprintf("Processed locations count: %d", len(locations)))
		if len(locations) == 0 {
			results = append(results, fmt.Sprintf("No definition found by %s", lspName))
			continue
		}

		// Format the locations
		for _, loc := range locations {
			path := strings.TrimPrefix(string(loc.URI), "file://")
			// Convert 0-based line/column to 1-based for display
			defLine := loc.Range.Start.Line + 1
			defColumn := loc.Range.Start.Character + 1
			slog.Debug(fmt.Sprintf("Found definition at %s:%d:%d", path, defLine, defColumn))
			results = append(results, fmt.Sprintf("Definition found by %s: %s:%d:%d", lspName, path, defLine, defColumn))
		}
	}

	if len(results) == 0 {
		return "No definition found for the symbol at the specified position."
	}

	return strings.Join(results, "\n")
}

func processDefinitionResult(result protocol.Or_Result_textDocument_definition) []protocol.Location {
	var locations []protocol.Location

	switch v := result.Value.(type) {
	case protocol.Location:
		locations = append(locations, v)
	case []protocol.Location:
		locations = append(locations, v...)
	case []protocol.DefinitionLink:
		for _, link := range v {
			locations = append(locations, protocol.Location{
				URI:   link.TargetURI,
				Range: link.TargetRange,
			})
		}
	case protocol.Or_Definition:
		switch d := v.Value.(type) {
		case protocol.Location:
			locations = append(locations, d)
		case []protocol.Location:
			locations = append(locations, d...)
		}
	}

	return locations
}

// Helper function to get LSP client names for debugging
func getClientNames(lsps map[string]*lsp.Client) []string {
	names := make([]string, 0, len(lsps))
	for name := range lsps {
		names = append(names, name)
	}
	return names
}
