package page

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/tui/components/repl"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
)

var ReplPage PageID = "repl"

func NewReplPage() tea.Model {
	return layout.NewBentoLayout(
		layout.BentoPanes{
			layout.BentoLeftPane:        repl.NewThreadsCmp(),
			layout.BentoRightTopPane:    repl.NewMessagesCmp(),
			layout.BentoRightBottomPane: repl.NewEditorCmp(),
		},
	)
}
