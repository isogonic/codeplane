package status

import (
	"time"

	"github.com/opencode-ai/opencode/internal/pubsub"
)

// Level represents the severity level of a status message
type Level string

const (
	// LevelInfo represents an informational status message
	LevelInfo Level = "info"
	// LevelWarn represents a warning status message
	LevelWarn Level = "warn"
	// LevelError represents an error status message
	LevelError Level = "error"
	// LevelDebug represents a debug status message
	LevelDebug Level = "debug"
)

// StatusMessage represents a status update to be displayed in the UI
type StatusMessage struct {
	Level     Level     `json:"level"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

// Service defines the interface for the status service
type Service interface {
	pubsub.Suscriber[StatusMessage]
	Info(message string)
	Warn(message string)
	Error(message string)
	Debug(message string)
}

type service struct {
	*pubsub.Broker[StatusMessage]
}

// Info publishes an info level status message
func (s *service) Info(message string) {
	s.publish(LevelInfo, message)
}

// Warn publishes a warning level status message
func (s *service) Warn(message string) {
	s.publish(LevelWarn, message)
}

// Error publishes an error level status message
func (s *service) Error(message string) {
	s.publish(LevelError, message)
}

// Debug publishes a debug level status message
func (s *service) Debug(message string) {
	s.publish(LevelDebug, message)
}

// publish creates and publishes a status message with the given level and message
func (s *service) publish(level Level, message string) {
	statusMsg := StatusMessage{
		Level:     level,
		Message:   message,
		Timestamp: time.Now(),
	}
	s.Publish(pubsub.CreatedEvent, statusMsg)
}

// NewService creates a new status service
func NewService() Service {
	broker := pubsub.NewBroker[StatusMessage]()
	return &service{
		Broker: broker,
	}
}

