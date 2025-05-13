package logging

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-logfmt/logfmt"
	"github.com/google/uuid"
	"github.com/sst/opencode/internal/db"
	"github.com/sst/opencode/internal/pubsub"
)

type Log struct {
	ID         string
	SessionID  string
	Timestamp  time.Time
	Level      string
	Message    string
	Attributes map[string]string
	CreatedAt  time.Time
}

const (
	EventLogCreated pubsub.EventType = "log_created"
)

type Service interface {
	pubsub.Subscriber[Log]

	Create(ctx context.Context, timestamp time.Time, level, message string, attributes map[string]string, sessionID string) error
	ListBySession(ctx context.Context, sessionID string) ([]Log, error)
	ListAll(ctx context.Context, limit int) ([]Log, error)
}

type service struct {
	db     *db.Queries
	broker *pubsub.Broker[Log]
}

var globalLoggingService *service

func InitService(dbConn *sql.DB) error {
	if globalLoggingService != nil {
		return fmt.Errorf("logging service already initialized")
	}
	queries := db.New(dbConn)
	broker := pubsub.NewBroker[Log]()

	globalLoggingService = &service{
		db:     queries,
		broker: broker,
	}
	return nil
}

func GetService() Service {
	if globalLoggingService == nil {
		panic("logging service not initialized. Call logging.InitService() first.")
	}
	return globalLoggingService
}

func (s *service) Create(ctx context.Context, timestamp time.Time, level, message string, attributes map[string]string, sessionID string) error {
	if level == "" {
		level = "info"
	}

	var attributesJSON sql.NullString
	if len(attributes) > 0 {
		attributesBytes, err := json.Marshal(attributes)
		if err != nil {
			return fmt.Errorf("failed to marshal log attributes: %w", err)
		}
		attributesJSON = sql.NullString{String: string(attributesBytes), Valid: true}
	}

	dbLog, err := s.db.CreateLog(ctx, db.CreateLogParams{
		ID:         uuid.New().String(),
		SessionID:  sql.NullString{String: sessionID, Valid: sessionID != ""},
		Timestamp:  timestamp.UTC().Format(time.RFC3339Nano),
		Level:      level,
		Message:    message,
		Attributes: attributesJSON,
	})

	if err != nil {
		return fmt.Errorf("db.CreateLog: %w", err)
	}

	log := s.fromDBItem(dbLog)
	s.broker.Publish(EventLogCreated, log)
	return nil
}

func (s *service) ListBySession(ctx context.Context, sessionID string) ([]Log, error) {
	dbLogs, err := s.db.ListLogsBySession(ctx, sql.NullString{String: sessionID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("db.ListLogsBySession: %w", err)
	}

	logs := make([]Log, len(dbLogs))
	for i, dbSess := range dbLogs {
		logs[i] = s.fromDBItem(dbSess)
	}
	return logs, nil
}

func (s *service) ListAll(ctx context.Context, limit int) ([]Log, error) {
	dbLogs, err := s.db.ListAllLogs(ctx, int64(limit))
	if err != nil {
		return nil, fmt.Errorf("db.ListAllLogs: %w", err)
	}
	logs := make([]Log, len(dbLogs))
	for i, dbSess := range dbLogs {
		logs[i] = s.fromDBItem(dbSess)
	}
	return logs, nil
}

func (s *service) Subscribe(ctx context.Context) <-chan pubsub.Event[Log] {
	return s.broker.Subscribe(ctx)
}

func (s *service) fromDBItem(item db.Log) Log {
	log := Log{
		ID:        item.ID,
		SessionID: item.SessionID.String,
		Level:     item.Level,
		Message:   item.Message,
	}

	// Parse timestamp from ISO string
	timestamp, err := time.Parse(time.RFC3339Nano, item.Timestamp)
	if err == nil {
		log.Timestamp = timestamp
	} else {
		log.Timestamp = time.Now() // Fallback
	}

	// Parse created_at from ISO string
	createdAt, err := time.Parse(time.RFC3339Nano, item.CreatedAt)
	if err == nil {
		log.CreatedAt = createdAt
	} else {
		log.CreatedAt = time.Now() // Fallback
	}

	if item.Attributes.Valid && item.Attributes.String != "" {
		if err := json.Unmarshal([]byte(item.Attributes.String), &log.Attributes); err != nil {
			slog.Error("Failed to unmarshal log attributes", "log_id", item.ID, "error", err)
			log.Attributes = make(map[string]string)
		}
	} else {
		log.Attributes = make(map[string]string)
	}

	return log
}

func Create(ctx context.Context, timestamp time.Time, level, message string, attributes map[string]string, sessionID string) error {
	return GetService().Create(ctx, timestamp, level, message, attributes, sessionID)
}

func ListBySession(ctx context.Context, sessionID string) ([]Log, error) {
	return GetService().ListBySession(ctx, sessionID)
}

func ListAll(ctx context.Context, limit int) ([]Log, error) {
	return GetService().ListAll(ctx, limit)
}

func Subscribe(ctx context.Context) <-chan pubsub.Event[Log] {
	return GetService().Subscribe(ctx)
}

type slogWriter struct{}

func (sw *slogWriter) Write(p []byte) (n int, err error) {
	// Example: time=2024-05-09T12:34:56.789-05:00 level=INFO msg="User request" session=xyz foo=bar
	d := logfmt.NewDecoder(bytes.NewReader(p))
	for d.ScanRecord() {
		var timestamp time.Time
		var level string
		var message string
		var sessionID string
		var attributes map[string]string

		attributes = make(map[string]string)
		hasTimestamp := false

		for d.ScanKeyval() {
			key := string(d.Key())
			value := string(d.Value())

			switch key {
			case "time":
				parsedTime, timeErr := time.Parse(time.RFC3339Nano, value)
				if timeErr != nil {
					parsedTime, timeErr = time.Parse(time.RFC3339, value)
					if timeErr != nil {
						slog.Error("Failed to parse time in slog writer", "value", value, "error", timeErr)
						timestamp = time.Now().UTC()
						hasTimestamp = true
						continue
					}
				}
				timestamp = parsedTime
				hasTimestamp = true
			case "level":
				level = strings.ToLower(value)
			case "msg", "message":
				message = value
			case "session_id":
				sessionID = value
			default:
				attributes[key] = value
			}
		}
		if d.Err() != nil {
			return len(p), fmt.Errorf("logfmt.ScanRecord: %w", d.Err())
		}

		if !hasTimestamp {
			timestamp = time.Now()
		}

		// Create log entry via the service (non-blocking or handle error appropriately)
		// Using context.Background() as this is a low-level logging write.
		go func(timestamp time.Time, level, message string, attributes map[string]string, sessionID string) { // Run in a goroutine to avoid blocking slog
			if globalLoggingService == nil {
				// If the logging service is not initialized, log the message to stderr
				// fmt.Fprintf(os.Stderr, "ERROR [logging.slogWriter]: logging service not initialized\n")
				return
			}
			if err := Create(context.Background(), timestamp, level, message, attributes, sessionID); err != nil {
				// Log internal error using a more primitive logger to avoid loops
				fmt.Fprintf(os.Stderr, "ERROR [logging.slogWriter]: failed to persist log: %v\n", err)
			}
		}(timestamp, level, message, attributes, sessionID)
	}
	if d.Err() != nil {
		return len(p), fmt.Errorf("logfmt.ScanRecord final: %w", d.Err())
	}
	return len(p), nil
}

func NewSlogWriter() io.Writer {
	return &slogWriter{}
}

// RecoverPanic is a common function to handle panics gracefully.
// It logs the error, creates a panic log file with stack trace,
// and executes an optional cleanup function.
func RecoverPanic(name string, cleanup func()) {
	if r := recover(); r != nil {
		errorMsg := fmt.Sprintf("Panic in %s: %v", name, r)
		// Use slog directly here, as our service might be the one panicking.
		slog.Error(errorMsg)
		// status.Error(errorMsg)

		timestamp := time.Now().Format("20060102-150405")
		filename := fmt.Sprintf("opencode-panic-%s-%s.log", name, timestamp)

		file, err := os.Create(filename)
		if err != nil {
			errMsg := fmt.Sprintf("Failed to create panic log file '%s': %v", filename, err)
			slog.Error(errMsg)
			// status.Error(errMsg)
		} else {
			defer file.Close()
			fmt.Fprintf(file, "Panic in %s: %v\n\n", name, r)
			fmt.Fprintf(file, "Time: %s\n\n", time.Now().Format(time.RFC3339))
			fmt.Fprintf(file, "Stack Trace:\n%s\n", string(debug.Stack())) // Capture stack trace
			infoMsg := fmt.Sprintf("Panic details written to %s", filename)
			slog.Info(infoMsg)
			// status.Info(infoMsg)
		}

		if cleanup != nil {
			cleanup()
		}
	}
}
