package tui

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/page"
)

type keyMap struct {
	Logs key.Binding
	Back key.Binding
	Quit key.Binding
}

var keys = keyMap{
	Logs: key.NewBinding(
		key.WithKeys("L"),
		key.WithHelp("L", "logs"),
	),
	Back: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "back"),
	),
	Quit: key.NewBinding(
		key.WithKeys("ctrl+c", "q"),
		key.WithHelp("ctrl+c/q", "quit"),
	),
}

type appModel struct {
	width, height int
	currentPage   page.PageID
	previousPage  page.PageID
	pages         map[page.PageID]tea.Model
	loadedPages   map[page.PageID]bool
}

func (a appModel) Init() tea.Cmd {
	cmd := a.pages[a.currentPage].Init()
	a.loadedPages[a.currentPage] = true
	return cmd
}

func (a appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.width, a.height = msg.Width, msg.Height
	case tea.KeyMsg:
		if key.Matches(msg, keys.Quit) {
			return a, tea.Quit
		}
		if key.Matches(msg, keys.Back) {
			if a.previousPage != "" {
				return a, a.moveToPage(a.previousPage)
			}
			return a, nil
		}
		if key.Matches(msg, keys.Logs) {
			return a, a.moveToPage(page.LogsPage)
		}
	}
	p, cmd := a.pages[a.currentPage].Update(msg)
	if p != nil {
		a.pages[a.currentPage] = p
	}
	return a, cmd
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
	return a.pages[a.currentPage].View()
}

func New() tea.Model {
	return &appModel{
		currentPage: page.ReplPage,
		loadedPages: make(map[page.PageID]bool),
		pages: map[page.PageID]tea.Model{
			page.LogsPage: page.NewLogsPage(),
			page.InitPage: page.NewInitPage(),
			page.ReplPage: page.NewReplPage(),
		},
	}
}
