package tui

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/tui/components/core"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/page"
	"github.com/kujtimiihoxha/termai/internal/tui/util"
)

type keyMap struct {
	Logs   key.Binding
	Return key.Binding
	Back   key.Binding
	Quit   key.Binding
	Help   key.Binding
}

var keys = keyMap{
	Logs: key.NewBinding(
		key.WithKeys("L"),
		key.WithHelp("L", "logs"),
	),
	Return: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "close"),
	),
	Back: key.NewBinding(
		key.WithKeys("backspace"),
		key.WithHelp("backspace", "back"),
	),
	Quit: key.NewBinding(
		key.WithKeys("ctrl+c", "q"),
		key.WithHelp("ctrl+c/q", "quit"),
	),
	Help: key.NewBinding(
		key.WithKeys("?"),
		key.WithHelp("?", "toggle help"),
	),
}

type appModel struct {
	width, height int
	currentPage   page.PageID
	previousPage  page.PageID
	pages         map[page.PageID]tea.Model
	loadedPages   map[page.PageID]bool
	status        tea.Model
	help          core.HelpCmp
	showHelp      bool
}

func (a appModel) Init() tea.Cmd {
	cmd := a.pages[a.currentPage].Init()
	a.loadedPages[a.currentPage] = true
	return cmd
}

func (a appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		msg.Height -= 1 // Make space for the status bar
		a.width, a.height = msg.Width, msg.Height

		a.status, _ = a.status.Update(msg)

		uh, _ := a.help.Update(msg)
		a.help = uh.(core.HelpCmp)

		p, cmd := a.pages[a.currentPage].Update(msg)
		a.pages[a.currentPage] = p
		return a, cmd
	case util.InfoMsg:
		a.status, _ = a.status.Update(msg)
	case util.ErrorMsg:
		a.status, _ = a.status.Update(msg)
	case tea.KeyMsg:
		switch {
		case key.Matches(msg, keys.Quit):
			return a, tea.Quit
		case key.Matches(msg, keys.Back):
			if a.previousPage != "" {
				return a, a.moveToPage(a.previousPage)
			}
		case key.Matches(msg, keys.Return):
			if a.showHelp {
				a.ToggleHelp()
				return a, nil
			}
			return a, nil
		case key.Matches(msg, keys.Logs):
			return a, a.moveToPage(page.LogsPage)
		case key.Matches(msg, keys.Help):
			a.ToggleHelp()
			return a, nil
		}
	}
	p, cmd := a.pages[a.currentPage].Update(msg)
	a.pages[a.currentPage] = p
	return a, cmd
}

func (a *appModel) ToggleHelp() {
	if a.showHelp {
		a.showHelp = false
		a.height += a.help.Height()
	} else {
		a.showHelp = true
		a.height -= a.help.Height()
	}

	if sizable, ok := a.pages[a.currentPage].(layout.Sizeable); ok {
		sizable.SetSize(a.width, a.height)
	}
}

func (a *appModel) moveToPage(pageID page.PageID) tea.Cmd {
	var cmd tea.Cmd
	if _, ok := a.loadedPages[pageID]; !ok {
		cmd = a.pages[pageID].Init()
		a.loadedPages[pageID] = true
	}
	a.previousPage = a.currentPage
	a.currentPage = pageID
	if sizable, ok := a.pages[a.currentPage].(layout.Sizeable); ok {
		sizable.SetSize(a.width, a.height)
	}

	return cmd
}

func (a appModel) View() string {
	components := []string{
		a.pages[a.currentPage].View(),
	}

	if a.showHelp {
		bindings := layout.KeyMapToSlice(keys)
		if p, ok := a.pages[a.currentPage].(layout.Bindings); ok {
			bindings = append(bindings, p.BindingKeys()...)
		}
		a.help.SetBindings(bindings)
		components = append(components, a.help.View())
	}

	components = append(components, a.status.View())

	return lipgloss.JoinVertical(lipgloss.Top, components...)
}

func New() tea.Model {
	return &appModel{
		currentPage: page.ReplPage,
		loadedPages: make(map[page.PageID]bool),
		status:      core.NewStatusCmp(),
		help:        core.NewHelpCmp(),
		pages: map[page.PageID]tea.Model{
			page.LogsPage: page.NewLogsPage(),
			page.InitPage: page.NewInitPage(),
			page.ReplPage: page.NewReplPage(),
		},
	}
}
