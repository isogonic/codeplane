package session

import (
	"context"
	"sync"

	"github.com/opencode-ai/opencode/internal/logging"
	"github.com/opencode-ai/opencode/internal/pubsub"
)

// Manager handles session management, tracking the currently active session.
type Manager struct {
	currentSessionID string
	service          Service
	mu               sync.RWMutex
}

// Global instance of the session manager
var globalManager *Manager

// InitManager initializes the global session manager with the provided service.
func InitManager(service Service) {
	globalManager = &Manager{
		currentSessionID: "",
		service:          service,
	}

	// Subscribe to session events to handle session deletions
	go func() {
		ctx := context.Background()
		eventCh := service.Subscribe(ctx)
		for event := range eventCh {
			if event.Type == pubsub.DeletedEvent && event.Payload.ID == CurrentSessionID() {
				// If the current session is deleted, clear the current session
				SetCurrentSession("")
			}
		}
	}()
}

// SetCurrentSession changes the active session to the one with the specified ID.
func SetCurrentSession(sessionID string) {
	if globalManager == nil {
		logging.Warn("Session manager not initialized")
		return
	}

	globalManager.mu.Lock()
	defer globalManager.mu.Unlock()

	globalManager.currentSessionID = sessionID
	logging.Debug("Current session changed", "sessionID", sessionID)
}

// CurrentSessionID returns the ID of the currently active session.
func CurrentSessionID() string {
	if globalManager == nil {
		logging.Warn("Session manager not initialized")
		return ""
	}

	globalManager.mu.RLock()
	defer globalManager.mu.RUnlock()

	return globalManager.currentSessionID
}

// CurrentSession returns the currently active session.
// If no session is set or the session cannot be found, it returns nil.
func CurrentSession() *Session {
	if globalManager == nil {
		logging.Warn("Session manager not initialized")
		return nil
	}

	sessionID := CurrentSessionID()
	if sessionID == "" {
		return nil
	}

	session, err := globalManager.service.Get(context.Background(), sessionID)
	if err != nil {
		logging.Warn("Failed to get current session", "err", err)
		return nil
	}

	return &session
}