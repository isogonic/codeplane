package repl

import tea "github.com/charmbracelet/bubbletea"

type messagesCmp struct{}

func (i *messagesCmp) Init() tea.Cmd {
	return nil
}

func (i *messagesCmp) Update(_ tea.Msg) (tea.Model, tea.Cmd) {
	return i, nil
}

func (i *messagesCmp) View() string {
	return "Messages"
}

func NewMessagesCmp() tea.Model {
	return &messagesCmp{}
}
