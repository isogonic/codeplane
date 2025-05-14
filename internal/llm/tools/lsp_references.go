package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sst/opencode/internal/lsp"
	"github.com/sst/opencode/internal/lsp/protocol"
)

type ReferencesParams struct {
	FilePath           string `json:"file_path"`
	Line               int    `json:"line"`
	Column             int    `json:"column"`
	IncludeDeclaration bool   `json:"include_declaration"`
}

type referencesTool struct {
	lspClients map[string]*lsp.Client
}

const (
	ReferencesToolName    = "references"
	referencesDescription = `Find all references to a symbol at a specific position in a file.
WHEN TO USE THIS TOOL:
- Use when you need to find all places where a symbol is used
- Helpful for understanding code usage and dependencies
- Great for refactoring and impact analysis

HOW TO USE:
- Provide the path to the file containing the symbol
- Specify the line number (1-based) where the symbol appears
- Specify the column number (1-based) where the symbol appears
- Optionally set include_declaration to include the declaration in results
- Results show all locations where the symbol is referenced

FEATURES:
- Finds references across files in the project
- Works with variables, functions, classes, interfaces, etc.
- Returns file paths, lines, and columns of all references

LIMITATIONS:
- Requires a functioning LSP server for the file type
- May not find all references depending on LSP capabilities
- Results depend on the accuracy of the LSP server

TIPS:
- Use in conjunction with Definition tool to understand symbol origins
- Combine with View tool to examine the references
`
)

func NewReferencesTool(lspClients map[string]*lsp.Client) BaseTool {
	return &referencesTool{
		lspClients,
	}
}

func (b *referencesTool) Info() ToolInfo {
	return ToolInfo{
		Name:        ReferencesToolName,
		Description: referencesDescription,
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
			"include_declaration": map[string]any{
				"type":        "boolean",
				"description": "Whether to include the declaration in the results",
			},
		},
		Required: []string{"file_path", "line", "column"},
	}
}

func (b *referencesTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	var params ReferencesParams
	if err := json.Unmarshal([]byte(call.Input), &params); err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error parsing parameters: %s", err)), nil
	}

	lsps := b.lspClients

	if len(lsps) == 0 {
		return NewTextResponse("\nLSP clients are still initializing. References lookup will be available once they're ready.\n"), nil
	}

	// Ensure file is open in LSP
	notifyLspOpenFile(ctx, params.FilePath, lsps)

	// Convert 1-based line/column to 0-based for LSP protocol
	line := max(0, params.Line-1)
	column := max(0, params.Column-1)

	output := getReferences(ctx, params.FilePath, line, column, params.IncludeDeclaration, lsps)

	return NewTextResponse(output), nil
}

func getReferences(ctx context.Context, filePath string, line, column int, includeDeclaration bool, lsps map[string]*lsp.Client) string {
	var results []string

	for lspName, client := range lsps {
		// Create references params
		uri := fmt.Sprintf("file://%s", filePath)
		referencesParams := protocol.ReferenceParams{
			TextDocumentPositionParams: protocol.TextDocumentPositionParams{
				TextDocument: protocol.TextDocumentIdentifier{
					URI: protocol.DocumentUri(uri),
				},
				Position: protocol.Position{
					Line:      uint32(line),
					Character: uint32(column),
				},
			},
			Context: protocol.ReferenceContext{
				IncludeDeclaration: includeDeclaration,
			},
		}

		// Get references
		references, err := client.References(ctx, referencesParams)
		if err != nil {
			results = append(results, fmt.Sprintf("Error from %s: %s", lspName, err))
			continue
		}

		if len(references) == 0 {
			results = append(results, fmt.Sprintf("No references found by %s", lspName))
			continue
		}

		// Format the locations
		results = append(results, fmt.Sprintf("References found by %s:", lspName))
		for _, loc := range references {
			path := strings.TrimPrefix(string(loc.URI), "file://")
			// Convert 0-based line/column to 1-based for display
			refLine := loc.Range.Start.Line + 1
			refColumn := loc.Range.Start.Character + 1
			results = append(results, fmt.Sprintf("  %s:%d:%d", path, refLine, refColumn))
		}
	}

	if len(results) == 0 {
		return "No references found for the symbol at the specified position."
	}

	return strings.Join(results, "\n")
}

