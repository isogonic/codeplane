package core

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
)

// ButtonKeyMap defines key bindings for the button component
type ButtonKeyMap struct {
	Enter key.Binding
}

// DefaultButtonKeyMap returns default key bindings for the button
func DefaultButtonKeyMap() ButtonKeyMap {
	return ButtonKeyMap{
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "select"),
		),
	}
}

// ShortHelp returns keybinding help
func (k ButtonKeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Enter}
}

// FullHelp returns full help info for keybindings
func (k ButtonKeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Enter},
	}
}

// ButtonState represents the state of a button
type ButtonState int

const (
	// ButtonNormal is the default state
	ButtonNormal ButtonState = iota
	// ButtonHovered is when the button is focused/hovered
	ButtonHovered
	// ButtonPressed is when the button is being pressed
	ButtonPressed
	// ButtonDisabled is when the button is disabled
	ButtonDisabled
)

// ButtonVariant defines the visual style variant of a button
type ButtonVariant int

const (
	// ButtonPrimary uses primary color styling
	ButtonPrimary ButtonVariant = iota
	// ButtonSecondary uses secondary color styling
	ButtonSecondary
	// ButtonDanger uses danger/error color styling
	ButtonDanger
	// ButtonWarning uses warning color styling
	ButtonWarning
	// ButtonNeutral uses neutral color styling
	ButtonNeutral
)

// ButtonMsg is sent when a button is clicked
type ButtonMsg struct {
	ID      string
	Payload any
}

// ButtonCmp represents a clickable button component
type ButtonCmp struct {
	id         string
	label      string
	width      int
	height     int
	state      ButtonState
	variant    ButtonVariant
	keyMap     ButtonKeyMap
	payload    any
	style      lipgloss.Style
	hoverStyle lipgloss.Style
}

// NewButtonCmp creates a new button component
func NewButtonCmp(id, label string) *ButtonCmp {
	b := &ButtonCmp{
		id:      id,
		label:   label,
		state:   ButtonNormal,
		variant: ButtonPrimary,
		keyMap:  DefaultButtonKeyMap(),
		width:   len(label) + 4, // add some padding
		height:  1,
	}
	b.updateStyles()
	return b
}

// WithVariant sets the button variant
func (b *ButtonCmp) WithVariant(variant ButtonVariant) *ButtonCmp {
	b.variant = variant
	b.updateStyles()
	return b
}

// WithPayload sets the payload sent with button events
func (b *ButtonCmp) WithPayload(payload any) *ButtonCmp {
	b.payload = payload
	return b
}

// WithWidth sets a custom width
func (b *ButtonCmp) WithWidth(width int) *ButtonCmp {
	b.width = width
	b.updateStyles()
	return b
}

// updateStyles recalculates styles based on current state and variant
func (b *ButtonCmp) updateStyles() {
	// Base styles
	b.style = styles.Regular.
		Padding(0, 1).
		Width(b.width).
		Align(lipgloss.Center).
		BorderStyle(lipgloss.RoundedBorder())

	b.hoverStyle = b.style.
		Bold(true)

	// Variant-specific styling
	switch b.variant {
	case ButtonPrimary:
		b.style = b.style.
			Foreground(styles.Base).
			Background(styles.Primary).
			BorderForeground(styles.Primary)

		b.hoverStyle = b.hoverStyle.
			Foreground(styles.Base).
			Background(styles.Blue).
			BorderForeground(styles.Blue)

	case ButtonSecondary:
		b.style = b.style.
			Foreground(styles.Base).
			Background(styles.Secondary).
			BorderForeground(styles.Secondary)

		b.hoverStyle = b.hoverStyle.
			Foreground(styles.Base).
			Background(styles.Mauve).
			BorderForeground(styles.Mauve)

	case ButtonDanger:
		b.style = b.style.
			Foreground(styles.Base).
			Background(styles.Error).
			BorderForeground(styles.Error)

		b.hoverStyle = b.hoverStyle.
			Foreground(styles.Base).
			Background(styles.Red).
			BorderForeground(styles.Red)

	case ButtonWarning:
		b.style = b.style.
			Foreground(styles.Text).
			Background(styles.Warning).
			BorderForeground(styles.Warning)

		b.hoverStyle = b.hoverStyle.
			Foreground(styles.Text).
			Background(styles.Peach).
			BorderForeground(styles.Peach)

	case ButtonNeutral:
		b.style = b.style.
			Foreground(styles.Text).
			Background(styles.Grey).
			BorderForeground(styles.Grey)

		b.hoverStyle = b.hoverStyle.
			Foreground(styles.Text).
			Background(styles.DarkGrey).
			BorderForeground(styles.DarkGrey)
	}

	// Disabled style override
	if b.state == ButtonDisabled {
		b.style = b.style.
			Foreground(styles.SubText0).
			Background(styles.LightGrey).
			BorderForeground(styles.LightGrey)
	}
}

// SetSize sets the button size
func (b *ButtonCmp) SetSize(width, height int) {
	b.width = width
	b.height = height
	b.updateStyles()
}

// Focus sets the button to focused state
func (b *ButtonCmp) Focus() tea.Cmd {
	if b.state != ButtonDisabled {
		b.state = ButtonHovered
	}
	return nil
}

// Blur sets the button to normal state
func (b *ButtonCmp) Blur() tea.Cmd {
	if b.state != ButtonDisabled {
		b.state = ButtonNormal
	}
	return nil
}

// Disable sets the button to disabled state
func (b *ButtonCmp) Disable() {
	b.state = ButtonDisabled
	b.updateStyles()
}

// Enable enables the button if disabled
func (b *ButtonCmp) Enable() {
	if b.state == ButtonDisabled {
		b.state = ButtonNormal
		b.updateStyles()
	}
}

// IsDisabled returns whether the button is disabled
func (b *ButtonCmp) IsDisabled() bool {
	return b.state == ButtonDisabled
}

// IsFocused returns whether the button is focused
func (b *ButtonCmp) IsFocused() bool {
	return b.state == ButtonHovered
}

// Init initializes the button
func (b *ButtonCmp) Init() tea.Cmd {
	return nil
}

// Update handles messages and user input
func (b *ButtonCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Skip updates if disabled
	if b.state == ButtonDisabled {
		return b, nil
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Handle key presses when focused
		if b.state == ButtonHovered {
			switch {
			case key.Matches(msg, b.keyMap.Enter):
				b.state = ButtonPressed
				return b, func() tea.Msg {
					return ButtonMsg{
						ID:      b.id,
						Payload: b.payload,
					}
				}
			}
		}
	}

	return b, nil
}

// View renders the button
func (b *ButtonCmp) View() string {
	if b.state == ButtonHovered || b.state == ButtonPressed {
		return b.hoverStyle.Render(b.label)
	}
	return b.style.Render(b.label)
}

