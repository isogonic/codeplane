package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sst/opencode/internal/lsp"
	"github.com/sst/opencode/internal/lsp/protocol"
	"github.com/sst/opencode/internal/lsp/util"
)

type CodeActionParams struct {
	FilePath   string `json:"file_path"`
	Line       int    `json:"line"`
	Column     int    `json:"column"`
	EndLine    int    `json:"end_line,omitempty"`
	EndColumn  int    `json:"end_column,omitempty"`
	ActionID   int    `json:"action_id,omitempty"`
	LspName    string `json:"lsp_name,omitempty"`
}

type codeActionTool struct {
	lspClients map[string]*lsp.Client
}

const (
	CodeActionToolName    = "codeAction"
	codeActionDescription = `Get available code actions at a specific position or range in a file.
WHEN TO USE THIS TOOL:
- Use when you need to find available fixes or refactorings for code issues
- Helpful for resolving errors, warnings, or improving code quality
- Great for discovering automated code transformations

HOW TO USE:
- Provide the path to the file containing the code
- Specify the line number (1-based) where the action should be applied
- Specify the column number (1-based) where the action should be applied
- Optionally specify end_line and end_column to define a range
- Results show available code actions with their titles and kinds

TO EXECUTE A CODE ACTION:
- After getting the list of available actions, call the tool again with the same parameters
- Add action_id parameter with the number of the action you want to execute (e.g., 1 for the first action)
- Add lsp_name parameter with the name of the LSP server that provided the action

FEATURES:
- Finds quick fixes for errors and warnings
- Discovers available refactorings
- Shows code organization actions
- Returns detailed information about each action
- Can execute selected code actions

LIMITATIONS:
- Requires a functioning LSP server for the file type
- May not work for all code issues depending on LSP capabilities
- Results depend on the accuracy of the LSP server

TIPS:
- Use in conjunction with Diagnostics tool to find issues that can be fixed
- First call without action_id to see available actions, then call again with action_id to execute
`
)

func NewCodeActionTool(lspClients map[string]*lsp.Client) BaseTool {
	return &codeActionTool{
		lspClients,
	}
}

func (b *codeActionTool) Info() ToolInfo {
	return ToolInfo{
		Name:        CodeActionToolName,
		Description: codeActionDescription,
		Parameters: map[string]any{
			"file_path": map[string]any{
				"type":        "string",
				"description": "The path to the file containing the code",
			},
			"line": map[string]any{
				"type":        "integer",
				"description": "The line number (1-based) where the action should be applied",
			},
			"column": map[string]any{
				"type":        "integer",
				"description": "The column number (1-based) where the action should be applied",
			},
			"end_line": map[string]any{
				"type":        "integer",
				"description": "The ending line number (1-based) for a range (optional)",
			},
			"end_column": map[string]any{
				"type":        "integer",
				"description": "The ending column number (1-based) for a range (optional)",
			},
			"action_id": map[string]any{
				"type":        "integer",
				"description": "The ID of the code action to execute (optional)",
			},
			"lsp_name": map[string]any{
				"type":        "string",
				"description": "The name of the LSP server that provided the action (optional)",
			},
		},
		Required: []string{"file_path", "line", "column"},
	}
}

func (b *codeActionTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	var params CodeActionParams
	if err := json.Unmarshal([]byte(call.Input), &params); err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error parsing parameters: %s", err)), nil
	}

	lsps := b.lspClients

	if len(lsps) == 0 {
		return NewTextResponse("\nLSP clients are still initializing. Code actions will be available once they're ready.\n"), nil
	}

	// Ensure file is open in LSP
	notifyLspOpenFile(ctx, params.FilePath, lsps)

	// Convert 1-based line/column to 0-based for LSP protocol
	line := max(0, params.Line-1)
	column := max(0, params.Column-1)
	
	// Handle optional end line/column
	endLine := line
	endColumn := column
	if params.EndLine > 0 {
		endLine = max(0, params.EndLine-1)
	}
	if params.EndColumn > 0 {
		endColumn = max(0, params.EndColumn-1)
	}

	// Check if we're executing a specific action
	if params.ActionID > 0 && params.LspName != "" {
		return executeCodeAction(ctx, params.FilePath, line, column, endLine, endColumn, params.ActionID, params.LspName, lsps)
	}

	// Otherwise, just list available actions
	output := getCodeActions(ctx, params.FilePath, line, column, endLine, endColumn, lsps)
	return NewTextResponse(output), nil
}

func getCodeActions(ctx context.Context, filePath string, line, column, endLine, endColumn int, lsps map[string]*lsp.Client) string {
	var results []string

	for lspName, client := range lsps {
		// Create code action params
		uri := fmt.Sprintf("file://%s", filePath)
		codeActionParams := protocol.CodeActionParams{
			TextDocument: protocol.TextDocumentIdentifier{
				URI: protocol.DocumentUri(uri),
			},
			Range: protocol.Range{
				Start: protocol.Position{
					Line:      uint32(line),
					Character: uint32(column),
				},
				End: protocol.Position{
					Line:      uint32(endLine),
					Character: uint32(endColumn),
				},
			},
			Context: protocol.CodeActionContext{
				// Request all kinds of code actions
				Only: []protocol.CodeActionKind{
					protocol.QuickFix,
					protocol.Refactor,
					protocol.RefactorExtract,
					protocol.RefactorInline,
					protocol.RefactorRewrite,
					protocol.Source,
					protocol.SourceOrganizeImports,
					protocol.SourceFixAll,
				},
			},
		}

		// Get code actions
		codeActions, err := client.CodeAction(ctx, codeActionParams)
		if err != nil {
			results = append(results, fmt.Sprintf("Error from %s: %s", lspName, err))
			continue
		}

		if len(codeActions) == 0 {
			results = append(results, fmt.Sprintf("No code actions found by %s", lspName))
			continue
		}

		// Format the code actions
		results = append(results, fmt.Sprintf("Code actions found by %s:", lspName))
		for i, action := range codeActions {
			actionInfo := formatCodeAction(action, i+1)
			results = append(results, actionInfo)
		}
	}

	if len(results) == 0 {
		return "No code actions found at the specified position."
	}

	return strings.Join(results, "\n")
}

func formatCodeAction(action protocol.Or_Result_textDocument_codeAction_Item0_Elem, index int) string {
	switch v := action.Value.(type) {
	case protocol.CodeAction:
		kind := "Unknown"
		if v.Kind != "" {
			kind = string(v.Kind)
		}
		
		var details []string
		
		// Add edit information if available
		if v.Edit != nil {
			numChanges := 0
			if v.Edit.Changes != nil {
				numChanges = len(v.Edit.Changes)
			}
			if v.Edit.DocumentChanges != nil {
				numChanges = len(v.Edit.DocumentChanges)
			}
			details = append(details, fmt.Sprintf("Edits: %d changes", numChanges))
		}
		
		// Add command information if available
		if v.Command != nil {
			details = append(details, fmt.Sprintf("Command: %s", v.Command.Title))
		}
		
		// Add diagnostics information if available
		if v.Diagnostics != nil && len(v.Diagnostics) > 0 {
			details = append(details, fmt.Sprintf("Fixes: %d diagnostics", len(v.Diagnostics)))
		}
		
		detailsStr := ""
		if len(details) > 0 {
			detailsStr = " (" + strings.Join(details, ", ") + ")"
		}
		
		return fmt.Sprintf("  %d. %s [%s]%s", index, v.Title, kind, detailsStr)
		
	case protocol.Command:
		return fmt.Sprintf("  %d. %s [Command]", index, v.Title)
	}
	
	return fmt.Sprintf("  %d. Unknown code action type", index)
}

func executeCodeAction(ctx context.Context, filePath string, line, column, endLine, endColumn, actionID int, lspName string, lsps map[string]*lsp.Client) (ToolResponse, error) {
	client, ok := lsps[lspName]
	if !ok {
		return NewTextErrorResponse(fmt.Sprintf("LSP server '%s' not found", lspName)), nil
	}

	// Create code action params
	uri := fmt.Sprintf("file://%s", filePath)
	codeActionParams := protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{
			URI: protocol.DocumentUri(uri),
		},
		Range: protocol.Range{
			Start: protocol.Position{
				Line:      uint32(line),
				Character: uint32(column),
			},
			End: protocol.Position{
				Line:      uint32(endLine),
				Character: uint32(endColumn),
			},
		},
		Context: protocol.CodeActionContext{
			// Request all kinds of code actions
			Only: []protocol.CodeActionKind{
				protocol.QuickFix,
				protocol.Refactor,
				protocol.RefactorExtract,
				protocol.RefactorInline,
				protocol.RefactorRewrite,
				protocol.Source,
				protocol.SourceOrganizeImports,
				protocol.SourceFixAll,
			},
		},
	}

	// Get code actions
	codeActions, err := client.CodeAction(ctx, codeActionParams)
	if err != nil {
		return NewTextErrorResponse(fmt.Sprintf("Error getting code actions: %s", err)), nil
	}

	if len(codeActions) == 0 {
		return NewTextErrorResponse("No code actions found"), nil
	}

	// Check if the requested action ID is valid
	if actionID < 1 || actionID > len(codeActions) {
		return NewTextErrorResponse(fmt.Sprintf("Invalid action ID: %d. Available actions: 1-%d", actionID, len(codeActions))), nil
	}

	// Get the selected action (adjust for 0-based index)
	selectedAction := codeActions[actionID-1]

	// Execute the action based on its type
	switch v := selectedAction.Value.(type) {
	case protocol.CodeAction:
		// Apply workspace edit if available
		if v.Edit != nil {
			err := util.ApplyWorkspaceEdit(*v.Edit)
			if err != nil {
				return NewTextErrorResponse(fmt.Sprintf("Error applying edit: %s", err)), nil
			}
		}

		// Execute command if available
		if v.Command != nil {
			_, err := client.ExecuteCommand(ctx, protocol.ExecuteCommandParams{
				Command:   v.Command.Command,
				Arguments: v.Command.Arguments,
			})
			if err != nil {
				return NewTextErrorResponse(fmt.Sprintf("Error executing command: %s", err)), nil
			}
		}

		return NewTextResponse(fmt.Sprintf("Successfully executed code action: %s", v.Title)), nil

	case protocol.Command:
		// Execute the command
		_, err := client.ExecuteCommand(ctx, protocol.ExecuteCommandParams{
			Command:   v.Command,
			Arguments: v.Arguments,
		})
		if err != nil {
			return NewTextErrorResponse(fmt.Sprintf("Error executing command: %s", err)), nil
		}

		return NewTextResponse(fmt.Sprintf("Successfully executed command: %s", v.Title)), nil
	}

	return NewTextErrorResponse("Unknown code action type"), nil
}