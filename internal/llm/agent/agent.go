package agent

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/flow/agent/react"
)

func GetAgent(ctx context.Context, name string) (*react.Agent, string, error) {
	switch name {
	case "coder":
		agent, err := NewCoderAgent(ctx)
		return agent, CoderSystemPrompt(), err
	}
	return nil, "", fmt.Errorf("agent %s not found", name)
}
