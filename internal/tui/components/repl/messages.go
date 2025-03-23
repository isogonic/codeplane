package repl

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/message"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
	"github.com/kujtimiihoxha/termai/internal/session"
)

type messagesCmp struct {
	app      *app.App
	messages []message.Message
	session  session.Session
}

func (m *messagesCmp) Init() tea.Cmd {
	return nil
}

func (m *messagesCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case pubsub.Event[message.Message]:
		if msg.Type == pubsub.CreatedEvent {
			m.messages = append(m.messages, msg.Payload)
		}
	case SelectedSessionMsg:
		m.session, _ = m.app.Sessions.Get(msg.SessionID)
		m.messages, _ = m.app.Messages.List(m.session.ID)
	}
	return m, nil
}

func (i *messagesCmp) View() string {
	stringMessages := make([]string, len(i.messages))
	for idx, msg := range i.messages {
		stringMessages[idx] = msg.MessageData.Content
	}
	return lipgloss.JoinVertical(lipgloss.Top, stringMessages...)
}

func NewMessagesCmp(app *app.App) tea.Model {
	return &messagesCmp{
		app:      app,
		messages: []message.Message{},
	}
}
