package session

import (
	"context"

	"github.com/google/uuid"
	"github.com/kujtimiihoxha/termai/internal/db"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
)

type Session struct {
	ID           string
	Title        string
	MessageCount int64
	Tokens       int64
	Cost         float64
	CreatedAt    int64
	UpdatedAt    int64
}

type Service interface {
	pubsub.Suscriber[Session]
	Create(title string) (Session, error)
	Get(id string) (Session, error)
	List() ([]Session, error)
	Save(session Session) (Session, error)
	Delete(id string) error
}

type service struct {
	*pubsub.Broker[Session]
	q   db.Querier
	ctx context.Context
}

func (s *service) Create(title string) (Session, error) {
	dbSession, err := s.q.CreateSession(s.ctx, db.CreateSessionParams{
		ID:    uuid.New().String(),
		Title: title,
	})
	if err != nil {
		return Session{}, err
	}
	session := s.fromDBItem(dbSession)
	s.Publish(pubsub.CreatedEvent, session)
	return session, nil
}

func (s *service) Delete(id string) error {
	session, err := s.Get(id)
	if err != nil {
		return err
	}
	err = s.q.DeleteSession(s.ctx, session.ID)
	if err != nil {
		return err
	}
	s.Publish(pubsub.DeletedEvent, session)
	return nil
}

func (s *service) Get(id string) (Session, error) {
	dbSession, err := s.q.GetSessionByID(s.ctx, id)
	if err != nil {
		return Session{}, err
	}
	return s.fromDBItem(dbSession), nil
}

func (s *service) Save(session Session) (Session, error) {
	dbSession, err := s.q.UpdateSession(s.ctx, db.UpdateSessionParams{
		ID:     session.ID,
		Title:  session.Title,
		Tokens: session.Tokens,
		Cost:   session.Cost,
	})
	if err != nil {
		return Session{}, err
	}
	session = s.fromDBItem(dbSession)
	s.Publish(pubsub.UpdatedEvent, session)
	return session, nil
}

func (s *service) List() ([]Session, error) {
	dbSessions, err := s.q.ListSessions(s.ctx)
	if err != nil {
		return nil, err
	}
	sessions := make([]Session, len(dbSessions))
	for i, dbSession := range dbSessions {
		sessions[i] = s.fromDBItem(dbSession)
	}
	return sessions, nil
}

func (s service) fromDBItem(item db.Session) Session {
	return Session{
		ID:           item.ID,
		Title:        item.Title,
		MessageCount: item.MessageCount,
		Tokens:       item.Tokens,
		Cost:         item.Cost,
		CreatedAt:    item.CreatedAt,
		UpdatedAt:    item.UpdatedAt,
	}
}

func NewService(ctx context.Context, q db.Querier) Service {
	broker := pubsub.NewBroker[Session]()
	return &service{
		broker,
		q,
		ctx,
	}
}
