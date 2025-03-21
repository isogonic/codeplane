package logging

import (
	"context"
	"io"
	"log/slog"
	"slices"

	"github.com/kujtimiihoxha/termai/internal/pubsub"
	"golang.org/x/exp/maps"
)

const DefaultLevel = "info"

var levels = map[string]slog.Level{
	"debug":      slog.LevelDebug,
	DefaultLevel: slog.LevelInfo,
	"warn":       slog.LevelWarn,
	"error":      slog.LevelError,
}

func ValidLevels() []string {
	keys := maps.Keys(levels)
	slices.SortFunc(keys, func(a, b string) int {
		if a == DefaultLevel {
			return -1
		}
		if b == DefaultLevel {
			return 1
		}
		if a < b {
			return -1
		}
		return 1
	})
	return keys
}

func NewLogger(opts Options) *Logger {
	logger := &Logger{}
	broker := pubsub.NewBroker[Message]()
	writer := &writer{
		messages: []Message{},
		Broker:   broker,
	}

	handler := slog.NewTextHandler(
		io.MultiWriter(append(opts.AdditionalWriters, writer)...),
		&slog.HandlerOptions{
			Level: slog.Level(levels[opts.Level]),
		},
	)
	logger.logger = slog.New(handler)
	logger.writer = writer

	return logger
}

type Options struct {
	Level             string
	AdditionalWriters []io.Writer
}

type Logger struct {
	logger *slog.Logger
	writer *writer
}

func (l *Logger) Debug(msg string, args ...any) {
	l.logger.Debug(msg, args...)
}

func (l *Logger) Info(msg string, args ...any) {
	l.logger.Info(msg, args...)
}

func (l *Logger) Warn(msg string, args ...any) {
	l.logger.Warn(msg, args...)
}

func (l *Logger) Error(msg string, args ...any) {
	l.logger.Error(msg, args...)
}

func (l *Logger) List() []Message {
	return l.writer.messages
}

func (l *Logger) Get(id string) (Message, error) {
	for _, msg := range l.writer.messages {
		if msg.ID == id {
			return msg, nil
		}
	}
	return Message{}, io.EOF
}

func (l *Logger) Subscribe(ctx context.Context) <-chan pubsub.Event[Message] {
	return l.writer.Subscribe(ctx)
}
