package messages

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/cloudwego/eino/schema"
	"github.com/kujtimiihoxha/termai/internal/message"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
)

const (
	maxHeight = 10
)

type MessagesCmp interface {
	tea.Model
	layout.Focusable
	layout.Bordered
	layout.Sizeable
}

type messageCmp struct {
	message  message.Message
	width    int
	height   int
	focused  bool
	expanded bool
}

func (m *messageCmp) Init() tea.Cmd {
	return nil
}

func (m *messageCmp) Update(tea.Msg) (tea.Model, tea.Cmd) {
	return m, nil
}

func (m *messageCmp) View() string {
	wrapper := layout.NewSinglePane(
		m,
		layout.WithSinglePaneBordered(true),
		layout.WithSinglePaneFocusable(true),
		layout.WithSinglePanePadding(1),
		layout.WithSinglePaneActiveColor(m.borderColor()),
	)
	if m.focused {
		wrapper.Focus()
	}
	wrapper.SetSize(m.width, m.height)
	return wrapper.View()
}

func (m *messageCmp) Blur() tea.Cmd {
	m.focused = false
	return nil
}

func (m *messageCmp) borderColor() lipgloss.TerminalColor {
	switch m.message.MessageData.Role {
	case schema.Assistant:
		return styles.Mauve
	case schema.User:
		return styles.Flamingo
	}
	return styles.Blue
}

func (m *messageCmp) BorderText() map[layout.BorderPosition]string {
	role := ""
	icon := ""
	switch m.message.MessageData.Role {
	case schema.Assistant:
		role = "Assistant"
		icon = styles.BotIcon
	case schema.User:
		role = "User"
		icon = styles.UserIcon
	}
	return map[layout.BorderPosition]string{
		layout.TopLeftBorder: fmt.Sprintf("%s %s ", role, icon),
	}
}

func (m *messageCmp) Focus() tea.Cmd {
	m.focused = true
	return nil
}

func (m *messageCmp) IsFocused() bool {
	return m.focused
}

func (m *messageCmp) GetSize() (int, int) {
	return m.width, 0
}

func (m *messageCmp) SetSize(width int, height int) {
	m.width = width
}

func NewMessageCmp(msg message.Message) MessagesCmp {
	return &messageCmp{
		message: msg,
	}
}
