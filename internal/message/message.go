package message

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/opencode-ai/opencode/internal/db"
	"github.com/opencode-ai/opencode/internal/llm/models"
	"github.com/opencode-ai/opencode/internal/pubsub"
)

const (
	EventMessageCreated pubsub.EventType = "message_created"
	EventMessageUpdated pubsub.EventType = "message_updated"
	EventMessageDeleted pubsub.EventType = "message_deleted"
)

type CreateMessageParams struct {
	Role  MessageRole
	Parts []ContentPart
	Model models.ModelID
}

type Service interface {
	pubsub.Subscriber[Message]

	Create(ctx context.Context, sessionID string, params CreateMessageParams) (Message, error)
	Update(ctx context.Context, message Message) (Message, error)
	Get(ctx context.Context, id string) (Message, error)
	List(ctx context.Context, sessionID string) ([]Message, error)
	ListAfter(ctx context.Context, sessionID string, timestampMillis int64) ([]Message, error)
	Delete(ctx context.Context, id string) error
	DeleteSessionMessages(ctx context.Context, sessionID string) error
}

type service struct {
	db     *db.Queries
	broker *pubsub.Broker[Message]
	mu     sync.RWMutex
}

var globalMessageService *service

func InitService(dbConn *sql.DB) error {
	if globalMessageService != nil {
		return fmt.Errorf("message service already initialized")
	}
	queries := db.New(dbConn)
	broker := pubsub.NewBroker[Message]()

	globalMessageService = &service{
		db:     queries,
		broker: broker,
	}
	return nil
}

func GetService() Service {
	if globalMessageService == nil {
		panic("message service not initialized. Call message.InitService() first.")
	}
	return globalMessageService
}

func (s *service) Create(ctx context.Context, sessionID string, params CreateMessageParams) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	isFinished := false
	for _, p := range params.Parts {
		if _, ok := p.(Finish); ok {
			isFinished = true
			break
		}
	}
	if params.Role == User && !isFinished {
		params.Parts = append(params.Parts, Finish{Reason: FinishReasonEndTurn, Time: time.Now().UnixMilli()})
	}

	partsJSON, err := marshallParts(params.Parts)
	if err != nil {
		return Message{}, fmt.Errorf("failed to marshal message parts: %w", err)
	}

	dbMsgParams := db.CreateMessageParams{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      string(params.Role),
		Parts:     string(partsJSON),
		Model:     sql.NullString{String: string(params.Model), Valid: params.Model != ""},
	}

	dbMessage, err := s.db.CreateMessage(ctx, dbMsgParams)
	if err != nil {
		return Message{}, fmt.Errorf("db.CreateMessage: %w", err)
	}

	message, err := s.fromDBItem(dbMessage)
	if err != nil {
		return Message{}, fmt.Errorf("failed to convert DB message: %w", err)
	}

	s.broker.Publish(EventMessageCreated, message)
	return message, nil
}

func (s *service) Update(ctx context.Context, message Message) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if message.ID == "" {
		return Message{}, fmt.Errorf("cannot update message with empty ID")
	}

	partsJSON, err := marshallParts(message.Parts)
	if err != nil {
		return Message{}, fmt.Errorf("failed to marshal message parts for update: %w", err)
	}

	var dbFinishedAt sql.NullInt64
	finishPart := message.FinishPart()
	if finishPart != nil && finishPart.Time > 0 {
		dbFinishedAt = sql.NullInt64{
			Int64: finishPart.Time / 1000, // Convert Milliseconds from Go struct to Seconds for DB
			Valid: true,
		}
	}

	// UpdatedAt is handled by the DB trigger (strftime('%s', 'now'))
	err = s.db.UpdateMessage(ctx, db.UpdateMessageParams{
		ID:         message.ID,
		Parts:      string(partsJSON),
		FinishedAt: dbFinishedAt,
	})
	if err != nil {
		return Message{}, fmt.Errorf("db.UpdateMessage: %w", err)
	}

	dbUpdatedMessage, err := s.db.GetMessage(ctx, message.ID)
	if err != nil {
		return Message{}, fmt.Errorf("failed to fetch message after update: %w", err)
	}
	updatedMessage, err := s.fromDBItem(dbUpdatedMessage)
	if err != nil {
		return Message{}, fmt.Errorf("failed to convert updated DB message: %w", err)
	}

	s.broker.Publish(EventMessageUpdated, updatedMessage)
	return updatedMessage, nil
}

func (s *service) Get(ctx context.Context, id string) (Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dbMessage, err := s.db.GetMessage(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return Message{}, fmt.Errorf("message with ID '%s' not found", id)
		}
		return Message{}, fmt.Errorf("db.GetMessage: %w", err)
	}
	return s.fromDBItem(dbMessage)
}

func (s *service) List(ctx context.Context, sessionID string) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dbMessages, err := s.db.ListMessagesBySession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("db.ListMessagesBySession: %w", err)
	}
	messages := make([]Message, len(dbMessages))
	for i, dbMsg := range dbMessages {
		msg, convErr := s.fromDBItem(dbMsg)
		if convErr != nil {
			return nil, fmt.Errorf("failed to convert DB message at index %d: %w", i, convErr)
		}
		messages[i] = msg
	}
	return messages, nil
}

func (s *service) ListAfter(ctx context.Context, sessionID string, timestampMillis int64) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	timestampSeconds := timestampMillis / 1000 // Convert to seconds for DB query

	dbMessages, err := s.db.ListMessagesBySessionAfter(ctx, db.ListMessagesBySessionAfterParams{
		SessionID: sessionID,
		CreatedAt: timestampSeconds,
	})
	if err != nil {
		return nil, fmt.Errorf("db.ListMessagesBySessionAfter: %w", err)
	}
	messages := make([]Message, len(dbMessages))
	for i, dbMsg := range dbMessages {
		msg, convErr := s.fromDBItem(dbMsg)
		if convErr != nil {
			return nil, fmt.Errorf("failed to convert DB message at index %d (ListAfter): %w", i, convErr)
		}
		messages[i] = msg
	}
	return messages, nil
}

func (s *service) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	messageToPublish, err := s.getServiceForPublish(ctx, id)
	s.mu.Unlock()

	if err != nil {
		// If error was due to not found, it's not a critical failure for deletion intent
		if strings.Contains(err.Error(), "not found") {
			return nil // Or return the error if strictness is required
		}
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	err = s.db.DeleteMessage(ctx, id)
	if err != nil {
		return fmt.Errorf("db.DeleteMessage: %w", err)
	}

	if messageToPublish != nil {
		s.broker.Publish(EventMessageDeleted, *messageToPublish)
	}
	return nil
}

func (s *service) getServiceForPublish(ctx context.Context, id string) (*Message, error) {
	dbMsg, err := s.db.GetMessage(ctx, id)
	if err != nil {
		return nil, err
	}
	msg, convErr := s.fromDBItem(dbMsg)
	if convErr != nil {
		return nil, fmt.Errorf("failed to convert DB message for publishing: %w", convErr)
	}
	return &msg, nil
}

func (s *service) DeleteSessionMessages(ctx context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	messagesToDelete, err := s.db.ListMessagesBySession(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("failed to list messages for deletion: %w", err)
	}

	err = s.db.DeleteSessionMessages(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("db.DeleteSessionMessages: %w", err)
	}

	for _, dbMsg := range messagesToDelete {
		msg, convErr := s.fromDBItem(dbMsg)
		if convErr == nil {
			s.broker.Publish(EventMessageDeleted, msg)
		} else {
			slog.Error("Failed to convert DB message for delete event publishing", "id", dbMsg.ID, "error", convErr)
		}
	}
	return nil
}

func (s *service) Subscribe(ctx context.Context) <-chan pubsub.Event[Message] {
	return s.broker.Subscribe(ctx)
}

func (s *service) fromDBItem(item db.Message) (Message, error) {
	parts, err := unmarshallParts([]byte(item.Parts))
	if err != nil {
		return Message{}, fmt.Errorf("unmarshallParts for message ID %s: %w. Raw parts: %s", item.ID, err, item.Parts)
	}

	// DB stores created_at, updated_at, finished_at as Unix seconds.
	// Go struct Message stores them as Unix milliseconds.
	createdAtMillis := item.CreatedAt * 1000
	updatedAtMillis := item.UpdatedAt * 1000

	msg := Message{
		ID:        item.ID,
		SessionID: item.SessionID,
		Role:      MessageRole(item.Role),
		Parts:     parts,
		Model:     models.ModelID(item.Model.String),
		CreatedAt: createdAtMillis,
		UpdatedAt: updatedAtMillis,
	}

	// Ensure Finish part in msg.Parts reflects the item.FinishedAt state
	// if item.FinishedAt is the source of truth for the "overall message finished time".
	// The `unmarshallParts` should already create a Finish part if it's in the JSON.
	// This logic reconciles the DB column with the JSON parts.
	var existingFinishPart *Finish
	var finishPartIndex = -1

	for i, p := range msg.Parts {
		if fp, ok := p.(Finish); ok {
			existingFinishPart = &fp
			finishPartIndex = i
			break
		}
	}

	if item.FinishedAt.Valid && item.FinishedAt.Int64 > 0 {
		dbFinishTimeMillis := item.FinishedAt.Int64 * 1000
		if existingFinishPart != nil {
			// If a Finish part exists from JSON, update its time if DB's time is different.
			// This assumes DB `finished_at` is the ultimate source of truth for when the message truly finished.
			if existingFinishPart.Time != dbFinishTimeMillis {
				slog.Debug("Aligning Finish part time with DB finished_at", "message_id", msg.ID, "json_finish_time", existingFinishPart.Time, "db_finish_time", dbFinishTimeMillis)
				existingFinishPart.Time = dbFinishTimeMillis
				msg.Parts[finishPartIndex] = *existingFinishPart
			}
		} else {
			// If no Finish part in JSON but DB says it's finished, add one.
			// We might not know the original FinishReason here, so use a sensible default or leave it to be set by Update.
			// This scenario should be less common if `Update` always ensures a Finish part for finished messages.
			slog.Debug("Synthesizing Finish part from DB finished_at", "message_id", msg.ID)
			msg.Parts = append(msg.Parts, Finish{Reason: FinishReasonEndTurn, Time: dbFinishTimeMillis})
		}
	}

	return msg, nil
}

func Create(ctx context.Context, sessionID string, params CreateMessageParams) (Message, error) {
	return GetService().Create(ctx, sessionID, params)
}

func Update(ctx context.Context, message Message) (Message, error) {
	return GetService().Update(ctx, message)
}

func Get(ctx context.Context, id string) (Message, error) {
	return GetService().Get(ctx, id)
}

func List(ctx context.Context, sessionID string) ([]Message, error) {
	return GetService().List(ctx, sessionID)
}

func ListAfter(ctx context.Context, sessionID string, timestampMillis int64) ([]Message, error) {
	return GetService().ListAfter(ctx, sessionID, timestampMillis)
}

func Delete(ctx context.Context, id string) error {
	return GetService().Delete(ctx, id)
}

func DeleteSessionMessages(ctx context.Context, sessionID string) error {
	return GetService().DeleteSessionMessages(ctx, sessionID)
}

func SubscribeToEvents(ctx context.Context) <-chan pubsub.Event[Message] {
	return GetService().Subscribe(ctx)
}

type partType string

const (
	reasoningType  partType = "reasoning"
	textType       partType = "text"
	imageURLType   partType = "image_url"
	binaryType     partType = "binary"
	toolCallType   partType = "tool_call"
	toolResultType partType = "tool_result"
	finishType     partType = "finish"
)

type partWrapper struct {
	Type partType        `json:"type"`
	Data json.RawMessage `json:"data"`
}

func marshallParts(parts []ContentPart) ([]byte, error) {
	wrappedParts := make([]json.RawMessage, len(parts))
	for i, part := range parts {
		var typ partType
		var dataBytes []byte
		var err error

		switch p := part.(type) {
		case ReasoningContent:
			typ = reasoningType
			dataBytes, err = json.Marshal(p)
		case TextContent:
			typ = textType
			dataBytes, err = json.Marshal(p)
		case *TextContent:
			typ = textType
			dataBytes, err = json.Marshal(p)
		case ImageURLContent:
			typ = imageURLType
			dataBytes, err = json.Marshal(p)
		case BinaryContent:
			typ = binaryType
			dataBytes, err = json.Marshal(p)
		case ToolCall:
			typ = toolCallType
			dataBytes, err = json.Marshal(p)
		case ToolResult:
			typ = toolResultType
			dataBytes, err = json.Marshal(p)
		case Finish:
			typ = finishType
			dataBytes, err = json.Marshal(p)
		default:
			return nil, fmt.Errorf("unknown part type for marshalling: %T", part)
		}
		if err != nil {
			return nil, fmt.Errorf("failed to marshal part data for type %s: %w", typ, err)
		}
		wrapper := struct {
			Type partType        `json:"type"`
			Data json.RawMessage `json:"data"`
		}{Type: typ, Data: dataBytes}
		wrappedBytes, err := json.Marshal(wrapper)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal part wrapper for type %s: %w", typ, err)
		}
		wrappedParts[i] = wrappedBytes
	}
	return json.Marshal(wrappedParts)
}

func unmarshallParts(data []byte) ([]ContentPart, error) {
	var rawMessages []json.RawMessage
	if err := json.Unmarshal(data, &rawMessages); err != nil {
		// Handle case where 'parts' might be a single object if not an array initially
		// This was a fallback, if your DB always stores an array, this might not be needed.
		var singleRawMessage json.RawMessage
		if errSingle := json.Unmarshal(data, &singleRawMessage); errSingle == nil {
			rawMessages = []json.RawMessage{singleRawMessage}
		} else {
			return nil, fmt.Errorf("failed to unmarshal parts data as array: %w. Data: %s", err, string(data))
		}
	}

	parts := make([]ContentPart, 0, len(rawMessages))
	for _, rawPart := range rawMessages {
		var wrapper partWrapper
		if err := json.Unmarshal(rawPart, &wrapper); err != nil {
			// Fallback for old format where parts might be just TextContent string
			var text string
			if errText := json.Unmarshal(rawPart, &text); errText == nil {
				parts = append(parts, TextContent{Text: text})
				continue
			}
			return nil, fmt.Errorf("failed to unmarshal part wrapper: %w. Raw part: %s", err, string(rawPart))
		}

		switch wrapper.Type {
		case reasoningType:
			var p ReasoningContent
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal ReasoningContent: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		case textType:
			var p TextContent
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal TextContent: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		case imageURLType:
			var p ImageURLContent
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal ImageURLContent: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		case binaryType:
			var p BinaryContent
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal BinaryContent: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		case toolCallType:
			var p ToolCall
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal ToolCall: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		case toolResultType:
			var p ToolResult
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal ToolResult: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		case finishType:
			var p Finish
			if err := json.Unmarshal(wrapper.Data, &p); err != nil {
				return nil, fmt.Errorf("unmarshal Finish: %w. Data: %s", err, string(wrapper.Data))
			}
			parts = append(parts, p)
		default:
			slog.Warn("Unknown part type during unmarshalling, attempting to parse as TextContent", "type", wrapper.Type, "data", string(wrapper.Data))
			// Fallback: if type is unknown or empty, try to parse data as TextContent directly
			var p TextContent
			if err := json.Unmarshal(wrapper.Data, &p); err == nil {
				parts = append(parts, p)
			} else {
				// If that also fails, log it but continue if possible, or return error
				slog.Error("Failed to unmarshal unknown part type and fallback to TextContent failed", "type", wrapper.Type, "data", string(wrapper.Data), "error", err)
				// Depending on strictness, you might return an error here:
				// return nil, fmt.Errorf("unknown part type '%s' and failed fallback: %w", wrapper.Type, err)
			}
		}
	}
	return parts, nil
}
