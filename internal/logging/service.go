package logging

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/opencode-ai/opencode/internal/db"
	"github.com/opencode-ai/opencode/internal/pubsub"
)

// Log represents a log entry in the system
type Log struct {
	ID         string
	SessionID  string
	Timestamp  int64
	Level      string
	Message    string
	Attributes map[string]string
	CreatedAt  int64
}

// Service defines the interface for log operations
type Service interface {
	pubsub.Suscriber[Log]
	Create(ctx context.Context, log Log) error
	ListBySession(ctx context.Context, sessionID string) ([]Log, error)
	ListAll(ctx context.Context, limit int) ([]Log, error)
}

// service implements the Service interface
type service struct {
	*pubsub.Broker[Log]
	q db.Querier
}

// NewService creates a new logging service
func NewService(q db.Querier) Service {
	broker := pubsub.NewBroker[Log]()
	return &service{
		Broker: broker,
		q:      q,
	}
}

// Create adds a new log entry to the database
func (s *service) Create(ctx context.Context, log Log) error {
	// Generate ID if not provided
	if log.ID == "" {
		log.ID = uuid.New().String()
	}

	// Set timestamp if not provided
	if log.Timestamp == 0 {
		log.Timestamp = time.Now().Unix()
	}

	// Set created_at if not provided
	if log.CreatedAt == 0 {
		log.CreatedAt = time.Now().Unix()
	}

	// Convert attributes to JSON string
	var attributesJSON sql.NullString
	if len(log.Attributes) > 0 {
		attributesBytes, err := json.Marshal(log.Attributes)
		if err != nil {
			return err
		}
		attributesJSON = sql.NullString{
			String: string(attributesBytes),
			Valid:  true,
		}
	}

	// Convert session ID to SQL nullable string
	var sessionID sql.NullString
	if log.SessionID != "" {
		sessionID = sql.NullString{
			String: log.SessionID,
			Valid:  true,
		}
	}

	// Insert log into database
	err := s.q.CreateLog(ctx, db.CreateLogParams{
		ID:         log.ID,
		SessionID:  sessionID,
		Timestamp:  log.Timestamp,
		Level:      log.Level,
		Message:    log.Message,
		Attributes: attributesJSON,
		CreatedAt:  log.CreatedAt,
	})

	if err != nil {
		return err
	}

	// Publish event
	s.Publish(pubsub.CreatedEvent, log)
	return nil
}

// ListBySession retrieves logs for a specific session
func (s *service) ListBySession(ctx context.Context, sessionID string) ([]Log, error) {
	dbLogs, err := s.q.ListLogsBySession(ctx, sql.NullString{
		String: sessionID,
		Valid:  true,
	})
	if err != nil {
		return nil, err
	}

	logs := make([]Log, len(dbLogs))
	for i, dbLog := range dbLogs {
		logs[i] = s.fromDBItem(dbLog)
	}
	return logs, nil
}

// ListAll retrieves all logs with a limit
func (s *service) ListAll(ctx context.Context, limit int) ([]Log, error) {
	dbLogs, err := s.q.ListAllLogs(ctx, int64(limit))
	if err != nil {
		return nil, err
	}

	logs := make([]Log, len(dbLogs))
	for i, dbLog := range dbLogs {
		logs[i] = s.fromDBItem(dbLog)
	}
	return logs, nil
}

// fromDBItem converts a database log item to a Log struct
func (s *service) fromDBItem(item db.Log) Log {
	log := Log{
		ID:        item.ID,
		Timestamp: item.Timestamp,
		Level:     item.Level,
		Message:   item.Message,
		CreatedAt: item.CreatedAt,
	}

	// Convert session ID if valid
	if item.SessionID.Valid {
		log.SessionID = item.SessionID.String
	}

	// Parse attributes JSON if present
	if item.Attributes.Valid {
		attributes := make(map[string]string)
		if err := json.Unmarshal([]byte(item.Attributes.String), &attributes); err == nil {
			log.Attributes = attributes
		} else {
			// Initialize empty map if parsing fails
			log.Attributes = make(map[string]string)
		}
	} else {
		log.Attributes = make(map[string]string)
	}

	return log
}
