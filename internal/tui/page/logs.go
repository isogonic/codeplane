package page

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/tui/components/logs"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
)

var LogsPage PageID = "logs"

func NewLogsPage() tea.Model {
	p := layout.NewSinglePane(
		logs.NewLogsTable(),
		layout.WithSinglePaneFocusable(true),
		layout.WithSinglePaneBordered(true),
		layout.WithSignlePaneBorderText(
			map[layout.BorderPosition]string{
				layout.TopMiddleBorder: "Logs",
			},
		),
		layout.WithSinglePanePadding(1),
	)
	p.Focus()
	return p
}
