package logs

import (
	"slices"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/opencode-ai/opencode/internal/logging"
	"github.com/opencode-ai/opencode/internal/pubsub"
	"github.com/opencode-ai/opencode/internal/tui/layout"
	// "github.com/opencode-ai/opencode/internal/tui/styles"
	"github.com/opencode-ai/opencode/internal/tui/theme"
	"github.com/opencode-ai/opencode/internal/tui/util"
)

type TableComponent interface {
	tea.Model
	layout.Sizeable
	layout.Bindings
}

type tableCmp struct {
	table   table.Model
	focused bool
}

type selectedLogMsg logging.LogMessage

func (i *tableCmp) Init() tea.Cmd {
	i.setRows()
	return nil
}

func (i *tableCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	switch msg.(type) {
	case pubsub.Event[logging.LogMessage]:
		i.setRows()
		return i, nil
	}
	
	// Only process keyboard input when focused
	if _, ok := msg.(tea.KeyMsg); ok && !i.focused {
		return i, nil
	}
	
	t, cmd := i.table.Update(msg)
	cmds = append(cmds, cmd)
	i.table = t
	selectedRow := i.table.SelectedRow()
	if selectedRow != nil {
		// Always send the selected log message when a row is selected
		// This fixes the issue where navigation doesn't update the detail pane
		// when returning to the logs page
		var log logging.LogMessage
		for _, row := range logging.List() {
			if row.ID == selectedRow[0] {
				log = row
				break
			}
		}
		if log.ID != "" {
			cmds = append(cmds, util.CmdHandler(selectedLogMsg(log)))
		}
	}
	return i, tea.Batch(cmds...)
}

func (i *tableCmp) View() string {
	t := theme.CurrentTheme()
	defaultStyles := table.DefaultStyles()
	defaultStyles.Selected = defaultStyles.Selected.Foreground(t.Primary())
	i.table.SetStyles(defaultStyles)
	return i.table.View()
}

func (i *tableCmp) GetSize() (int, int) {
	return i.table.Width(), i.table.Height()
}

func (i *tableCmp) SetSize(width int, height int) tea.Cmd {
	i.table.SetWidth(width)
	i.table.SetHeight(height)
	columns := i.table.Columns()

	// Calculate widths for visible columns
	timeWidth := 8  // Fixed width for Time column
	levelWidth := 7 // Fixed width for Level column

	// Message column gets the remaining space
	messageWidth := width - timeWidth - levelWidth - 5 // 5 for padding and borders

	// Set column widths
	columns[0].Width = 0 // ID column (hidden)
	columns[1].Width = timeWidth
	columns[2].Width = levelWidth
	columns[3].Width = messageWidth

	i.table.SetColumns(columns)
	return nil
}

func (i *tableCmp) BindingKeys() []key.Binding {
	return layout.KeyMapToSlice(i.table.KeyMap)
}

func (i *tableCmp) setRows() {
	rows := []table.Row{}

	logs := logging.List()
	slices.SortFunc(logs, func(a, b logging.LogMessage) int {
		if a.Time.Before(b.Time) {
			return 1
		}
		if a.Time.After(b.Time) {
			return -1
		}
		return 0
	})

	for _, log := range logs {
		// Include ID as hidden first column for selection
		row := table.Row{
			log.ID,
			log.Time.Format("15:04:05"),
			log.Level,
			log.Message,
		}
		rows = append(rows, row)
	}
	i.table.SetRows(rows)
}

func NewLogsTable() TableComponent {
	columns := []table.Column{
		{Title: "ID", Width: 0}, // ID column with zero width
		{Title: "Time", Width: 8},
		{Title: "Level", Width: 7},
		{Title: "Message", Width: 30},
	}

	tableModel := table.New(
		table.WithColumns(columns),
	)
	tableModel.Focus()
	return &tableCmp{
		table: tableModel,
	}
}

// Focus implements the focusable interface
func (i *tableCmp) Focus() {
	i.focused = true
	i.table.Focus()
}

// Blur implements the blurable interface
func (i *tableCmp) Blur() {
	i.focused = false
	// Table doesn't have a Blur method, but we can implement it here
	// to satisfy the interface
}
