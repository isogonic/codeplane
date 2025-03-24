package repl

import (
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/message"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
	"github.com/kujtimiihoxha/termai/internal/session"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
)

type MessagesCmp interface {
	tea.Model
	layout.Focusable
	layout.Bordered
	layout.Sizeable
	layout.Bindings
}

type messagesCmp struct {
	app      *app.App
	messages []message.Message
	session  session.Session
	viewport viewport.Model
	width    int
	height   int
	focused  bool
}

func (m *messagesCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case pubsub.Event[message.Message]:
		if msg.Type == pubsub.CreatedEvent {
			m.messages = append(m.messages, msg.Payload)
		}
	case pubsub.Event[session.Session]:
		if msg.Type == pubsub.UpdatedEvent {
			if m.session.ID == msg.Payload.ID {
				m.session = msg.Payload
			}
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

// BindingKeys implements MessagesCmp.
func (m *messagesCmp) BindingKeys() []key.Binding {
	return []key.Binding{}
}

// Blur implements MessagesCmp.
func (m *messagesCmp) Blur() tea.Cmd {
	m.focused = false
	return nil
}

// BorderText implements MessagesCmp.
func (m *messagesCmp) BorderText() map[layout.BorderPosition]string {
	title := m.session.Title
	if len(title) > 20 {
		title = title[:20] + "..."
	}
	return map[layout.BorderPosition]string{
		layout.TopLeftBorder: title,
	}
}

// Focus implements MessagesCmp.
func (m *messagesCmp) Focus() tea.Cmd {
	m.focused = true
	return nil
}

// GetSize implements MessagesCmp.
func (m *messagesCmp) GetSize() (int, int) {
	return m.width, m.height
}

// IsFocused implements MessagesCmp.
func (m *messagesCmp) IsFocused() bool {
	return m.focused
}

// SetSize implements MessagesCmp.
func (m *messagesCmp) SetSize(width int, height int) {
	m.width = width
	m.height = height
}

func (m *messagesCmp) Init() tea.Cmd {
	return nil
}

func NewMessagesCmp(app *app.App) MessagesCmp {
	return &messagesCmp{
		app:      app,
		messages: []message.Message{},
	}
}
