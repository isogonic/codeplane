package dialog

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/permission"
	"github.com/kujtimiihoxha/termai/internal/tui/components/core"
	"github.com/kujtimiihoxha/termai/internal/tui/layout"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
	"github.com/kujtimiihoxha/termai/internal/tui/util"

	"github.com/charmbracelet/huh"
)

type PermissionAction string

// Permission responses
const (
	PermissionAllow           PermissionAction = "allow"
	PermissionAllowForSession PermissionAction = "allow_session"
	PermissionDeny            PermissionAction = "deny"
)

// PermissionResponseMsg represents the user's response to a permission request
type PermissionResponseMsg struct {
	Permission permission.PermissionRequest
	Action     PermissionAction
}

// Width and height constants for the dialog
var (
	permissionWidth  = 60
	permissionHeight = 10
)

// PermissionDialog interface for permission dialog component
type PermissionDialog interface {
	tea.Model
	layout.Sizeable
	layout.Bindings
}

// permissionDialogCmp is the implementation of PermissionDialog
type permissionDialogCmp struct {
	form       *huh.Form
	content    string
	width      int
	height     int
	permission permission.PermissionRequest
}

func (p *permissionDialogCmp) Init() tea.Cmd {
	return nil
}

func (p *permissionDialogCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	// Process the form
	form, cmd := p.form.Update(msg)
	if f, ok := form.(*huh.Form); ok {
		p.form = f
		cmds = append(cmds, cmd)
	}

	if p.form.State == huh.StateCompleted {
		// Get the selected action
		action := p.form.GetString("action")

		// Close the dialog and return the response
		return p, tea.Batch(
			util.CmdHandler(core.DialogCloseMsg{}),
			util.CmdHandler(PermissionResponseMsg{Action: PermissionAction(action), Permission: p.permission}),
		)
	}

	return p, tea.Batch(cmds...)
}

func (p *permissionDialogCmp) View() string {
	contentStyle := lipgloss.NewStyle().
		Width(p.width).
		Padding(1, 0).
		Foreground(styles.Text).
		Align(lipgloss.Center)

	return lipgloss.JoinVertical(
		lipgloss.Center,
		contentStyle.Render(p.content),
		p.form.View(),
	)
}

func (p *permissionDialogCmp) GetSize() (int, int) {
	return p.width, p.height
}

func (p *permissionDialogCmp) SetSize(width int, height int) {
	p.width = width
	p.height = height
}

func (p *permissionDialogCmp) BindingKeys() []key.Binding {
	return p.form.KeyBinds()
}

func newPermissionDialogCmp(permission permission.PermissionRequest, content string) PermissionDialog {
	// Create a note field for displaying the content

	// Create select field for the permission options
	selectOption := huh.NewSelect[string]().
		Key("action").
		Options(
			huh.NewOption("Allow", string(PermissionAllow)),
			huh.NewOption("Allow for this session", string(PermissionAllowForSession)),
			huh.NewOption("Deny", string(PermissionDeny)),
		).
		Title("Permission Request")

	// Apply theme
	theme := styles.HuhTheme()

	// Setup form width and height
	form := huh.NewForm(huh.NewGroup(selectOption)).
		WithWidth(permissionWidth - 2).
		WithShowHelp(false).
		WithTheme(theme).
		WithShowErrors(false)

	// Focus the form for immediate interaction
	selectOption.Focus()

	return &permissionDialogCmp{
		permission: permission,
		form:       form,
		content:    content,
		width:      permissionWidth,
		height:     permissionHeight,
	}
}

// NewPermissionDialogCmd creates a new permission dialog command
func NewPermissionDialogCmd(permission permission.PermissionRequest, content string) tea.Cmd {
	permDialog := newPermissionDialogCmp(permission, content)

	// Create the dialog layout
	dialogPane := layout.NewSinglePane(
		permDialog.(*permissionDialogCmp),
		layout.WithSignlePaneSize(permissionWidth+2, permissionHeight+2),
		layout.WithSinglePaneBordered(true),
		layout.WithSinglePaneFocusable(true),
		layout.WithSinglePaneActiveColor(styles.Blue),
		layout.WithSignlePaneBorderText(map[layout.BorderPosition]string{
			layout.TopMiddleBorder: " Permission Required ",
		}),
	)

	// Focus the dialog
	dialogPane.Focus()

	// Return the dialog command
	return util.CmdHandler(core.DialogMsg{
		Content: dialogPane,
	})
}

