package core

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kujtimiihoxha/termai/internal/tui/styles"
)

type HelpCmp interface {
	tea.Model
	SetBindings(bindings []key.Binding)
	Height() int
}

const (
	helpWidgetHeight = 12
)

type helpCmp struct {
	width    int
	bindings []key.Binding
}

func (m *helpCmp) Init() tea.Cmd {
	return nil
}

func (m *helpCmp) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
	}
	return m, nil
}

func (m *helpCmp) View() string {
	helpKeyStyle := styles.Bold.Foreground(styles.Rosewater).Margin(0, 1, 0, 0)
	helpDescStyle := styles.Regular.Foreground(styles.Flamingo)
	// Compile list of bindings to render
	bindings := removeDuplicateBindings(m.bindings)
	// Enumerate through each group of bindings, populating a series of
	// pairs of columns, one for keys, one for descriptions
	var (
		pairs []string
		width int
		rows  = helpWidgetHeight - 2
	)
	for i := 0; i < len(bindings); i += rows {
		var (
			keys  []string
			descs []string
		)
		for j := i; j < min(i+rows, len(bindings)); j++ {
			keys = append(keys, helpKeyStyle.Render(bindings[j].Help().Key))
			descs = append(descs, helpDescStyle.Render(bindings[j].Help().Desc))
		}
		// Render pair of columns; beyond the first pair, render a three space
		// left margin, in order to visually separate the pairs.
		var cols []string
		if len(pairs) > 0 {
			cols = []string{"   "}
		}
		cols = append(cols,
			strings.Join(keys, "\n"),
			strings.Join(descs, "\n"),
		)

		pair := lipgloss.JoinHorizontal(lipgloss.Top, cols...)
		// check whether it exceeds the maximum width avail (the width of the
		// terminal, subtracting 2 for the borders).
		width += lipgloss.Width(pair)
		if width > m.width-2 {
			break
		}
		pairs = append(pairs, pair)
	}

	// Join pairs of columns and enclose in a border
	content := lipgloss.JoinHorizontal(lipgloss.Top, pairs...)
	return styles.DoubleBorder.Height(rows).PaddingLeft(1).Width(m.width - 2).Render(content)
}

func removeDuplicateBindings(bindings []key.Binding) []key.Binding {
	seen := make(map[string]struct{})
	result := make([]key.Binding, 0, len(bindings))

	// Process bindings in reverse order
	for i := len(bindings) - 1; i >= 0; i-- {
		b := bindings[i]
		k := strings.Join(b.Keys(), " ")
		if _, ok := seen[k]; ok {
			// duplicate, skip
			continue
		}
		seen[k] = struct{}{}
		// Add to the beginning of result to maintain original order
		result = append([]key.Binding{b}, result...)
	}

	return result
}

func (m *helpCmp) SetBindings(bindings []key.Binding) {
	m.bindings = bindings
}

func (m helpCmp) Height() int {
	return helpWidgetHeight
}

func NewHelpCmp() HelpCmp {
	return &helpCmp{
		width:    0,
		bindings: make([]key.Binding, 0),
	}
}
