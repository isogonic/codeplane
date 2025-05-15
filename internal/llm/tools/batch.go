package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

type BatchToolCall struct {
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type BatchParams struct {
	Calls []BatchToolCall `json:"calls"`
}

type BatchToolResult struct {
	ToolName  string          `json:"tool_name"`
	ToolInput json.RawMessage `json:"tool_input"`
	Result    json.RawMessage `json:"result"`
	Error     string          `json:"error,omitempty"`
	// Added for better formatting and separation between results
	Separator string          `json:"separator,omitempty"`
}

type BatchResult struct {
	Results []BatchToolResult `json:"results"`
}

type batchTool struct {
	tools map[string]BaseTool
}

const (
	BatchToolName        = "batch"
	BatchToolDescription = `Executes multiple tool calls in parallel and returns their results.

WHEN TO USE THIS TOOL:
- Use when you need to run multiple independent tool calls at once
- Helpful for improving performance by parallelizing operations
- Great for gathering information from multiple sources simultaneously

HOW TO USE:
- Provide an array of tool calls, each with a name and input
- Each tool call will be executed in parallel
- Results are returned in the same order as the input calls

FEATURES:
- Runs tool calls concurrently for better performance
- Returns both results and errors for each call
- Maintains the order of results to match input calls

LIMITATIONS:
- All tools must be available in the current context
- Complex error handling may be required for some use cases
- Not suitable for tool calls that depend on each other's results

TIPS:
- Use for independent operations like multiple file reads or searches
- Great for batch operations like searching multiple directories
- Combine with other tools for more complex workflows`
)

func NewBatchTool(tools map[string]BaseTool) BaseTool {
	return &batchTool{
		tools: tools,
	}
}

func (b *batchTool) Info() ToolInfo {
	return ToolInfo{
		Name:        BatchToolName,
		Description: BatchToolDescription,
		Parameters: map[string]any{
			"calls": map[string]any{
				"type":        "array",
				"description": "Array of tool calls to execute in parallel",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name": map[string]any{
							"type":        "string",
							"description": "Name of the tool to call",
						},
						"input": map[string]any{
							"type":        "object",
							"description": "Input parameters for the tool",
						},
					},
					"required": []string{"name", "input"},
				},
			},
		},
		Required: []string{"calls"},
	}
}

func (b *batchTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	var params BatchParams
	if err := json.Unmarshal([]byte(call.Input), &params); err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error parsing parameters: %s", err)), nil
	}

	if len(params.Calls) == 0 {
		return NewTextErrorResponse("no tool calls provided"), nil
	}

	var wg sync.WaitGroup
	results := make([]BatchToolResult, len(params.Calls))

	for i, toolCall := range params.Calls {
		wg.Add(1)
		go func(index int, tc BatchToolCall) {
			defer wg.Done()

			// Create separator for better visual distinction between results
			separator := ""
			if index > 0 {
				separator = fmt.Sprintf("\n%s\n", strings.Repeat("=", 80))
			}

			result := BatchToolResult{
				ToolName:  tc.Name,
				ToolInput: tc.Input,
				Separator: separator,
			}

			tool, ok := b.tools[tc.Name]
			if !ok {
				result.Error = fmt.Sprintf("tool not found: %s", tc.Name)
				results[index] = result
				return
			}

			// Create a proper ToolCall object
			callObj := ToolCall{
				ID:    fmt.Sprintf("batch-%d", index),
				Name:  tc.Name,
				Input: string(tc.Input),
			}

			response, err := tool.Run(ctx, callObj)
			if err != nil {
				result.Error = fmt.Sprintf("error executing tool %s: %s", tc.Name, err)
				results[index] = result
				return
			}

			// Standardize metadata format if present
			if response.Metadata != "" {
				var metadata map[string]interface{}
				if err := json.Unmarshal([]byte(response.Metadata), &metadata); err == nil {
					// Add tool name to metadata for better context
					metadata["tool"] = tc.Name
					
					// Re-marshal with consistent formatting
					if metadataBytes, err := json.MarshalIndent(metadata, "", "  "); err == nil {
						response.Metadata = string(metadataBytes)
					}
				}
			}

			// Convert the response to JSON
			responseJSON, err := json.Marshal(response)
			if err != nil {
				result.Error = fmt.Sprintf("error marshaling response: %s", err)
				results[index] = result
				return
			}

			result.Result = responseJSON
			results[index] = result
		}(i, toolCall)
	}

	wg.Wait()

	batchResult := BatchResult{
		Results: results,
	}

	resultJSON, err := json.Marshal(batchResult)
	if err != nil {
		return NewTextErrorResponse(fmt.Sprintf("error marshaling batch result: %s", err)), nil
	}

	return NewTextResponse(string(resultJSON)), nil
}