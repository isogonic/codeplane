package page

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
)

var InitPage PageID = "init"

type initPage struct {
	layout layout.SinglePaneLayout
}

func (i initPage) Init() tea.Cmd {
	return nil
}

func (i initPage) Update(_ tea.Msg) (tea.Model, tea.Cmd) {
	return i, nil
}

func (i initPage) View() string {
	return "Initializing..."
}

func NewInitPage() tea.Model {
	return layout.NewSinglePane(
		&initPage{},
		layout.WithSinglePaneFocusable(true),
		layout.WithSinglePaneBordered(true),
		layout.WithSignlePaneBorderText(
			map[layout.BorderPosition]string{
				layout.TopMiddleBorder: "Welcome to termai",
			},
		),
	)
}
