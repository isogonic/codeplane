package page

import (
	"context"
	"fmt"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/message"
	"github.com/sst/opencode/internal/session"
	"github.com/sst/opencode/internal/status"
	"github.com/sst/opencode/internal/tui/components/chat"
	"github.com/sst/opencode/internal/tui/components/dialog"
	"github.com/sst/opencode/internal/tui/layout"
	"github.com/sst/opencode/internal/tui/state"
	"github.com/sst/opencode/internal/tui/util"
)

var ChatPage PageID = "chat"

type chatPage struct {
	app      *app.App
	editor   layout.Container
	messages layout.Container
	layout   layout.SplitPaneLayout
}

type ChatKeyMap struct {
	NewSession  key.Binding
	Cancel      key.Binding
	ToggleTools key.Binding
}

var keyMap = ChatKeyMap{
	NewSession: key.NewBinding(
		key.WithKeys("ctrl+n"),
		key.WithHelp("ctrl+n", "new session"),
	),
	Cancel: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "cancel"),
	),
	ToggleTools: key.NewBinding(
		key.WithKeys("ctrl+h"),
		key.WithHelp("ctrl+h", "toggle tools"),
	),
}

func (p *chatPage) Init() tea.Cmd {
	cmds := []tea.Cmd{
		p.layout.Init(),
	}
	return tea.Batch(cmds...)
}

func (p *chatPage) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		cmd := p.layout.SetSize(msg.Width, msg.Height)
		cmds = append(cmds, cmd)
	case chat.SendMsg:
		cmd := p.sendMessage(msg.Text, msg.Attachments)
		if cmd != nil {
			return p, cmd
		}
	case dialog.CommandRunCustomMsg:
		// Check if the agent is busy before executing custom commands
		if p.app.PrimaryAgent.IsBusy() {
			status.Warn("Agent is busy, please wait before executing a command...")
			return p, nil
		}
		// Handle custom command execution
		cmd := p.sendMessage(msg.Content, nil)
		if cmd != nil {
			return p, cmd
		}
	case state.SessionSelectedMsg:
		cmd := p.setSidebar()
		cmds = append(cmds, cmd)
	case state.SessionClearedMsg:
		cmd := p.setSidebar()
		cmds = append(cmds, cmd)
	case state.CompactSessionMsg:
		if p.app.CurrentSession.ID == "" {
			status.Warn("No active session to compact.")
			return p, nil
		}

		// Run compaction in background
		go func(sessionID string) {
			err := p.app.PrimaryAgent.CompactSession(context.Background(), sessionID, false)
			if err != nil {
				status.Error(fmt.Sprintf("Compaction failed: %v", err))
			} else {
				status.Info("Conversation compacted successfully.")
			}
		}(p.app.CurrentSession.ID)

		return p, nil
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, keyMap.NewSession):
			p.app.CurrentSession = &session.Session{}
			return p, tea.Batch(
				p.clearSidebar(),
				util.CmdHandler(state.SessionClearedMsg{}),
			)
		case key.Matches(msg, keyMap.Cancel):
			if p.app.CurrentSession.ID != "" {
				// Cancel the current session's generation process
				// This allows users to interrupt long-running operations
				p.app.PrimaryAgent.Cancel(p.app.CurrentSession.ID)
				return p, nil
			}
		case key.Matches(msg, keyMap.ToggleTools):
			return p, util.CmdHandler(chat.ToggleToolMessagesMsg{})
		}
	}
	u, cmd := p.layout.Update(msg)
	cmds = append(cmds, cmd)
	p.layout = u.(layout.SplitPaneLayout)
	return p, tea.Batch(cmds...)
}

func (p *chatPage) setSidebar() tea.Cmd {
	sidebarContainer := layout.NewContainer(
		chat.NewSidebarCmp(p.app),
		layout.WithPadding(1, 1, 1, 1),
	)
	return tea.Batch(p.layout.SetRightPanel(sidebarContainer), sidebarContainer.Init())
}

func (p *chatPage) clearSidebar() tea.Cmd {
	return p.layout.ClearRightPanel()
}

func (p *chatPage) sendMessage(text string, attachments []message.Attachment) tea.Cmd {
	var cmds []tea.Cmd
	if p.app.CurrentSession.ID == "" {
		newSession, err := p.app.Sessions.Create(context.Background(), "New Session")
		if err != nil {
			status.Error(err.Error())
			return nil
		}

		p.app.CurrentSession = &newSession

		cmd := p.setSidebar()
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		cmds = append(cmds, util.CmdHandler(state.SessionSelectedMsg(&newSession)))
	}

	_, err := p.app.PrimaryAgent.Run(context.Background(), p.app.CurrentSession.ID, text, attachments...)
	if err != nil {
		status.Error(err.Error())
		return nil
	}
	return tea.Batch(cmds...)
}

func (p *chatPage) SetSize(width, height int) tea.Cmd {
	return p.layout.SetSize(width, height)
}

func (p *chatPage) GetSize() (int, int) {
	return p.layout.GetSize()
}

func (p *chatPage) View() string {
	return p.layout.View()
}

func (p *chatPage) BindingKeys() []key.Binding {
	bindings := layout.KeyMapToSlice(keyMap)
	bindings = append(bindings, p.messages.BindingKeys()...)
	bindings = append(bindings, p.editor.BindingKeys()...)
	return bindings
}

func NewChatPage(app *app.App) tea.Model {
	messagesContainer := layout.NewContainer(
		chat.NewMessagesCmp(app),
		layout.WithPadding(1, 1, 0, 1),
	)
	editorContainer := layout.NewContainer(
		chat.NewEditorCmp(app),
		layout.WithBorder(true, false, false, false),
	)
	return &chatPage{
		app:      app,
		editor:   editorContainer,
		messages: messagesContainer,
		layout: layout.NewSplitPane(
			layout.WithLeftPanel(messagesContainer),
			layout.WithBottomPanel(editorContainer),
		),
	}
}
