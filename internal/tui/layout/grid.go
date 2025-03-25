package layout

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type GridLayout interface {
	tea.Model
	Sizeable
	Bindings
	Panes() [][]tea.Model
}

type gridLayout struct {
	width  int
	height int

	rows    int
	columns int

	panes [][]tea.Model

	gap       int
	bordered  bool
	focusable bool

	currentRow    int
	currentColumn int

	activeColor lipgloss.TerminalColor
}

type GridOption func(*gridLayout)

func (g *gridLayout) Init() tea.Cmd {
	var cmds []tea.Cmd
	for i := range g.panes {
		for j := range g.panes[i] {
			if g.panes[i][j] != nil {
				cmds = append(cmds, g.panes[i][j].Init())
			}
		}
	}
	return tea.Batch(cmds...)
}

func (g *gridLayout) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		g.SetSize(msg.Width, msg.Height)
		return g, nil
	case tea.KeyMsg:
		if key.Matches(msg, g.nextPaneBinding()) {
			return g.focusNextPane()
		}
	}

	// Update all panes
	for i := range g.panes {
		for j := range g.panes[i] {
			if g.panes[i][j] != nil {
				var cmd tea.Cmd
				g.panes[i][j], cmd = g.panes[i][j].Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
			}
		}
	}

	return g, tea.Batch(cmds...)
}

func (g *gridLayout) focusNextPane() (tea.Model, tea.Cmd) {
	if !g.focusable {
		return g, nil
	}

	var cmds []tea.Cmd

	// Blur current pane
	if g.currentRow < len(g.panes) && g.currentColumn < len(g.panes[g.currentRow]) {
		if currentPane, ok := g.panes[g.currentRow][g.currentColumn].(Focusable); ok {
			cmds = append(cmds, currentPane.Blur())
		}
	}

	// Find next valid pane
	g.currentColumn++
	if g.currentColumn >= len(g.panes[g.currentRow]) {
		g.currentColumn = 0
		g.currentRow++
		if g.currentRow >= len(g.panes) {
			g.currentRow = 0
		}
	}

	// Focus next pane
	if g.currentRow < len(g.panes) && g.currentColumn < len(g.panes[g.currentRow]) {
		if nextPane, ok := g.panes[g.currentRow][g.currentColumn].(Focusable); ok {
			cmds = append(cmds, nextPane.Focus())
		}
	}

	return g, tea.Batch(cmds...)
}

func (g *gridLayout) nextPaneBinding() key.Binding {
	return key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "next pane"),
	)
}

func (g *gridLayout) View() string {
	if len(g.panes) == 0 {
		return ""
	}

	// Calculate dimensions for each cell
	cellWidth := (g.width - (g.columns-1)*g.gap) / g.columns
	cellHeight := (g.height - (g.rows-1)*g.gap) / g.rows

	// Render each row
	rows := make([]string, g.rows)
	for i := 0; i < g.rows; i++ {
		// Render each column in this row
		cols := make([]string, len(g.panes[i]))
		for j := 0; j < len(g.panes[i]); j++ {
			if g.panes[i][j] == nil {
				cols[j] = ""
				continue
			}

			// Set size for each pane
			if sizable, ok := g.panes[i][j].(Sizeable); ok {
				effectiveWidth, effectiveHeight := cellWidth, cellHeight
				if g.bordered {
					effectiveWidth -= 2
					effectiveHeight -= 2
				}
				sizable.SetSize(effectiveWidth, effectiveHeight)
			}

			// Render the pane
			content := g.panes[i][j].View()
			
			// Apply border if needed
			if g.bordered {
				isFocused := false
				if focusable, ok := g.panes[i][j].(Focusable); ok {
					isFocused = focusable.IsFocused()
				}
				
				borderText := map[BorderPosition]string{}
				if bordered, ok := g.panes[i][j].(Bordered); ok {
					borderText = bordered.BorderText()
				}
				
				content = Borderize(content, BorderOptions{
					Active:       isFocused,
					EmbeddedText: borderText,
				})
			}
			
			cols[j] = content
		}
		
		// Join columns with gap
		rows[i] = lipgloss.JoinHorizontal(lipgloss.Top, cols...)
	}
	
	// Join rows with gap
	return lipgloss.JoinVertical(lipgloss.Left, rows...)
}

func (g *gridLayout) SetSize(width, height int) {
	g.width = width
	g.height = height
}

func (g *gridLayout) GetSize() (int, int) {
	return g.width, g.height
}

func (g *gridLayout) BindingKeys() []key.Binding {
	var bindings []key.Binding
	bindings = append(bindings, g.nextPaneBinding())
	
	// Collect bindings from all panes
	for i := range g.panes {
		for j := range g.panes[i] {
			if g.panes[i][j] != nil {
				if bindable, ok := g.panes[i][j].(Bindings); ok {
					bindings = append(bindings, bindable.BindingKeys()...)
				}
			}
		}
	}
	
	return bindings
}

func (g *gridLayout) Panes() [][]tea.Model {
	return g.panes
}

// NewGridLayout creates a new grid layout with the given number of rows and columns
func NewGridLayout(rows, cols int, panes [][]tea.Model, opts ...GridOption) GridLayout {
	grid := &gridLayout{
		rows:    rows,
		columns: cols,
		panes:   panes,
		gap:     1,
	}
	
	for _, opt := range opts {
		opt(grid)
	}
	
	return grid
}

// WithGridGap sets the gap between cells
func WithGridGap(gap int) GridOption {
	return func(g *gridLayout) {
		g.gap = gap
	}
}

// WithGridBordered sets whether cells should have borders
func WithGridBordered(bordered bool) GridOption {
	return func(g *gridLayout) {
		g.bordered = bordered
	}
}

// WithGridFocusable sets whether the grid supports focus navigation
func WithGridFocusable(focusable bool) GridOption {
	return func(g *gridLayout) {
		g.focusable = focusable
	}
}

// WithGridActiveColor sets the active border color
func WithGridActiveColor(color lipgloss.TerminalColor) GridOption {
	return func(g *gridLayout) {
		g.activeColor = color
	}
}
