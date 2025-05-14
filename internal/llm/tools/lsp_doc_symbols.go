package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sst/opencode/internal/lsp"
	"github.com/sst/opencode/internal/lsp/protocol"
)

type DocSymbolsParams struct {
	FilePath string `json:"file_path"`
}

type docSymbolsTool struct {
	lspClients map[string]*lsp.Client
}

const (
	DocSymbolsToolName    = "docSymbols"
	docSymbolsDescription = `Get document symbols for a file.
WHEN TO USE THIS TOOL:
- Use when you need to understand the structure of a file
- Helpful for finding classes, functions, methods, and variables in a file
- Great for getting an overview of a file's organization

HOW TO USE:
- Provide the path to the file to get symbols for
- Results show all symbols defined in the file with their kind and location

FEATURES:
- Lists all symbols in a hierarchical structure
- Shows symbol types (function, class, variable, etc.)
- Provides location information for each symbol
- Organizes symbols by their scope and relationship

LIMITATIONS:
- Requires a functioning LSP server for the file type
- Results depend on the accuracy of the LSP server
- May not work for all file types

TIPS:
- Use to quickly understand the structure of a large file
- Combine with Definition and References tools for deeper code exploration
`
)

func NewDocSymbolsTool(lspClients map[string]*lsp.Client) BaseTool {
	return &docSymbolsTool{
		lspClients,
	}
}

func (b *docSymbolsTool) Info() ToolInfo {
	return ToolInfo{
		Name:        DocSymbolsToolName,
		Description: docSymbolsDescription,
		Parameters: map[string]any{
			"file_path": map[string]any{
				"type":        "string",
				"description": "The path to the file to get symbols for",
			},
		},
		Required: []string{"file_path"},
	}
}

func (b *docSymbolsTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	var params DocSymbolsParams
	if err := json.Unmarshal([]byte(call.Input), &params); err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error parsing parameters: %s", err)), nil
	}

	lsps := b.lspClients

	if len(lsps) == 0 {
		return NewTextResponse("\nLSP clients are still initializing. Document symbols lookup will be available once they're ready.\n"), nil
	}

	// Ensure file is open in LSP
	notifyLspOpenFile(ctx, params.FilePath, lsps)

	output := getDocumentSymbols(ctx, params.FilePath, lsps)

	return NewTextResponse(output), nil
}

func getDocumentSymbols(ctx context.Context, filePath string, lsps map[string]*lsp.Client) string {
	var results []string

	for lspName, client := range lsps {
		// Create document symbol params
		uri := fmt.Sprintf("file://%s", filePath)
		symbolParams := protocol.DocumentSymbolParams{
			TextDocument: protocol.TextDocumentIdentifier{
				URI: protocol.DocumentUri(uri),
			},
		}

		// Get document symbols
		symbolResult, err := client.DocumentSymbol(ctx, symbolParams)
		if err != nil {
			results = append(results, fmt.Sprintf("Error from %s: %s", lspName, err))
			continue
		}

		// Process the symbol result
		symbols := processDocumentSymbolResult(symbolResult)
		if len(symbols) == 0 {
			results = append(results, fmt.Sprintf("No symbols found by %s", lspName))
			continue
		}

		// Format the symbols
		results = append(results, fmt.Sprintf("Symbols found by %s:", lspName))
		for _, symbol := range symbols {
			results = append(results, formatSymbol(symbol, 1))
		}
	}

	if len(results) == 0 {
		return "No symbols found in the specified file."
	}

	return strings.Join(results, "\n")
}

func processDocumentSymbolResult(result protocol.Or_Result_textDocument_documentSymbol) []SymbolInfo {
	var symbols []SymbolInfo

	switch v := result.Value.(type) {
	case []protocol.SymbolInformation:
		for _, si := range v {
			symbols = append(symbols, SymbolInfo{
				Name:     si.Name,
				Kind:     symbolKindToString(si.Kind),
				Location: locationToString(si.Location),
				Children: nil,
			})
		}
	case []protocol.DocumentSymbol:
		for _, ds := range v {
			symbols = append(symbols, documentSymbolToSymbolInfo(ds))
		}
	}

	return symbols
}

// SymbolInfo represents a symbol in a document
type SymbolInfo struct {
	Name     string
	Kind     string
	Location string
	Children []SymbolInfo
}

func documentSymbolToSymbolInfo(symbol protocol.DocumentSymbol) SymbolInfo {
	info := SymbolInfo{
		Name: symbol.Name,
		Kind: symbolKindToString(symbol.Kind),
		Location: fmt.Sprintf("Line %d-%d", 
			symbol.Range.Start.Line+1, 
			symbol.Range.End.Line+1),
		Children: []SymbolInfo{},
	}

	for _, child := range symbol.Children {
		info.Children = append(info.Children, documentSymbolToSymbolInfo(child))
	}

	return info
}

func locationToString(location protocol.Location) string {
	return fmt.Sprintf("Line %d-%d", 
		location.Range.Start.Line+1, 
		location.Range.End.Line+1)
}

func symbolKindToString(kind protocol.SymbolKind) string {
	if kindStr, ok := protocol.TableKindMap[kind]; ok {
		return kindStr
	}
	return "Unknown"
}

func formatSymbol(symbol SymbolInfo, level int) string {
	indent := strings.Repeat("  ", level)
	result := fmt.Sprintf("%s- %s (%s) %s", indent, symbol.Name, symbol.Kind, symbol.Location)
	
	var childResults []string
	for _, child := range symbol.Children {
		childResults = append(childResults, formatSymbol(child, level+1))
	}
	
	if len(childResults) > 0 {
		return result + "\n" + strings.Join(childResults, "\n")
	}
	
	return result
}