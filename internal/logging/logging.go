package logging

import (
	"context"

	"github.com/kujtimiihoxha/termai/internal/pubsub"
)

type Interface interface {
	Debug(msg string, args ...any)
	Info(msg string, args ...any)
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
	Subscribe(ctx context.Context) <-chan pubsub.Event[Message]

	List() []Message
}
