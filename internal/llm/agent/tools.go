package agent

import (
	"context"

	"github.com/sst/opencode/internal/history"
	"github.com/sst/opencode/internal/llm/tools"
	"github.com/sst/opencode/internal/lsp"
	"github.com/sst/opencode/internal/message"
	"github.com/sst/opencode/internal/permission"
	"github.com/sst/opencode/internal/session"
)

func PrimaryAgentTools(
	permissions permission.Service,
	sessions session.Service,
	messages message.Service,
	history history.Service,
	lspClients map[string]*lsp.Client,
) []tools.BaseTool {
	ctx := context.Background()
	mcpTools := GetMcpTools(ctx, permissions)

	// Create the list of tools
	toolsList := []tools.BaseTool{
		tools.NewBashTool(permissions),
		tools.NewEditTool(lspClients, permissions, history),
		tools.NewFetchTool(permissions),
		tools.NewGlobTool(),
		tools.NewGrepTool(),
		tools.NewLsTool(),
		tools.NewViewTool(lspClients),
		tools.NewPatchTool(lspClients, permissions, history),
		tools.NewWriteTool(lspClients, permissions, history),
		tools.NewDiagnosticsTool(lspClients),
		tools.NewDefinitionTool(lspClients),
		tools.NewReferencesTool(lspClients),
		tools.NewDocSymbolsTool(lspClients),
		tools.NewWorkspaceSymbolsTool(lspClients),
		tools.NewCodeActionTool(lspClients),
		NewAgentTool(sessions, messages, lspClients),
	}

	// Create a map of tools for the batch tool
	toolsMap := make(map[string]tools.BaseTool)
	for _, tool := range toolsList {
		toolsMap[tool.Info().Name] = tool
	}

	// Add the batch tool with access to all other tools
	toolsList = append(toolsList, tools.NewBatchTool(toolsMap))

	return append(toolsList, mcpTools...)
}

func TaskAgentTools(lspClients map[string]*lsp.Client) []tools.BaseTool {
	// Create the list of tools
	toolsList := []tools.BaseTool{
		tools.NewGlobTool(),
		tools.NewGrepTool(),
		tools.NewLsTool(),
		tools.NewViewTool(lspClients),
		tools.NewDefinitionTool(lspClients),
		tools.NewReferencesTool(lspClients),
		tools.NewDocSymbolsTool(lspClients),
		tools.NewWorkspaceSymbolsTool(lspClients),
	}

	// Create a map of tools for the batch tool
	toolsMap := make(map[string]tools.BaseTool)
	for _, tool := range toolsList {
		toolsMap[tool.Info().Name] = tool
	}

	// Add the batch tool with access to all other tools
	toolsList = append(toolsList, tools.NewBatchTool(toolsMap))

	return toolsList
}
