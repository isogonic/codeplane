package core

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/util"
)

type SizeableModel interface {
	tea.Model
	layout.Sizeable
}

type DialogMsg struct {
	Content SizeableModel
}

type DialogCloseMsg struct{}

type KeyBindings struct {
	Return key.Binding
}

var keys = KeyBindings{
	Return: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
}

type DialogCmp interface {
	tea.Model
	layout.Bindings
}

type dialogCmp struct {
	content SizeableModel
}

func (d *dialogCmp) Init() tea.Cmd {
	return nil
}

func (d *dialogCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case DialogMsg:
		d.content = msg.Content
	case DialogCloseMsg:
		d.content = nil
		return d, nil
	case tea.KeyMsg:
		if key.Matches(msg, keys.Return) {
			return d, util.CmdHandler(DialogCloseMsg{})
		}
	}
	if d.content != nil {
		u, cmd := d.content.Update(msg)
		d.content = u.(SizeableModel)
		return d, cmd
	}
	return d, nil
}

func (d *dialogCmp) BindingKeys() []key.Binding {
	bindings := []key.Binding{keys.Return}
	if d.content == nil {
		return bindings
	}
	if c, ok := d.content.(layout.Bindings); ok {
		return append(bindings, c.BindingKeys()...)
	}
	return bindings
}

func (d *dialogCmp) View() string {
	w, h := d.content.GetSize()
	return lipgloss.NewStyle().Width(w).Height(h).Render(d.content.View())
}

func NewDialogCmp() DialogCmp {
	return &dialogCmp{}
}
