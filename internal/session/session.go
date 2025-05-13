package session

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/sst/opencode/internal/db"
	"github.com/sst/opencode/internal/pubsub"
)

type Session struct {
	ID               string
	ParentSessionID  string
	Title            string
	MessageCount     int64
	PromptTokens     int64
	CompletionTokens int64
	Cost             float64
	Summary          string
	SummarizedAt     int64
	CreatedAt        int64
	UpdatedAt        int64
}

const (
	EventSessionCreated pubsub.EventType = "session_created"
	EventSessionUpdated pubsub.EventType = "session_updated"
	EventSessionDeleted pubsub.EventType = "session_deleted"
)

type Service interface {
	pubsub.Subscriber[Session]

	Create(ctx context.Context, title string) (Session, error)
	CreateTaskSession(ctx context.Context, toolCallID, parentSessionID, title string) (Session, error)
	Get(ctx context.Context, id string) (Session, error)
	List(ctx context.Context) ([]Session, error)
	Update(ctx context.Context, session Session) (Session, error)
	Delete(ctx context.Context, id string) error
}

type service struct {
	db     *db.Queries
	broker *pubsub.Broker[Session]
	mu     sync.RWMutex
}

var globalSessionService *service

func InitService(dbConn *sql.DB) error {
	if globalSessionService != nil {
		return fmt.Errorf("session service already initialized")
	}
	queries := db.New(dbConn)
	broker := pubsub.NewBroker[Session]()

	globalSessionService = &service{
		db:     queries,
		broker: broker,
	}
	return nil
}

func GetService() Service {
	if globalSessionService == nil {
		panic("session service not initialized. Call session.InitService() first.")
	}
	return globalSessionService
}

func (s *service) Create(ctx context.Context, title string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if title == "" {
		title = "New Session - " + time.Now().Format("2006-01-02 15:04:05")
	}

	dbSessParams := db.CreateSessionParams{
		ID:    uuid.New().String(),
		Title: title,
	}
	dbSession, err := s.db.CreateSession(ctx, dbSessParams)
	if err != nil {
		return Session{}, fmt.Errorf("db.CreateSession: %w", err)
	}

	session := s.fromDBItem(dbSession)
	s.broker.Publish(EventSessionCreated, session)
	return session, nil
}

func (s *service) CreateTaskSession(ctx context.Context, toolCallID, parentSessionID, title string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if title == "" {
		title = "Task Session - " + time.Now().Format("2006-01-02 15:04:05")
	}
	if toolCallID == "" {
		toolCallID = uuid.New().String()
	}

	dbSessParams := db.CreateSessionParams{
		ID:              toolCallID,
		ParentSessionID: sql.NullString{String: parentSessionID, Valid: parentSessionID != ""},
		Title:           title,
	}
	dbSession, err := s.db.CreateSession(ctx, dbSessParams)
	if err != nil {
		return Session{}, fmt.Errorf("db.CreateTaskSession: %w", err)
	}
	session := s.fromDBItem(dbSession)
	s.broker.Publish(EventSessionCreated, session)
	return session, nil
}

func (s *service) Get(ctx context.Context, id string) (Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dbSession, err := s.db.GetSessionByID(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return Session{}, fmt.Errorf("session ID '%s' not found", id)
		}
		return Session{}, fmt.Errorf("db.GetSessionByID: %w", err)
	}
	return s.fromDBItem(dbSession), nil
}

func (s *service) List(ctx context.Context) ([]Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dbSessions, err := s.db.ListSessions(ctx)
	if err != nil {
		return nil, fmt.Errorf("db.ListSessions: %w", err)
	}
	sessions := make([]Session, len(dbSessions))
	for i, dbSess := range dbSessions {
		sessions[i] = s.fromDBItem(dbSess)
	}
	return sessions, nil
}

func (s *service) Update(ctx context.Context, session Session) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if session.ID == "" {
		return Session{}, fmt.Errorf("cannot update session with empty ID")
	}
	params := db.UpdateSessionParams{
		ID:               session.ID,
		Title:            session.Title,
		PromptTokens:     session.PromptTokens,
		CompletionTokens: session.CompletionTokens,
		Cost:             session.Cost,
		Summary:          sql.NullString{String: session.Summary, Valid: session.Summary != ""},
		SummarizedAt:     sql.NullInt64{Int64: session.SummarizedAt, Valid: session.SummarizedAt > 0},
	}
	dbSession, err := s.db.UpdateSession(ctx, params)
	if err != nil {
		return Session{}, fmt.Errorf("db.UpdateSession: %w", err)
	}
	updatedSession := s.fromDBItem(dbSession)
	s.broker.Publish(EventSessionUpdated, updatedSession)
	return updatedSession, nil
}

func (s *service) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	dbSess, err := s.db.GetSessionByID(ctx, id)
	if err != nil {
		s.mu.Unlock()
		if err == sql.ErrNoRows {
			return fmt.Errorf("session ID '%s' not found for deletion", id)
		}
		return fmt.Errorf("db.GetSessionByID before delete: %w", err)
	}
	sessionToPublish := s.fromDBItem(dbSess)
	s.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	err = s.db.DeleteSession(ctx, id)
	if err != nil {
		return fmt.Errorf("db.DeleteSession: %w", err)
	}
	s.broker.Publish(EventSessionDeleted, sessionToPublish)
	return nil
}

func (s *service) Subscribe(ctx context.Context) <-chan pubsub.Event[Session] {
	return s.broker.Subscribe(ctx)
}

func (s *service) fromDBItem(item db.Session) Session {
	return Session{
		ID:               item.ID,
		ParentSessionID:  item.ParentSessionID.String,
		Title:            item.Title,
		MessageCount:     item.MessageCount,
		PromptTokens:     item.PromptTokens,
		CompletionTokens: item.CompletionTokens,
		Cost:             item.Cost,
		Summary:          item.Summary.String,
		SummarizedAt:     item.SummarizedAt.Int64,
		CreatedAt:        item.CreatedAt * 1000,
		UpdatedAt:        item.UpdatedAt * 1000,
	}
}

func Create(ctx context.Context, title string) (Session, error) {
	return GetService().Create(ctx, title)
}

func CreateTaskSession(ctx context.Context, toolCallID, parentSessionID, title string) (Session, error) {
	return GetService().CreateTaskSession(ctx, toolCallID, parentSessionID, title)
}

func Get(ctx context.Context, id string) (Session, error) {
	return GetService().Get(ctx, id)
}

func List(ctx context.Context) ([]Session, error) {
	return GetService().List(ctx)
}

func Update(ctx context.Context, session Session) (Session, error) {
	return GetService().Update(ctx, session)
}

func Delete(ctx context.Context, id string) error {
	return GetService().Delete(ctx, id)
}

func Subscribe(ctx context.Context) <-chan pubsub.Event[Session] {
	return GetService().Subscribe(ctx)
}
