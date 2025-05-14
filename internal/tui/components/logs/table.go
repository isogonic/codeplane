package logs

import (
	"context"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/sst/opencode/internal/logging"
	"github.com/sst/opencode/internal/pubsub"
	"github.com/sst/opencode/internal/tui/components/chat"
	"github.com/sst/opencode/internal/tui/layout"
	"github.com/sst/opencode/internal/tui/theme"
)

type TableComponent interface {
	tea.Model
	layout.Sizeable
	layout.Bindings
}

type tableCmp struct {
	table         table.Model
	focused       bool
	logs          []logging.Log
	selectedLogID string
}

type selectedLogMsg logging.Log

type logsLoadedMsg struct {
	logs []logging.Log
}

func (i *tableCmp) Init() tea.Cmd {
	return i.fetchLogs()
}

func (i *tableCmp) fetchLogs() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		loggingService := logging.GetService()
		if loggingService == nil {
			return nil
		}

		var logs []logging.Log
		var err error
		sessionId := "" // TODO: session.CurrentSessionID()

		// Limit the number of logs to improve performance
		const logLimit = 100
		if sessionId == "" {
			logs, err = loggingService.ListAll(ctx, logLimit)
		} else {
			logs, err = loggingService.ListBySession(ctx, sessionId)
			// Trim logs if there are too many
			if err == nil && len(logs) > logLimit {
				logs = logs[len(logs)-logLimit:]
			}
		}

		if err != nil {
			return nil
		}

		return logsLoadedMsg{logs: logs}
	}
}

func (i *tableCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case logsLoadedMsg:
		i.logs = msg.logs
		i.updateRows()
		return i, nil

	case chat.SessionSelectedMsg:
		return i, i.fetchLogs()

	case pubsub.Event[logging.Log]:
		// Only handle created events
		if msg.Type == logging.EventLogCreated {
			// Add the new log to our list
			i.logs = append([]logging.Log{msg.Payload}, i.logs...)
			// Keep the list at a reasonable size
			if len(i.logs) > 100 {
				i.logs = i.logs[:100]
			}
			i.updateRows()
		}
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
		// Only send message if it's a new selection
		if i.selectedLogID != selectedRow[0] {
			cmds = append(cmds, func() tea.Msg {
				for _, log := range i.logs {
					if log.ID == selectedRow[0] {
						return selectedLogMsg(log)
					}
				}
				return nil
			})
		}

	}

	i.selectedLogID = selectedRow[0]
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

func (i *tableCmp) updateRows() {
	rows := make([]table.Row, 0, len(i.logs))

	for _, log := range i.logs {
		timeStr := log.Timestamp.Local().Format("15:04:05")

		// Include ID as hidden first column for selection
		row := table.Row{
			log.ID,
			timeStr,
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
		logs:  []logging.Log{},
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
