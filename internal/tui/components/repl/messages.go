package repl

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/app"
)

type messagesCmp struct {
	app *app.App
}

func (i *messagesCmp) Init() tea.Cmd {
	return nil
}

func (i *messagesCmp) Update(_ tea.Msg) (tea.Model, tea.Cmd) {
	return i, nil
}

func (i *messagesCmp) View() string {
	return "Messages"
}

func NewMessagesCmp(app *app.App) tea.Model {
	return &messagesCmp{
		app,
	}
}
