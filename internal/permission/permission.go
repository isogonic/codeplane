package permission

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"log/slog"

	"github.com/google/uuid"
	"github.com/opencode-ai/opencode/internal/config"
	"github.com/opencode-ai/opencode/internal/pubsub"
)

var ErrorPermissionDenied = errors.New("permission denied")

type CreatePermissionRequest struct {
	SessionID   string `json:"session_id"`
	ToolName    string `json:"tool_name"`
	Description string `json:"description"`
	Action      string `json:"action"`
	Params      any    `json:"params"`
	Path        string `json:"path"`
}

type PermissionRequest struct {
	ID          string `json:"id"`
	SessionID   string `json:"session_id"`
	ToolName    string `json:"tool_name"`
	Description string `json:"description"`
	Action      string `json:"action"`
	Params      any    `json:"params"`
	Path        string `json:"path"`
}

type PermissionResponse struct {
	Request PermissionRequest
	Granted bool
}

const (
	EventPermissionRequested pubsub.EventType = "permission_requested"
	EventPermissionGranted   pubsub.EventType = "permission_granted"
	EventPermissionDenied    pubsub.EventType = "permission_denied"
	EventPermissionPersisted pubsub.EventType = "permission_persisted"
)

type Service interface {
	pubsub.Subscriber[PermissionRequest]
	SubscribeToResponseEvents(ctx context.Context) <-chan pubsub.Event[PermissionResponse]

	GrantPersistant(ctx context.Context, permission PermissionRequest)
	Grant(ctx context.Context, permission PermissionRequest)
	Deny(ctx context.Context, permission PermissionRequest)
	Request(ctx context.Context, opts CreatePermissionRequest) bool
	AutoApproveSession(ctx context.Context, sessionID string)
	IsAutoApproved(ctx context.Context, sessionID string) bool
}

type permissionService struct {
	broker         *pubsub.Broker[PermissionRequest]
	responseBroker *pubsub.Broker[PermissionResponse]

	sessionPermissions  map[string][]PermissionRequest
	pendingRequests     sync.Map
	autoApproveSessions map[string]bool
	mu                  sync.RWMutex
}

var globalPermissionService *permissionService

func InitService() error {
	if globalPermissionService != nil {
		return fmt.Errorf("permission service already initialized")
	}
	globalPermissionService = &permissionService{
		broker:              pubsub.NewBroker[PermissionRequest](),
		responseBroker:      pubsub.NewBroker[PermissionResponse](),
		sessionPermissions:  make(map[string][]PermissionRequest),
		autoApproveSessions: make(map[string]bool),
	}
	return nil
}

func GetService() *permissionService {
	if globalPermissionService == nil {
		panic("permission service not initialized. Call permission.InitService() first.")
	}
	return globalPermissionService
}

func (s *permissionService) GrantPersistant(ctx context.Context, permission PermissionRequest) {
	s.mu.Lock()
	s.sessionPermissions[permission.SessionID] = append(s.sessionPermissions[permission.SessionID], permission)
	s.mu.Unlock()

	respCh, ok := s.pendingRequests.Load(permission.ID)
	if ok {
		select {
		case respCh.(chan bool) <- true:
		case <-ctx.Done():
			slog.Warn("Context cancelled while sending grant persistent response", "request_id", permission.ID)
		}
	}
	s.responseBroker.Publish(EventPermissionPersisted, PermissionResponse{Request: permission, Granted: true})
}

func (s *permissionService) Grant(ctx context.Context, permission PermissionRequest) {
	respCh, ok := s.pendingRequests.Load(permission.ID)
	if ok {
		select {
		case respCh.(chan bool) <- true:
		case <-ctx.Done():
			slog.Warn("Context cancelled while sending grant response", "request_id", permission.ID)
		}
	}
	s.responseBroker.Publish(EventPermissionGranted, PermissionResponse{Request: permission, Granted: true})
}

func (s *permissionService) Deny(ctx context.Context, permission PermissionRequest) {
	respCh, ok := s.pendingRequests.Load(permission.ID)
	if ok {
		select {
		case respCh.(chan bool) <- false:
		case <-ctx.Done():
			slog.Warn("Context cancelled while sending deny response", "request_id", permission.ID)
		}
	}
	s.responseBroker.Publish(EventPermissionDenied, PermissionResponse{Request: permission, Granted: false})
}

func (s *permissionService) Request(ctx context.Context, opts CreatePermissionRequest) bool {
	s.mu.RLock()
	if s.autoApproveSessions[opts.SessionID] {
		s.mu.RUnlock()
		return true
	}

	requestPath := opts.Path
	if !filepath.IsAbs(requestPath) {
		requestPath = filepath.Join(config.WorkingDirectory(), requestPath)
	}
	requestPath = filepath.Clean(requestPath)

	if permissions, ok := s.sessionPermissions[opts.SessionID]; ok {
		for _, p := range permissions {
			storedPath := p.Path
			if !filepath.IsAbs(storedPath) {
				storedPath = filepath.Join(config.WorkingDirectory(), storedPath)
			}
			storedPath = filepath.Clean(storedPath)

			if p.ToolName == opts.ToolName && p.Action == opts.Action &&
				(requestPath == storedPath || strings.HasPrefix(requestPath, storedPath+string(filepath.Separator))) {
				s.mu.RUnlock()
				return true
			}
		}
	}
	s.mu.RUnlock()

	normalizedPath := opts.Path
	if !filepath.IsAbs(normalizedPath) {
		normalizedPath = filepath.Join(config.WorkingDirectory(), normalizedPath)
	}
	normalizedPath = filepath.Clean(normalizedPath)

	permissionReq := PermissionRequest{
		ID:          uuid.New().String(),
		Path:        normalizedPath,
		SessionID:   opts.SessionID,
		ToolName:    opts.ToolName,
		Description: opts.Description,
		Action:      opts.Action,
		Params:      opts.Params,
	}

	respCh := make(chan bool, 1)
	s.pendingRequests.Store(permissionReq.ID, respCh)
	defer s.pendingRequests.Delete(permissionReq.ID)

	s.broker.Publish(EventPermissionRequested, permissionReq)

	select {
	case resp := <-respCh:
		return resp
	case <-ctx.Done():
		slog.Warn("Permission request timed out or context cancelled", "request_id", permissionReq.ID, "tool", opts.ToolName)
		return false
	}
}

func (s *permissionService) AutoApproveSession(ctx context.Context, sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autoApproveSessions[sessionID] = true
}

func (s *permissionService) IsAutoApproved(ctx context.Context, sessionID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.autoApproveSessions[sessionID]
}

func (s *permissionService) Subscribe(ctx context.Context) <-chan pubsub.Event[PermissionRequest] {
	return s.broker.Subscribe(ctx)
}

func (s *permissionService) SubscribeToResponseEvents(ctx context.Context) <-chan pubsub.Event[PermissionResponse] {
	return s.responseBroker.Subscribe(ctx)
}

func GrantPersistant(ctx context.Context, permission PermissionRequest) {
	GetService().GrantPersistant(ctx, permission)
}

func Grant(ctx context.Context, permission PermissionRequest) {
	GetService().Grant(ctx, permission)
}

func Deny(ctx context.Context, permission PermissionRequest) {
	GetService().Deny(ctx, permission)
}

func Request(ctx context.Context, opts CreatePermissionRequest) bool {
	return GetService().Request(ctx, opts)
}

func AutoApproveSession(ctx context.Context, sessionID string) {
	GetService().AutoApproveSession(ctx, sessionID)
}

func IsAutoApproved(ctx context.Context, sessionID string) bool {
	return GetService().IsAutoApproved(ctx, sessionID)
}

func SubscribeToRequests(ctx context.Context) <-chan pubsub.Event[PermissionRequest] {
	return GetService().Subscribe(ctx)
}

func SubscribeToResponses(ctx context.Context) <-chan pubsub.Event[PermissionResponse] {
	return GetService().SubscribeToResponseEvents(ctx)
}
