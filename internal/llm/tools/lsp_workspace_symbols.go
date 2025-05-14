package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sst/opencode/internal/lsp"
	"github.com/sst/opencode/internal/lsp/protocol"
)

type WorkspaceSymbolsParams struct {
	Query string `json:"query"`
}

type workspaceSymbolsTool struct {
	lspClients map[string]*lsp.Client
}

const (
	WorkspaceSymbolsToolName    = "workspaceSymbols"
	workspaceSymbolsDescription = `Find symbols across the workspace matching a query.
WHEN TO USE THIS TOOL:
- Use when you need to find symbols across multiple files
- Helpful for locating classes, functions, or variables in a project
- Great for exploring large codebases

HOW TO USE:
- Provide a query string to search for symbols
- Results show matching symbols from across the workspace

FEATURES:
- Searches across all files in the workspace
- Shows symbol types (function, class, variable, etc.)
- Provides location information for each symbol
- Works with partial matches and fuzzy search (depending on LSP server)

LIMITATIONS:
- Requires a functioning LSP server for the file types
- Results depend on the accuracy of the LSP server
- Query capabilities vary by language server
- May not work for all file types

TIPS:
- Use specific queries to narrow down results
- Combine with DocSymbols tool for detailed file exploration
- Use with Definition tool to jump to symbol definitions
`
)

func NewWorkspaceSymbolsTool(lspClients map[string]*lsp.Client) BaseTool {
	return &workspaceSymbolsTool{
		lspClients,
	}
}

func (b *workspaceSymbolsTool) Info() ToolInfo {
	return ToolInfo{
		Name:        WorkspaceSymbolsToolName,
		Description: workspaceSymbolsDescription,
		Parameters: map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "The query string to search for symbols",
			},
		},
		Required: []string{"query"},
	}
}

func (b *workspaceSymbolsTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	var params WorkspaceSymbolsParams
	if err := json.Unmarshal([]byte(call.Input), &params); err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error parsing parameters: %s", err)), nil
	}

	lsps := b.lspClients

	if len(lsps) == 0 {
		return NewTextResponse("\nLSP clients are still initializing. Workspace symbols lookup will be available once they're ready.\n"), nil
	}

	output := getWorkspaceSymbols(ctx, params.Query, lsps)

	return NewTextResponse(output), nil
}

func getWorkspaceSymbols(ctx context.Context, query string, lsps map[string]*lsp.Client) string {
	var results []string

	for lspName, client := range lsps {
		// Create workspace symbol params
		symbolParams := protocol.WorkspaceSymbolParams{
			Query: query,
		}

		// Get workspace symbols
		symbolResult, err := client.Symbol(ctx, symbolParams)
		if err != nil {
			results = append(results, fmt.Sprintf("Error from %s: %s", lspName, err))
			continue
		}

		// Process the symbol result
		symbols := processWorkspaceSymbolResult(symbolResult)
		if len(symbols) == 0 {
			results = append(results, fmt.Sprintf("No symbols found by %s for query '%s'", lspName, query))
			continue
		}

		// Format the symbols
		results = append(results, fmt.Sprintf("Symbols found by %s for query '%s':", lspName, query))
		for _, symbol := range symbols {
			results = append(results, fmt.Sprintf("  %s (%s) - %s", symbol.Name, symbol.Kind, symbol.Location))
		}
	}

	if len(results) == 0 {
		return fmt.Sprintf("No symbols found matching query '%s'.", query)
	}

	return strings.Join(results, "\n")
}

func processWorkspaceSymbolResult(result protocol.Or_Result_workspace_symbol) []SymbolInfo {
	var symbols []SymbolInfo

	switch v := result.Value.(type) {
	case []protocol.SymbolInformation:
		for _, si := range v {
			symbols = append(symbols, SymbolInfo{
				Name:     si.Name,
				Kind:     symbolKindToString(si.Kind),
				Location: formatWorkspaceLocation(si.Location),
				Children: nil,
			})
		}
	case []protocol.WorkspaceSymbol:
		for _, ws := range v {
			location := "Unknown location"
			if ws.Location.Value != nil {
				if loc, ok := ws.Location.Value.(protocol.Location); ok {
					location = formatWorkspaceLocation(loc)
				}
			}
			symbols = append(symbols, SymbolInfo{
				Name:     ws.Name,
				Kind:     symbolKindToString(ws.Kind),
				Location: location,
				Children: nil,
			})
		}
	}

	return symbols
}

func formatWorkspaceLocation(location protocol.Location) string {
	path := strings.TrimPrefix(string(location.URI), "file://")
	return fmt.Sprintf("%s:%d:%d", path, location.Range.Start.Line+1, location.Range.Start.Character+1)
}