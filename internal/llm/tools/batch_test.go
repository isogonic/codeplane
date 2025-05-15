package tools

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

// MockTool is a simple tool implementation for testing
type MockTool struct {
	name        string
	description string
	response    ToolResponse
	err         error
}

func (m *MockTool) Info() ToolInfo {
	return ToolInfo{
		Name:        m.name,
		Description: m.description,
		Parameters:  map[string]any{},
		Required:    []string{},
	}
}

func (m *MockTool) Run(ctx context.Context, call ToolCall) (ToolResponse, error) {
	return m.response, m.err
}

func TestBatchTool(t *testing.T) {
	t.Parallel()

	t.Run("successful batch execution", func(t *testing.T) {
		t.Parallel()

		// Create mock tools
		mockTools := map[string]BaseTool{
			"tool1": &MockTool{
				name:        "tool1",
				description: "Mock Tool 1",
				response:    NewTextResponse("Tool 1 Response"),
				err:         nil,
			},
			"tool2": &MockTool{
				name:        "tool2",
				description: "Mock Tool 2",
				response:    NewTextResponse("Tool 2 Response"),
				err:         nil,
			},
		}

		// Create batch tool
		batchTool := NewBatchTool(mockTools)

		// Create batch call
		input := `{
			"calls": [
				{
					"name": "tool1",
					"input": {}
				},
				{
					"name": "tool2",
					"input": {}
				}
			]
		}`

		call := ToolCall{
			ID:    "test-batch",
			Name:  "batch",
			Input: input,
		}

		// Execute batch
		response, err := batchTool.Run(context.Background(), call)

		// Verify results
		assert.NoError(t, err)
		assert.Equal(t, ToolResponseTypeText, response.Type)
		assert.False(t, response.IsError)

		// Parse the response
		var batchResult BatchResult
		err = json.Unmarshal([]byte(response.Content), &batchResult)
		assert.NoError(t, err)

		// Verify batch results
		assert.Len(t, batchResult.Results, 2)
		assert.Empty(t, batchResult.Results[0].Error)
		assert.Empty(t, batchResult.Results[1].Error)
		assert.Empty(t, batchResult.Results[0].Separator)
		assert.NotEmpty(t, batchResult.Results[1].Separator)

		// Verify individual results
		var result1 ToolResponse
		err = json.Unmarshal(batchResult.Results[0].Result, &result1)
		assert.NoError(t, err)
		assert.Equal(t, "Tool 1 Response", result1.Content)

		var result2 ToolResponse
		err = json.Unmarshal(batchResult.Results[1].Result, &result2)
		assert.NoError(t, err)
		assert.Equal(t, "Tool 2 Response", result2.Content)
	})

	t.Run("tool not found", func(t *testing.T) {
		t.Parallel()

		// Create mock tools
		mockTools := map[string]BaseTool{
			"tool1": &MockTool{
				name:        "tool1",
				description: "Mock Tool 1",
				response:    NewTextResponse("Tool 1 Response"),
				err:         nil,
			},
		}

		// Create batch tool
		batchTool := NewBatchTool(mockTools)

		// Create batch call with non-existent tool
		input := `{
			"calls": [
				{
					"name": "tool1",
					"input": {}
				},
				{
					"name": "nonexistent",
					"input": {}
				}
			]
		}`

		call := ToolCall{
			ID:    "test-batch",
			Name:  "batch",
			Input: input,
		}

		// Execute batch
		response, err := batchTool.Run(context.Background(), call)

		// Verify results
		assert.NoError(t, err)
		assert.Equal(t, ToolResponseTypeText, response.Type)
		assert.False(t, response.IsError)

		// Parse the response
		var batchResult BatchResult
		err = json.Unmarshal([]byte(response.Content), &batchResult)
		assert.NoError(t, err)

		// Verify batch results
		assert.Len(t, batchResult.Results, 2)
		assert.Empty(t, batchResult.Results[0].Error)
		assert.Contains(t, batchResult.Results[1].Error, "tool not found: nonexistent")
	})

	t.Run("empty calls", func(t *testing.T) {
		t.Parallel()

		// Create batch tool with empty tools map
		batchTool := NewBatchTool(map[string]BaseTool{})

		// Create batch call with empty calls
		input := `{
			"calls": []
		}`

		call := ToolCall{
			ID:    "test-batch",
			Name:  "batch",
			Input: input,
		}

		// Execute batch
		response, err := batchTool.Run(context.Background(), call)

		// Verify results
		assert.NoError(t, err)
		assert.Equal(t, ToolResponseTypeText, response.Type)
		assert.True(t, response.IsError)
		assert.Contains(t, response.Content, "no tool calls provided")
	})

	t.Run("invalid input", func(t *testing.T) {
		t.Parallel()

		// Create batch tool with empty tools map
		batchTool := NewBatchTool(map[string]BaseTool{})

		// Create batch call with invalid JSON
		input := `{
			"calls": [
				{
					"name": "tool1",
					"input": {
						"invalid": json
					}
				}
			]
		}`

		call := ToolCall{
			ID:    "test-batch",
			Name:  "batch",
			Input: input,
		}

		// Execute batch
		response, err := batchTool.Run(context.Background(), call)

		// Verify results
		assert.NoError(t, err)
		assert.Equal(t, ToolResponseTypeText, response.Type)
		assert.True(t, response.IsError)
		assert.Contains(t, response.Content, "error parsing parameters")
	})
}