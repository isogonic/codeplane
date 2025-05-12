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
	"github.com/opencode-ai/opencode/internal/db"
	"github.com/opencode-ai/opencode/internal/pubsub"
)

type Log struct {
	ID         string
	SessionID  string
	Timestamp  int64
	Level      string
	Message    string
	Attributes map[string]string
	CreatedAt  int64
}

const (
	EventLogCreated pubsub.EventType = "log_created"
)

type Service interface {
	pubsub.Subscriber[Log]

	Create(ctx context.Context, log Log) error
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

func (s *service) Create(ctx context.Context, log Log) error {
	if log.ID == "" {
		log.ID = uuid.New().String()
	}
	if log.Timestamp == 0 {
		log.Timestamp = time.Now().UnixMilli()
	}
	if log.CreatedAt == 0 {
		log.CreatedAt = time.Now().UnixMilli()
	}
	if log.Level == "" {
		log.Level = "info"
	}

	var attributesJSON sql.NullString
	if len(log.Attributes) > 0 {
		attributesBytes, err := json.Marshal(log.Attributes)
		if err != nil {
			return fmt.Errorf("failed to marshal log attributes: %w", err)
		}
		attributesJSON = sql.NullString{String: string(attributesBytes), Valid: true}
	}

	err := s.db.CreateLog(ctx, db.CreateLogParams{
		ID:         log.ID,
		SessionID:  sql.NullString{String: log.SessionID, Valid: log.SessionID != ""},
		Timestamp:  log.Timestamp / 1000,
		Level:      log.Level,
		Message:    log.Message,
		Attributes: attributesJSON,
		CreatedAt:  log.CreatedAt / 1000,
	})
	if err != nil {
		return fmt.Errorf("db.CreateLog: %w", err)
	}

	s.broker.Publish(EventLogCreated, log)
	return nil
}

func (s *service) ListBySession(ctx context.Context, sessionID string) ([]Log, error) {
	dbLogs, err := s.db.ListLogsBySession(ctx, sql.NullString{String: sessionID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("db.ListLogsBySession: %w", err)
	}
	return s.fromDBItems(dbLogs)
}

func (s *service) ListAll(ctx context.Context, limit int) ([]Log, error) {
	dbLogs, err := s.db.ListAllLogs(ctx, int64(limit))
	if err != nil {
		return nil, fmt.Errorf("db.ListAllLogs: %w", err)
	}
	return s.fromDBItems(dbLogs)
}

func (s *service) Subscribe(ctx context.Context) <-chan pubsub.Event[Log] {
	return s.broker.Subscribe(ctx)
}

func (s *service) fromDBItems(items []db.Log) ([]Log, error) {
	logs := make([]Log, len(items))
	for i, item := range items {
		log := Log{
			ID:        item.ID,
			SessionID: item.SessionID.String,
			Timestamp: item.Timestamp * 1000,
			Level:     item.Level,
			Message:   item.Message,
			CreatedAt: item.CreatedAt * 1000,
		}
		if item.Attributes.Valid && item.Attributes.String != "" {
			if err := json.Unmarshal([]byte(item.Attributes.String), &log.Attributes); err != nil {
				slog.Error("Failed to unmarshal log attributes", "log_id", item.ID, "error", err)
				log.Attributes = make(map[string]string)
			}
		} else {
			log.Attributes = make(map[string]string)
		}
		logs[i] = log
	}
	return logs, nil
}

func Create(ctx context.Context, log Log) error {
	return GetService().Create(ctx, log)
}

func ListBySession(ctx context.Context, sessionID string) ([]Log, error) {
	return GetService().ListBySession(ctx, sessionID)
}

func ListAll(ctx context.Context, limit int) ([]Log, error) {
	return GetService().ListAll(ctx, limit)
}

func SubscribeToEvents(ctx context.Context) <-chan pubsub.Event[Log] {
	return GetService().Subscribe(ctx)
}

type slogWriter struct{}

func (sw *slogWriter) Write(p []byte) (n int, err error) {
	// Example: time=2024-05-09T12:34:56.789-05:00 level=INFO msg="User request" session=xyz foo=bar
	d := logfmt.NewDecoder(bytes.NewReader(p))
	for d.ScanRecord() {
		logEntry := Log{
			Attributes: make(map[string]string),
		}
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
						logEntry.Timestamp = time.Now().UnixMilli()
						hasTimestamp = true
						continue
					}
				}
				logEntry.Timestamp = parsedTime.UnixMilli()
				hasTimestamp = true
			case "level":
				logEntry.Level = strings.ToLower(value)
			case "msg", "message":
				logEntry.Message = value
			case "session_id", "session", "sid":
				logEntry.SessionID = value
			default:
				logEntry.Attributes[key] = value
			}
		}

		if d.Err() != nil {
			return len(p), fmt.Errorf("logfmt.ScanRecord: %w", d.Err())
		}

		if !hasTimestamp {
			logEntry.Timestamp = time.Now().UnixMilli()
		}

		// Create log entry via the service (non-blocking or handle error appropriately)
		// Using context.Background() as this is a low-level logging write.
		go func(le Log) { // Run in a goroutine to avoid blocking slog
			if globalLoggingService == nil {
				// If the logging service is not initialized, log the message to stderr
				// fmt.Fprintf(os.Stderr, "ERROR [logging.slogWriter]: logging service not initialized\n")
				return
			}
			if err := Create(context.Background(), le); err != nil {
				// Log internal error using a more primitive logger to avoid loops
				fmt.Fprintf(os.Stderr, "ERROR [logging.slogWriter]: failed to persist log: %v\n", err)
			}
		}(logEntry)
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
