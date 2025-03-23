package logs

import (
	"encoding/json"
	"slices"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/logging"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
)

type TableComponent interface {
	tea.Model
	layout.Focusable
	layout.Sizeable
	layout.Bindings
}

var logger = logging.Get()

type tableCmp struct {
	table table.Model
}

func (i *tableCmp) Init() tea.Cmd {
	i.setRows()
	return nil
}

func (i *tableCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if i.table.Focused() {
		switch msg := msg.(type) {
		case pubsub.Event[logging.Message]:
			i.setRows()
			return i, nil
		case tea.KeyMsg:
			if msg.String() == "ctrl+s" {
				logger.Info("Saving logs...",
					"rows", len(i.table.Rows()),
				)
			}
		}
		t, cmd := i.table.Update(msg)
		i.table = t
		return i, cmd
	}
	return i, nil
}

func (i *tableCmp) View() string {
	return i.table.View()
}

func (i *tableCmp) Blur() tea.Cmd {
	i.table.Blur()
	return nil
}

func (i *tableCmp) Focus() tea.Cmd {
	i.table.Focus()
	return nil
}

func (i *tableCmp) IsFocused() bool {
	return i.table.Focused()
}

func (i *tableCmp) GetSize() (int, int) {
	return i.table.Width(), i.table.Height()
}

func (i *tableCmp) SetSize(width int, height int) {
	i.table.SetWidth(width)
	i.table.SetHeight(height)
	cloumns := i.table.Columns()
	for i, col := range cloumns {
		col.Width = (width / len(cloumns)) - 2
		cloumns[i] = col
	}
	i.table.SetColumns(cloumns)
}

func (i *tableCmp) BindingKeys() []key.Binding {
	return layout.KeyMapToSlice(i.table.KeyMap)
}

func (i *tableCmp) setRows() {
	rows := []table.Row{}

	logs := logger.List()
	slices.SortFunc(logs, func(a, b logging.Message) int {
		if a.Time.Before(b.Time) {
			return 1
		}
		if a.Time.After(b.Time) {
			return -1
		}
		return 0
	})

	for _, log := range logs {
		bm, _ := json.Marshal(log.Attributes)

		row := table.Row{
			log.Time.Format("15:04:05"),
			log.Level,
			log.Message,
			string(bm),
		}
		rows = append(rows, row)
	}
	i.table.SetRows(rows)
}

func NewLogsTable() TableComponent {
	columns := []table.Column{
		{Title: "Time", Width: 4},
		{Title: "Level", Width: 10},
		{Title: "Message", Width: 10},
		{Title: "Attributes", Width: 10},
	}
	defaultStyles := table.DefaultStyles()
	defaultStyles.Selected = defaultStyles.Selected.Foreground(styles.Primary)
	tableModel := table.New(
		table.WithColumns(columns),
		table.WithStyles(defaultStyles),
	)
	return &tableCmp{
		table: tableModel,
	}
}
