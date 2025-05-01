package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/opencode-ai/opencode/internal/lsp/discovery/tool"
)

// ConfigureLspServerTool is a tool for configuring LSP servers
type ConfigureLspServerTool struct{}

// NewConfigureLspServerTool creates a new ConfigureLspServerTool
func NewConfigureLspServerTool() *ConfigureLspServerTool {
	return &ConfigureLspServerTool{}
}

// Info returns information about the tool
func (t *ConfigureLspServerTool) Info() ToolInfo {
	return ToolInfo{
		Name:        "configureLspServer",
		Description: "Searches for an LSP server for the given language",
		Parameters: map[string]any{
			"language": map[string]any{
				"type":        "string",
				"description": "The language identifier (e.g., \"go\", \"typescript\", \"python\")",
			},
		},
		Required: []string{"language"},
	}
}

// Run executes the tool
func (t *ConfigureLspServerTool) Run(ctx context.Context, params ToolCall) (ToolResponse, error) {
	result, err := tool.ConfigureLspServer(ctx, json.RawMessage(params.Input))
	if err != nil {
		return NewTextErrorResponse(err.Error()), nil
	}

	// Convert the result to JSON
	resultJSON, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return NewTextErrorResponse(fmt.Sprintf("Failed to marshal result: %v", err)), nil
	}

	return NewTextResponse(string(resultJSON)), nil
}

