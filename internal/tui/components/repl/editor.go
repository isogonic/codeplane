package repl

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/vimtea"
)

type EditorCmp interface {
	tea.Model
	layout.Focusable
	layout.Sizeable
	layout.Bordered
}

type editorCmp struct {
	app        *app.App
	editor     vimtea.Editor
	editorMode vimtea.EditorMode
	sessionID  string
	focused    bool
	width      int
	height     int
}

type localKeyMap struct {
	SendMessage  key.Binding
	SendMessageI key.Binding
}

var keyMap = localKeyMap{
	SendMessage: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "send message normal mode"),
	),
	SendMessageI: key.NewBinding(
		key.WithKeys("ctrl+s"),
		key.WithHelp("ctrl+s", "send message insert mode"),
	),
}

func (m *editorCmp) Init() tea.Cmd {
	return m.editor.Init()
}

func (m *editorCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case vimtea.EditorModeMsg:
		m.editorMode = msg.Mode
	case SelectedSessionMsg:
		if msg.SessionID != m.sessionID {
			m.sessionID = msg.SessionID
		}
	}
	if m.IsFocused() {
		switch msg := msg.(type) {
		case tea.KeyMsg:
			switch {
			case key.Matches(msg, keyMap.SendMessage):
				if m.editorMode == vimtea.ModeNormal {
					return m, m.Send()
				}
			case key.Matches(msg, keyMap.SendMessageI):
				if m.editorMode == vimtea.ModeInsert {
					return m, m.Send()
				}
			}
		}
		u, cmd := m.editor.Update(msg)
		m.editor = u.(vimtea.Editor)
		return m, cmd
	}
	return m, nil
}

// Blur implements EditorCmp.
func (m *editorCmp) Blur() tea.Cmd {
	m.focused = false
	return nil
}

// BorderText implements EditorCmp.
func (m *editorCmp) BorderText() map[layout.BorderPosition]string {
	return map[layout.BorderPosition]string{
		layout.TopLeftBorder: "New Message",
	}
}

// Focus implements EditorCmp.
func (m *editorCmp) Focus() tea.Cmd {
	m.focused = true
	return m.editor.Tick()
}

// GetSize implements EditorCmp.
func (m *editorCmp) GetSize() (int, int) {
	return m.width, m.height
}

// IsFocused implements EditorCmp.
func (m *editorCmp) IsFocused() bool {
	return m.focused
}

// SetSize implements EditorCmp.
func (m *editorCmp) SetSize(width int, height int) {
	m.width = width
	m.height = height
	m.editor.SetSize(width, height)
}

func (m *editorCmp) Send() tea.Cmd {
	return func() tea.Msg {
		// TODO: Send message
		return nil
	}
}

func (m *editorCmp) View() string {
	return m.editor.View()
}

func NewEditorCmp(app *app.App) EditorCmp {
	return &editorCmp{
		app:    app,
		editor: vimtea.NewEditor(),
	}
}
