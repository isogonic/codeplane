package status

import (
	"log/slog"
	"sync"
)

// Manager handles status message management
type Manager struct {
	service Service
	mu      sync.RWMutex
}

// Global instance of the status manager
var globalManager *Manager

// InitManager initializes the global status manager with the provided service
func InitManager(service Service) {
	globalManager = &Manager{
		service: service,
	}

	// Subscribe to status events for any global handling if needed
	// go func() {
	// 	ctx := context.Background()
	// 	_ = service.Subscribe(ctx)
	// }()

	slog.Debug("Status manager initialized")
}

// GetService returns the status service from the global manager
func GetService() Service {
	if globalManager == nil {
		slog.Warn("Status manager not initialized, initializing with default service")
		InitManager(NewService())
	}

	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	return globalManager.service
}

// Info publishes an info level status message using the global manager
func Info(message string) {
	GetService().Info(message)
}

// Warn publishes a warning level status message using the global manager
func Warn(message string) {
	GetService().Warn(message)
}

// Error publishes an error level status message using the global manager
func Error(message string) {
	GetService().Error(message)
}

// Debug publishes a debug level status message using the global manager
func Debug(message string) {
	GetService().Debug(message)
}

