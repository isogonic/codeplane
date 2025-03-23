package message

import (
	"context"
	"encoding/json"

	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"github.com/kujtimiihoxha/termai/internal/db"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
)

type Message struct {
	ID          string
	SessionID   string
	MessageData schema.Message

	CreatedAt int64
	UpdatedAt int64
}

type Service interface {
	pubsub.Suscriber[Message]
	Create(sessionID string, messageData schema.Message) (Message, error)
	Get(id string) (Message, error)
	List(sessionID string) ([]Message, error)
	Delete(id string) error
	DeleteSessionMessages(sessionID string) error
}

type service struct {
	*pubsub.Broker[Message]
	q   db.Querier
	ctx context.Context
}

func (s *service) Create(sessionID string, messageData schema.Message) (Message, error) {
	messageDataJSON, err := json.Marshal(messageData)
	if err != nil {
		return Message{}, err
	}
	dbMessage, err := s.q.CreateMessage(s.ctx, db.CreateMessageParams{
		ID:          uuid.New().String(),
		SessionID:   sessionID,
		MessageData: string(messageDataJSON),
	})
	if err != nil {
		return Message{}, err
	}
	message := s.fromDBItem(dbMessage)
	s.Publish(pubsub.CreatedEvent, message)
	return message, nil
}

func (s *service) Delete(id string) error {
	message, err := s.Get(id)
	if err != nil {
		return err
	}
	err = s.q.DeleteMessage(s.ctx, message.ID)
	if err != nil {
		return err
	}
	s.Publish(pubsub.DeletedEvent, message)
	return nil
}

func (s *service) DeleteSessionMessages(sessionID string) error {
	messages, err := s.List(sessionID)
	if err != nil {
		return err
	}
	for _, message := range messages {
		if message.SessionID == sessionID {
			err = s.Delete(message.ID)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *service) Get(id string) (Message, error) {
	dbMessage, err := s.q.GetMessage(s.ctx, id)
	if err != nil {
		return Message{}, err
	}
	return s.fromDBItem(dbMessage), nil
}

func (s *service) List(sessionID string) ([]Message, error) {
	dbMessages, err := s.q.ListMessagesBySession(s.ctx, sessionID)
	if err != nil {
		return nil, err
	}
	messages := make([]Message, len(dbMessages))
	for i, dbMessage := range dbMessages {
		messages[i] = s.fromDBItem(dbMessage)
	}
	return messages, nil
}

func (s *service) fromDBItem(item db.Message) Message {
	var messageData schema.Message
	json.Unmarshal([]byte(item.MessageData), &messageData)
	return Message{
		ID:          item.ID,
		SessionID:   item.SessionID,
		MessageData: messageData,
		CreatedAt:   item.CreatedAt,
		UpdatedAt:   item.UpdatedAt,
	}
}

func NewService(ctx context.Context, q db.Querier) Service {
	return &service{
		Broker: pubsub.NewBroker[Message](),
		q:      q,
		ctx:    ctx,
	}
}
