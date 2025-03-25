package repl

import (
	"fmt"
	"slices"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
	"github.com/cloudwego/eino/schema"
	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/message"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
	"github.com/kujtimiihoxha/termai/internal/session"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
)

type MessagesCmp interface {
	tea.Model
	layout.Focusable
	layout.Bordered
	layout.Sizeable
	layout.Bindings
}

type messagesCmp struct {
	app        *app.App
	messages   []message.Message
	session    session.Session
	viewport   viewport.Model
	mdRenderer *glamour.TermRenderer
	width      int
	height     int
	focused    bool
	cachedView string
}

func (m *messagesCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case pubsub.Event[message.Message]:
		if msg.Type == pubsub.CreatedEvent {
			m.messages = append(m.messages, msg.Payload)
			m.renderView()
			m.viewport.GotoBottom()
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
		m.renderView()
		m.viewport.GotoBottom()
	}
	if m.focused {
		u, cmd := m.viewport.Update(msg)
		m.viewport = u
		return m, cmd
	}
	return m, nil
}

func borderColor(role schema.RoleType) lipgloss.TerminalColor {
	switch role {
	case schema.Assistant:
		return styles.Mauve
	case schema.User:
		return styles.Rosewater
	case schema.Tool:
		return styles.Peach
	}
	return styles.Blue
}

func borderText(msgRole schema.RoleType, currentMessage int) map[layout.BorderPosition]string {
	role := ""
	icon := ""
	switch msgRole {
	case schema.Assistant:
		role = "Assistant"
		icon = styles.BotIcon
	case schema.User:
		role = "User"
		icon = styles.UserIcon
	}
	return map[layout.BorderPosition]string{
		layout.TopLeftBorder: lipgloss.NewStyle().
			Padding(0, 1).
			Bold(true).
			Foreground(styles.Crust).
			Background(borderColor(msgRole)).
			Render(fmt.Sprintf("%s %s ", role, icon)),
		layout.TopRightBorder: lipgloss.NewStyle().
			Padding(0, 1).
			Bold(true).
			Foreground(styles.Crust).
			Background(borderColor(msgRole)).
			Render(fmt.Sprintf("#%d ", currentMessage)),
	}
}

func (m *messagesCmp) renderView() {
	stringMessages := make([]string, 0)
	r, _ := glamour.NewTermRenderer(
		glamour.WithStyles(styles.CatppuccinMarkdownStyle()),
		glamour.WithWordWrap(m.width-10),
		glamour.WithEmoji(),
	)
	textStyle := lipgloss.NewStyle().Width(m.width - 4)
	currentMessage := 1
	for _, msg := range m.messages {
		if msg.MessageData.Role == schema.Tool {
			continue
		}
		content := msg.MessageData.Content
		if content != "" {
			content, _ = r.Render(msg.MessageData.Content)
			stringMessages = append(stringMessages, layout.Borderize(
				textStyle.Render(content),
				layout.BorderOptions{
					InactiveBorder: lipgloss.DoubleBorder(),
					ActiveBorder:   lipgloss.DoubleBorder(),
					ActiveColor:    borderColor(msg.MessageData.Role),
					InactiveColor:  borderColor(msg.MessageData.Role),
					EmbeddedText:   borderText(msg.MessageData.Role, currentMessage),
				},
			))
			currentMessage++
		}
		for _, toolCall := range msg.MessageData.ToolCalls {
			resultInx := slices.IndexFunc(m.messages, func(m message.Message) bool {
				return m.MessageData.ToolCallID == toolCall.ID
			})
			content := fmt.Sprintf("**Arguments**\n```json\n%s\n```\n", toolCall.Function.Arguments)
			if resultInx == -1 {
				content += "Running..."
			} else {
				result := m.messages[resultInx].MessageData.Content
				if result != "" {
					lines := strings.Split(result, "\n")
					if len(lines) > 15 {
						result = strings.Join(lines[:15], "\n")
					}
					content += fmt.Sprintf("**Result**\n```\n%s\n```\n", result)
					if len(lines) > 15 {
						content += fmt.Sprintf("\n\n *...%d lines are truncated* ", len(lines)-15)
					}
				}
			}
			content, _ = r.Render(content)
			stringMessages = append(stringMessages, layout.Borderize(
				textStyle.Render(content),
				layout.BorderOptions{
					InactiveBorder: lipgloss.DoubleBorder(),
					ActiveBorder:   lipgloss.DoubleBorder(),
					ActiveColor:    borderColor(schema.Tool),
					InactiveColor:  borderColor(schema.Tool),
					EmbeddedText: map[layout.BorderPosition]string{
						layout.TopLeftBorder: lipgloss.NewStyle().
							Padding(0, 1).
							Bold(true).
							Foreground(styles.Crust).
							Background(borderColor(schema.Tool)).
							Render(
								fmt.Sprintf("Tool [%s] %s ", toolCall.Function.Name, styles.ToolIcon),
							),
						layout.TopRightBorder: lipgloss.NewStyle().
							Padding(0, 1).
							Bold(true).
							Foreground(styles.Crust).
							Background(borderColor(schema.Tool)).
							Render(fmt.Sprintf("#%d ", currentMessage)),
					},
				},
			))
			currentMessage++
		}
	}
	m.viewport.SetContent(lipgloss.JoinVertical(lipgloss.Top, stringMessages...))
}

func (m *messagesCmp) View() string {
	return lipgloss.NewStyle().Padding(1).Render(m.viewport.View())
}

func (m *messagesCmp) BindingKeys() []key.Binding {
	return layout.KeyMapToSlice(m.viewport.KeyMap)
}

func (m *messagesCmp) Blur() tea.Cmd {
	m.focused = false
	return nil
}

func (m *messagesCmp) BorderText() map[layout.BorderPosition]string {
	title := m.session.Title
	titleWidth := m.width / 2
	if len(title) > titleWidth {
		title = title[:titleWidth] + "..."
	}
	if m.focused {
		title = lipgloss.NewStyle().Foreground(styles.Primary).Render(title)
	}
	return map[layout.BorderPosition]string{
		layout.TopLeftBorder:     title,
		layout.BottomRightBorder: formatTokensAndCost(m.session.CompletionTokens+m.session.PromptTokens, m.session.Cost),
	}
}

func (m *messagesCmp) Focus() tea.Cmd {
	m.focused = true
	return nil
}

func (m *messagesCmp) GetSize() (int, int) {
	return m.width, m.height
}

func (m *messagesCmp) IsFocused() bool {
	return m.focused
}

func (m *messagesCmp) SetSize(width int, height int) {
	m.width = width
	m.height = height
	m.viewport.Width = width - 2   // padding
	m.viewport.Height = height - 2 // padding
}

func (m *messagesCmp) Init() tea.Cmd {
	return nil
}

func NewMessagesCmp(app *app.App) MessagesCmp {
	return &messagesCmp{
		app:      app,
		messages: []message.Message{},
		viewport: viewport.New(0, 0),
	}
}
