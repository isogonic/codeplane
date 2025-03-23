package repl

import (
	"fmt"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/app"
	"github.com/kujtimiihoxha/termai/internal/session"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
	"github.com/kujtimiihoxha/termai/internal/tui/util"
)

type SessionsCmp interface {
	tea.Model
	layout.Sizeable
	layout.Focusable
	layout.Bordered
	layout.Bindings
}
type sessionsCmp struct {
	app     *app.App
	list    list.Model
	focused bool
}

type listItem struct {
	id, title, desc string
}

func (i listItem) Title() string       { return i.title }
func (i listItem) Description() string { return i.desc }
func (i listItem) FilterValue() string { return i.title }

type InsertSessionsMsg struct {
	sessions []session.Session
}

type SelectedSessionMsg struct {
	SessionID string
}

func (i *sessionsCmp) Init() tea.Cmd {
	existing, err := i.app.Sessions.List()
	if err != nil {
		return util.ReportError(err)
	}
	if len(existing) == 0 || existing[0].MessageCount > 0 {
		session, err := i.app.Sessions.Create(
			"New Session",
		)
		if err != nil {
			return util.ReportError(err)
		}
		existing = append(existing, session)
	}
	return tea.Batch(
		util.CmdHandler(InsertSessionsMsg{existing}),
		util.CmdHandler(SelectedSessionMsg{existing[0].ID}),
	)
}

func (i *sessionsCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case InsertSessionsMsg:
		items := make([]list.Item, len(msg.sessions))
		for i, s := range msg.sessions {
			items[i] = listItem{
				id:    s.ID,
				title: s.Title,
				desc:  fmt.Sprintf("Tokens: %d, Cost: %.2f", s.Tokens, s.Cost),
			}
		}
		return i, i.list.SetItems(items)
	}
	if i.focused {
		u, cmd := i.list.Update(msg)
		i.list = u
		return i, cmd
	}
	return i, nil
}

func (i *sessionsCmp) View() string {
	return i.list.View()
}

func (i *sessionsCmp) Blur() tea.Cmd {
	i.focused = false
	return nil
}

func (i *sessionsCmp) Focus() tea.Cmd {
	i.focused = true
	return nil
}

func (i *sessionsCmp) GetSize() (int, int) {
	return i.list.Width(), i.list.Height()
}

func (i *sessionsCmp) IsFocused() bool {
	return i.focused
}

func (i *sessionsCmp) SetSize(width int, height int) {
	i.list.SetSize(width, height)
}

func (i *sessionsCmp) BorderText() map[layout.BorderPosition]string {
	totalCount := len(i.list.Items())
	itemsPerPage := i.list.Paginator.PerPage
	currentPage := i.list.Paginator.Page

	current := min(currentPage*itemsPerPage+itemsPerPage, totalCount)

	pageInfo := fmt.Sprintf(
		"%d-%d of %d",
		currentPage*itemsPerPage+1,
		current,
		totalCount,
	)
	return map[layout.BorderPosition]string{
		layout.TopMiddleBorder:    "Sessions",
		layout.BottomMiddleBorder: pageInfo,
	}
}

func (i *sessionsCmp) BindingKeys() []key.Binding {
	return layout.KeyMapToSlice(i.list.KeyMap)
}

func NewSessionsCmp(app *app.App) SessionsCmp {
	listDelegate := list.NewDefaultDelegate()
	defaultItemStyle := list.NewDefaultItemStyles()
	defaultItemStyle.SelectedTitle = defaultItemStyle.SelectedTitle.BorderForeground(styles.Secondary).Foreground(styles.Primary)
	defaultItemStyle.SelectedDesc = defaultItemStyle.SelectedDesc.BorderForeground(styles.Secondary).Foreground(styles.Primary)

	defaultStyle := list.DefaultStyles()
	defaultStyle.FilterPrompt = defaultStyle.FilterPrompt.Foreground(styles.Secondary)
	defaultStyle.FilterCursor = defaultStyle.FilterCursor.Foreground(styles.Flamingo)

	listDelegate.Styles = defaultItemStyle

	listComponent := list.New([]list.Item{}, listDelegate, 0, 0)
	listComponent.FilterInput.PromptStyle = defaultStyle.FilterPrompt
	listComponent.FilterInput.Cursor.Style = defaultStyle.FilterCursor
	listComponent.SetShowTitle(false)
	listComponent.SetShowPagination(false)
	listComponent.SetShowHelp(false)
	listComponent.SetShowStatusBar(false)
	listComponent.DisableQuitKeybindings()

	return &sessionsCmp{
		app:     app,
		list:    listComponent,
		focused: false,
	}
}
