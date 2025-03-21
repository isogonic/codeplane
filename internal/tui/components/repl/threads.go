package repl

import tea "github.com/charmbracelet/bubbletea"

type threadsCmp struct{}

func (i *threadsCmp) Init() tea.Cmd {
	return nil
}

func (i *threadsCmp) Update(_ tea.Msg) (tea.Model, tea.Cmd) {
	return i, nil
}

func (i *threadsCmp) View() string {
	return "Threads"
}

func NewThreadsCmp() tea.Model {
	return &threadsCmp{}
}
