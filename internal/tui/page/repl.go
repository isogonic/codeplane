package page

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/tui/components/repl"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
)

var ReplPage PageID = "repl"

func NewReplPage(app *app.App) tea.Model {
	return layout.NewBentoLayout(
		layout.BentoPanes{
			layout.BentoLeftPane:        repl.NewSessionsCmp(app),
			layout.BentoRightTopPane:    repl.NewMessagesCmp(app),
			layout.BentoRightBottomPane: repl.NewEditorCmp(app),
		},
	)
}
