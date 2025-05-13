package history

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/sst/opencode/internal/db"
	"github.com/sst/opencode/internal/pubsub"
)

const (
	InitialVersion = "initial"
)

type File struct {
	ID        string
	SessionID string
	Path      string
	Content   string
	Version   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

const (
	EventFileCreated         pubsub.EventType = "history_file_created"
	EventFileVersionCreated  pubsub.EventType = "history_file_version_created"
	EventFileUpdated         pubsub.EventType = "history_file_updated"
	EventFileDeleted         pubsub.EventType = "history_file_deleted"
	EventSessionFilesDeleted pubsub.EventType = "history_session_files_deleted"
)

type Service interface {
	pubsub.Subscriber[File]

	Create(ctx context.Context, sessionID, path, content string) (File, error)
	CreateVersion(ctx context.Context, sessionID, path, content string) (File, error)
	Get(ctx context.Context, id string) (File, error)
	GetByPathAndVersion(ctx context.Context, sessionID, path, version string) (File, error)
	GetLatestByPathAndSession(ctx context.Context, path, sessionID string) (File, error)
	ListBySession(ctx context.Context, sessionID string) ([]File, error)
	ListLatestSessionFiles(ctx context.Context, sessionID string) ([]File, error)
	ListVersionsByPath(ctx context.Context, path string) ([]File, error)
	Update(ctx context.Context, file File) (File, error)
	Delete(ctx context.Context, id string) error
	DeleteSessionFiles(ctx context.Context, sessionID string) error
}

type service struct {
	db     *db.Queries
	sqlDB  *sql.DB
	broker *pubsub.Broker[File]
	mu     sync.RWMutex
}

var globalHistoryService *service

func InitService(sqlDatabase *sql.DB) error {
	if globalHistoryService != nil {
		return fmt.Errorf("history service already initialized")
	}
	queries := db.New(sqlDatabase)
	broker := pubsub.NewBroker[File]()

	globalHistoryService = &service{
		db:     queries,
		sqlDB:  sqlDatabase,
		broker: broker,
	}
	return nil
}

func GetService() Service {
	if globalHistoryService == nil {
		panic("history service not initialized. Call history.InitService() first.")
	}
	return globalHistoryService
}

func (s *service) Create(ctx context.Context, sessionID, path, content string) (File, error) {
	return s.createWithVersion(ctx, sessionID, path, content, InitialVersion, EventFileCreated)
}

func (s *service) CreateVersion(ctx context.Context, sessionID, path, content string) (File, error) {
	s.mu.RLock()
	files, err := s.db.ListFilesByPath(ctx, path)
	s.mu.RUnlock()

	if err != nil && err != sql.ErrNoRows {
		return File{}, fmt.Errorf("db.ListFilesByPath for next version: %w", err)
	}

	latestVersionNumber := 0
	if len(files) > 0 {
		// Sort to be absolutely sure about the latest version globally for this path
		slices.SortFunc(files, func(a, b db.File) int {
			if strings.HasPrefix(a.Version, "v") && strings.HasPrefix(b.Version, "v") {
				vA, _ := strconv.Atoi(a.Version[1:])
				vB, _ := strconv.Atoi(b.Version[1:])
				return vB - vA // Descending to get latest first
			}
			if a.Version == InitialVersion && b.Version != InitialVersion {
				return 1 // initial comes after vX
			}
			if b.Version == InitialVersion && a.Version != InitialVersion {
				return -1
			}
			return int(b.CreatedAt - a.CreatedAt) // Fallback to timestamp
		})

		latestFile := files[0]
		if strings.HasPrefix(latestFile.Version, "v") {
			vNum, parseErr := strconv.Atoi(latestFile.Version[1:])
			if parseErr == nil {
				latestVersionNumber = vNum
			}
		}
	}
	nextVersionStr := fmt.Sprintf("v%d", latestVersionNumber+1)
	return s.createWithVersion(ctx, sessionID, path, content, nextVersionStr, EventFileVersionCreated)
}

func (s *service) createWithVersion(ctx context.Context, sessionID, path, content, version string, eventType pubsub.EventType) (File, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	const maxRetries = 3
	var file File
	var err error

	for attempt := range maxRetries {
		tx, txErr := s.sqlDB.BeginTx(ctx, nil)
		if txErr != nil {
			return File{}, fmt.Errorf("failed to begin transaction: %w", txErr)
		}
		qtx := s.db.WithTx(tx)

		dbFile, createErr := qtx.CreateFile(ctx, db.CreateFileParams{
			ID:        uuid.New().String(),
			SessionID: sessionID,
			Path:      path,
			Content:   content,
			Version:   version,
		})

		if createErr != nil {
			if rbErr := tx.Rollback(); rbErr != nil {
				slog.Error("Failed to rollback transaction on create error", "error", rbErr)
			}
			if strings.Contains(createErr.Error(), "UNIQUE constraint failed: files.path, files.session_id, files.version") {
				if attempt < maxRetries-1 {
					slog.Warn("Unique constraint violation for file version, retrying with incremented version", "path", path, "session", sessionID, "attempted_version", version, "attempt", attempt+1)
					// Increment version string like v1, v2, v3...
					if strings.HasPrefix(version, "v") {
						numPart := version[1:]
						num, parseErr := strconv.Atoi(numPart)
						if parseErr == nil {
							version = fmt.Sprintf("v%d", num+1)
							continue // Retry with new version
						}
					}
					// Fallback if version is not "vX" or parsing failed
					version = fmt.Sprintf("%s-retry%d", version, attempt+1)
					continue
				}
			}
			return File{}, fmt.Errorf("db.CreateFile within transaction: %w", createErr)
		}

		if commitErr := tx.Commit(); commitErr != nil {
			return File{}, fmt.Errorf("failed to commit transaction: %w", commitErr)
		}

		file = s.fromDBItem(dbFile)
		s.broker.Publish(eventType, file)
		return file, nil // Success
	}

	return File{}, fmt.Errorf("failed to create file after %d retries due to version conflicts: %w", maxRetries, err)
}

func (s *service) Get(ctx context.Context, id string) (File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dbFile, err := s.db.GetFile(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return File{}, fmt.Errorf("file with ID '%s' not found", id)
		}
		return File{}, fmt.Errorf("db.GetFile: %w", err)
	}
	return s.fromDBItem(dbFile), nil
}

func (s *service) GetByPathAndVersion(ctx context.Context, sessionID, path, version string) (File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// sqlc doesn't directly support GetyByPathAndVersionAndSession
	// We list and filter. This could be optimized with a custom query if performance is an issue.
	allFilesForPath, err := s.db.ListFilesByPath(ctx, path)
	if err != nil {
		return File{}, fmt.Errorf("db.ListFilesByPath for GetByPathAndVersion: %w", err)
	}

	for _, dbFile := range allFilesForPath {
		if dbFile.SessionID == sessionID && dbFile.Version == version {
			return s.fromDBItem(dbFile), nil
		}
	}
	return File{}, fmt.Errorf("file not found for session '%s', path '%s', version '%s'", sessionID, path, version)
}

func (s *service) GetLatestByPathAndSession(ctx context.Context, path, sessionID string) (File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// GetFileByPathAndSession in sqlc already orders by created_at DESC and takes LIMIT 1
	dbFile, err := s.db.GetFileByPathAndSession(ctx, db.GetFileByPathAndSessionParams{
		Path:      path,
		SessionID: sessionID,
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return File{}, fmt.Errorf("no file found for path '%s' in session '%s'", path, sessionID)
		}
		return File{}, fmt.Errorf("db.GetFileByPathAndSession: %w", err)
	}
	return s.fromDBItem(dbFile), nil
}

func (s *service) ListBySession(ctx context.Context, sessionID string) ([]File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dbFiles, err := s.db.ListFilesBySession(ctx, sessionID) // Assumes this orders by created_at ASC
	if err != nil {
		return nil, fmt.Errorf("db.ListFilesBySession: %w", err)
	}
	files := make([]File, len(dbFiles))
	for i, dbF := range dbFiles {
		files[i] = s.fromDBItem(dbF)
	}
	return files, nil
}

func (s *service) ListLatestSessionFiles(ctx context.Context, sessionID string) ([]File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dbFiles, err := s.db.ListLatestSessionFiles(ctx, sessionID) // Uses the specific sqlc query
	if err != nil {
		return nil, fmt.Errorf("db.ListLatestSessionFiles: %w", err)
	}
	files := make([]File, len(dbFiles))
	for i, dbF := range dbFiles {
		files[i] = s.fromDBItem(dbF)
	}
	return files, nil
}

func (s *service) ListVersionsByPath(ctx context.Context, path string) ([]File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dbFiles, err := s.db.ListFilesByPath(ctx, path) // sqlc query orders by created_at DESC
	if err != nil {
		return nil, fmt.Errorf("db.ListFilesByPath: %w", err)
	}
	files := make([]File, len(dbFiles))
	for i, dbF := range dbFiles {
		files[i] = s.fromDBItem(dbF)
	}
	return files, nil
}

func (s *service) Update(ctx context.Context, file File) (File, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if file.ID == "" {
		return File{}, fmt.Errorf("cannot update file with empty ID")
	}
	// UpdatedAt is handled by DB trigger
	dbFile, err := s.db.UpdateFile(ctx, db.UpdateFileParams{
		ID:      file.ID,
		Content: file.Content,
		Version: file.Version,
	})
	if err != nil {
		return File{}, fmt.Errorf("db.UpdateFile: %w", err)
	}
	updatedFile := s.fromDBItem(dbFile)
	s.broker.Publish(EventFileUpdated, updatedFile)
	return updatedFile, nil
}

func (s *service) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	fileToPublish, err := s.getServiceForPublish(ctx, id) // Use internal method with appropriate locking
	s.mu.Unlock()

	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			slog.Warn("Attempted to delete non-existent file history", "id", id)
			return nil // Or return specific error if needed
		}
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	err = s.db.DeleteFile(ctx, id)
	if err != nil {
		return fmt.Errorf("db.DeleteFile: %w", err)
	}
	if fileToPublish != nil {
		s.broker.Publish(EventFileDeleted, *fileToPublish)
	}
	return nil
}

func (s *service) getServiceForPublish(ctx context.Context, id string) (*File, error) {
	// Assumes outer lock is NOT held or caller manages it.
	// For GetFile, it has its own RLock.
	dbFile, err := s.db.GetFile(ctx, id)
	if err != nil {
		return nil, err
	}
	file := s.fromDBItem(dbFile)
	return &file, nil
}

func (s *service) DeleteSessionFiles(ctx context.Context, sessionID string) error {
	s.mu.Lock() // Lock for the entire operation
	defer s.mu.Unlock()

	// Get files first for publishing events
	filesToDelete, err := s.db.ListFilesBySession(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("db.ListFilesBySession for deletion: %w", err)
	}

	err = s.db.DeleteSessionFiles(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("db.DeleteSessionFiles: %w", err)
	}

	for _, dbFile := range filesToDelete {
		file := s.fromDBItem(dbFile)
		s.broker.Publish(EventFileDeleted, file) // Individual delete events
	}
	return nil
}

func (s *service) Subscribe(ctx context.Context) <-chan pubsub.Event[File] {
	return s.broker.Subscribe(ctx)
}

func (s *service) fromDBItem(item db.File) File {
	return File{
		ID:        item.ID,
		SessionID: item.SessionID,
		Path:      item.Path,
		Content:   item.Content,
		Version:   item.Version,
		CreatedAt: time.UnixMilli(item.CreatedAt * 1000),
		UpdatedAt: time.UnixMilli(item.UpdatedAt * 1000),
	}
}

func Create(ctx context.Context, sessionID, path, content string) (File, error) {
	return GetService().Create(ctx, sessionID, path, content)
}

func CreateVersion(ctx context.Context, sessionID, path, content string) (File, error) {
	return GetService().CreateVersion(ctx, sessionID, path, content)
}

func Get(ctx context.Context, id string) (File, error) {
	return GetService().Get(ctx, id)
}

func GetByPathAndVersion(ctx context.Context, sessionID, path, version string) (File, error) {
	return GetService().GetByPathAndVersion(ctx, sessionID, path, version)
}

func GetLatestByPathAndSession(ctx context.Context, path, sessionID string) (File, error) {
	return GetService().GetLatestByPathAndSession(ctx, path, sessionID)
}

func ListBySession(ctx context.Context, sessionID string) ([]File, error) {
	return GetService().ListBySession(ctx, sessionID)
}

func ListLatestSessionFiles(ctx context.Context, sessionID string) ([]File, error) {
	return GetService().ListLatestSessionFiles(ctx, sessionID)
}

func ListVersionsByPath(ctx context.Context, path string) ([]File, error) {
	return GetService().ListVersionsByPath(ctx, path)
}

func Update(ctx context.Context, file File) (File, error) {
	return GetService().Update(ctx, file)
}

func Delete(ctx context.Context, id string) error {
	return GetService().Delete(ctx, id)
}

func DeleteSessionFiles(ctx context.Context, sessionID string) error {
	return GetService().DeleteSessionFiles(ctx, sessionID)
}

func Subscribe(ctx context.Context) <-chan pubsub.Event[File] {
	return GetService().Subscribe(ctx)
}
