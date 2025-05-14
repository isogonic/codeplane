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

	return append(
		[]tools.BaseTool{
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
			NewAgentTool(sessions, messages, lspClients),
		}, mcpTools...,
	)
}

func TaskAgentTools(lspClients map[string]*lsp.Client) []tools.BaseTool {
	return []tools.BaseTool{
		tools.NewGlobTool(),
		tools.NewGrepTool(),
		tools.NewLsTool(),
		tools.NewViewTool(lspClients),
		tools.NewDefinitionTool(lspClients),
		tools.NewReferencesTool(lspClients),
		tools.NewDocSymbolsTool(lspClients),
		tools.NewWorkspaceSymbolsTool(lspClients),
	}
}
