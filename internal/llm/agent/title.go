package agent

import (
	"context"

	"github.com/cloudwego/eino/schema"
	"github.com/kujtimiihoxha/termai/internal/llm/models"
	"github.com/spf13/viper"
)

func GenerateTitle(ctx context.Context, content string) (string, error) {
	model, err := models.GetModel(ctx, models.ModelID(viper.GetString("models.small")))
	if err != nil {
		return "", err
	}
	out, err := model.Generate(
		ctx,
		[]*schema.Message{
			schema.SystemMessage(`- you will generate a short title based on the first message a user begins a conversation with
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use quotes or colons
      - the entire text you return will be used as the title`),
			schema.UserMessage(content),
		},
	)
	if err != nil {
		return "", err
	}
	return out.Content, nil
}
