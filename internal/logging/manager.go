package logging

import (
	"context"
	"sync"
)

// Manager handles logging management
type Manager struct {
	service Service
	mu      sync.RWMutex
}

// Global instance of the logging manager
var globalManager *Manager

// InitManager initializes the global logging manager with the provided service
func InitManager(service Service) {
	globalManager = &Manager{
		service: service,
	}

	// Subscribe to log events if needed
	go func() {
		ctx := context.Background()
		_ = service.Subscribe(ctx) // Just subscribing to keep the channel open
	}()
}

// GetService returns the logging service
func GetService() Service {
	if globalManager == nil {
		return nil
	}

	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	return globalManager.service
}

func Create(ctx context.Context, log Log) error {
	if globalManager == nil {
		return nil
	}
	return globalManager.service.Create(ctx, log)
}

