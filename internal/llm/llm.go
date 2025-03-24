package llm

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/cloudwego/eino/callbacks"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/google/uuid"
	"github.com/kujtimiihoxha/termai/internal/llm/agent"
	"github.com/kujtimiihoxha/termai/internal/llm/models"
	"github.com/kujtimiihoxha/termai/internal/logging"
	"github.com/kujtimiihoxha/termai/internal/message"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
	"github.com/kujtimiihoxha/termai/internal/session"

	eModel "github.com/cloudwego/eino/components/model"
	enioAgent "github.com/cloudwego/eino/flow/agent"
	"github.com/spf13/viper"
)

const (
	AgentRequestoEvent pubsub.EventType = "agent_request"
	AgentErrorEvent    pubsub.EventType = "agent_error"
	AgentResponseEvent pubsub.EventType = "agent_response"
)

type AgentMessageType int

const (
	AgentMessageTypeNewUserMessage AgentMessageType = iota
	AgentMessageTypeAgentResponse
	AgentMessageTypeError
)

type agentID string

const (
	RootAgent agentID = "root"
	TaskAgent agentID = "task"
)

type AgentEvent struct {
	ID        string           `json:"id"`
	Type      AgentMessageType `json:"type"`
	AgentID   agentID          `json:"agent_id"`
	MessageID string           `json:"message_id"`
	SessionID string           `json:"session_id"`
	Content   string           `json:"content"`
}

type Service interface {
	pubsub.Suscriber[AgentEvent]

	SendRequest(sessionID string, content string)
}
type service struct {
	*pubsub.Broker[AgentEvent]
	Requests       sync.Map
	ctx            context.Context
	activeRequests sync.Map
	messages       message.Service
	sessions       session.Service
	logger         logging.Interface
}

func (s *service) handleRequest(id string, sessionID string, content string) {
	cancel, ok := s.activeRequests.Load(id)
	if !ok {
		return
	}
	defer cancel.(context.CancelFunc)()
	defer s.activeRequests.Delete(id)

	history, err := s.messages.List(sessionID)
	if err != nil {
		s.Publish(AgentErrorEvent, AgentEvent{
			ID:        id,
			Type:      AgentMessageTypeError,
			AgentID:   RootAgent,
			MessageID: "",
			SessionID: sessionID,
			Content:   err.Error(),
		})
		return
	}

	log.Printf("Request: %s", content)
	currentAgent, systemMessage, err := agent.GetAgent(s.ctx, viper.GetString("agents.default"))
	if err != nil {
		s.Publish(AgentErrorEvent, AgentEvent{
			ID:        id,
			Type:      AgentMessageTypeError,
			AgentID:   RootAgent,
			MessageID: "",
			SessionID: sessionID,
			Content:   err.Error(),
		})
		return
	}

	messages := []*schema.Message{
		{
			Role:    schema.System,
			Content: systemMessage,
		},
	}
	for _, m := range history {
		messages = append(messages, &m.MessageData)
	}

	builder := callbacks.NewHandlerBuilder()
	builder.OnStartFn(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
		i, ok := input.(*eModel.CallbackInput)
		if info.Component == "ChatModel" && ok {
			if len(messages) < len(i.Messages) {
				// find new messages
				newMessages := i.Messages[len(messages):]
				for _, m := range newMessages {
					_, err = s.messages.Create(sessionID, *m)
					if err != nil {
						s.Publish(AgentErrorEvent, AgentEvent{
							ID:        id,
							Type:      AgentMessageTypeError,
							AgentID:   RootAgent,
							MessageID: "",
							SessionID: sessionID,
							Content:   err.Error(),
						})
					}
					messages = append(messages, m)
				}
			}
		}

		return ctx
	})
	builder.OnEndFn(func(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
		return ctx
	})

	out, err := currentAgent.Generate(s.ctx, messages, enioAgent.WithComposeOptions(compose.WithCallbacks(builder.Build())))
	if err != nil {
		s.Publish(AgentErrorEvent, AgentEvent{
			ID:        id,
			Type:      AgentMessageTypeError,
			AgentID:   RootAgent,
			MessageID: "",
			SessionID: sessionID,
			Content:   err.Error(),
		})
		return
	}
	usage := out.ResponseMeta.Usage
	s.messages.Create(sessionID, *out)
	if usage != nil {
		log.Printf("Prompt Tokens: %d, Completion Tokens: %d, Total Tokens: %d", usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens)
		session, err := s.sessions.Get(sessionID)
		if err != nil {
			s.Publish(AgentErrorEvent, AgentEvent{
				ID:        id,
				Type:      AgentMessageTypeError,
				AgentID:   RootAgent,
				MessageID: "",
				SessionID: sessionID,
				Content:   err.Error(),
			})
			return
		}
		session.PromptTokens += int64(usage.PromptTokens)
		session.CompletionTokens += int64(usage.CompletionTokens)
		// TODO: calculate cost
		model := models.SupportedModels[models.ModelID(viper.GetString("models.big"))]
		session.Cost += float64(usage.PromptTokens)*(model.CostPer1MIn/1_000_000) +
			float64(usage.CompletionTokens)*(model.CostPer1MOut/1_000_000)
		var newTitle string
		if len(history) == 1 {
			// first message generate the title
			newTitle, err = agent.GenerateTitle(s.ctx, content)
			if err != nil {
				s.Publish(AgentErrorEvent, AgentEvent{
					ID:        id,
					Type:      AgentMessageTypeError,
					AgentID:   RootAgent,
					MessageID: "",
					SessionID: sessionID,
					Content:   err.Error(),
				})
				return
			}
		}
		if newTitle != "" {
			session.Title = newTitle
		}

		_, err = s.sessions.Save(session)
		if err != nil {
			s.Publish(AgentErrorEvent, AgentEvent{
				ID:        id,
				Type:      AgentMessageTypeError,
				AgentID:   RootAgent,
				MessageID: "",
				SessionID: sessionID,
				Content:   err.Error(),
			})
			return
		}
	}
}

func (s *service) SendRequest(sessionID string, content string) {
	id := uuid.New().String()

	_, cancel := context.WithTimeout(s.ctx, 5*time.Minute)
	s.activeRequests.Store(id, cancel)
	log.Printf("Request: %s", content)
	go s.handleRequest(id, sessionID, content)
}

func NewService(ctx context.Context, logger logging.Interface, sessions session.Service, messages message.Service) Service {
	return &service{
		Broker:   pubsub.NewBroker[AgentEvent](),
		ctx:      ctx,
		sessions: sessions,
		messages: messages,
		logger:   logger,
	}
}
