package status

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/opencode-ai/opencode/internal/pubsub"
)

type Level string

const (
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
	LevelDebug Level = "debug"
)

type StatusMessage struct {
	Level     Level     `json:"level"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

const (
	EventStatusPublished pubsub.EventType = "status_published"
)

type Service interface {
	pubsub.Subscriber[StatusMessage]

	Info(message string)
	Warn(message string)
	Error(message string)
	Debug(message string)
}

type service struct {
	broker *pubsub.Broker[StatusMessage]
	mu     sync.RWMutex
}

var globalStatusService *service

func InitService() error {
	if globalStatusService != nil {
		return fmt.Errorf("status service already initialized")
	}
	broker := pubsub.NewBroker[StatusMessage]()
	globalStatusService = &service{
		broker: broker,
	}
	return nil
}

func GetService() Service {
	if globalStatusService == nil {
		panic("status service not initialized. Call status.InitService() at application startup.")
	}
	return globalStatusService
}

func (s *service) Info(message string) {
	s.publish(LevelInfo, message)
	slog.Info(message)
}

func (s *service) Warn(message string) {
	s.publish(LevelWarn, message)
	slog.Warn(message)
}

func (s *service) Error(message string) {
	s.publish(LevelError, message)
	slog.Error(message)
}

func (s *service) Debug(message string) {
	s.publish(LevelDebug, message)
	slog.Debug(message)
}

func (s *service) publish(level Level, messageText string) {
	statusMsg := StatusMessage{
		Level:     level,
		Message:   messageText,
		Timestamp: time.Now(),
	}
	s.broker.Publish(EventStatusPublished, statusMsg)
}

func (s *service) Subscribe(ctx context.Context) <-chan pubsub.Event[StatusMessage] {
	return s.broker.Subscribe(ctx)
}

func Info(message string) {
	GetService().Info(message)
}

func Warn(message string) {
	GetService().Warn(message)
}

func Error(message string) {
	GetService().Error(message)
}

func Debug(message string) {
	GetService().Debug(message)
}

func Subscribe(ctx context.Context) <-chan pubsub.Event[StatusMessage] {
	return GetService().Subscribe(ctx)
}
