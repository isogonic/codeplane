package agent

import (
	"errors"

	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/config"
	"github.com/kujtimiihoxha/termai/internal/llm/models"
	"github.com/kujtimiihoxha/termai/internal/llm/tools"
)

type coderAgent struct {
	*agent
}

func (c *coderAgent) setAgentTool(sessionID string) {
	inx := -1
	for i, tool := range c.tools {
		if tool.Info().Name == AgentToolName {
			inx = i
			break
		}
	}
	if inx == -1 {
		c.tools = append(c.tools, NewAgentTool(sessionID, c.App))
	} else {
		c.tools[inx] = NewAgentTool(sessionID, c.App)
	}
}

func (c *coderAgent) Generate(sessionID string, content string) error {
	c.setAgentTool(sessionID)
	return c.generate(sessionID, content)
}

func NewCoderAgent(app *app.App) (Agent, error) {
	model, ok := models.SupportedModels[config.Get().Model.Coder]
	if !ok {
		return nil, errors.New("model not supported")
	}

	agentProvider, titleGenerator, err := getAgentProviders(app.Context, model)
	if err != nil {
		return nil, err
	}

	mcpTools := GetMcpTools(app.Context)
	return &coderAgent{
		agent: &agent{
			App: app,
			tools: append(
				[]tools.BaseTool{
					tools.NewBashTool(),
					tools.NewEditTool(),
					tools.NewGlobTool(),
					tools.NewGrepTool(),
					tools.NewLsTool(),
					tools.NewViewTool(),
					tools.NewWriteTool(),
				}, mcpTools...,
			),
			model:          model,
			agent:          agentProvider,
			titleGenerator: titleGenerator,
		},
	}, nil
}
