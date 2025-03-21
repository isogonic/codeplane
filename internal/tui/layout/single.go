package layout

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type SinglePaneLayout interface {
	tea.Model
	Focusable
	Sizeable
	Bindings
}

type singlePaneLayout struct {
	width  int
	height int

	focusable bool
	focused   bool

	bordered   bool
	borderText map[BorderPosition]string

	content tea.Model

	padding []int
}

type SinglePaneOption func(*singlePaneLayout)

func (s singlePaneLayout) Init() tea.Cmd {
	return s.content.Init()
}

func (s singlePaneLayout) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		s.SetSize(msg.Width, msg.Height)
		return s, nil
	}
	u, cmd := s.content.Update(msg)
	s.content = u
	return s, cmd
}

func (s singlePaneLayout) View() string {
	style := lipgloss.NewStyle().Width(s.width).Height(s.height)
	if s.bordered {
		style = style.Width(s.width).Height(s.height)
	}
	if s.padding != nil {
		style = style.Padding(s.padding...)
	}
	content := style.Render(s.content.View())
	if s.bordered {
		if s.borderText == nil {
			s.borderText = map[BorderPosition]string{}
		}
		if bordered, ok := s.content.(Bordered); ok {
			s.borderText = bordered.BorderText()
		}
		return Borderize(content, s.focused, s.borderText)
	}
	return content
}

func (s *singlePaneLayout) Blur() tea.Cmd {
	if s.focusable {
		s.focused = false
	}
	if blurable, ok := s.content.(Focusable); ok {
		return blurable.Blur()
	}
	return nil
}

func (s *singlePaneLayout) Focus() tea.Cmd {
	if s.focusable {
		s.focused = true
	}
	if focusable, ok := s.content.(Focusable); ok {
		return focusable.Focus()
	}
	return nil
}

func (s *singlePaneLayout) SetSize(width, height int) {
	s.width = width
	s.height = height
	if s.bordered {
		s.width -= 2
		s.height -= 2
	}
	if s.padding != nil {
		if len(s.padding) == 1 {
			s.width -= s.padding[0] * 2
			s.height -= s.padding[0] * 2
		} else if len(s.padding) == 2 {
			s.width -= s.padding[0] * 2
			s.height -= s.padding[1] * 2
		} else if len(s.padding) == 3 {
			s.width -= s.padding[0] * 2
			s.height -= s.padding[1] + s.padding[2]
		} else if len(s.padding) == 4 {
			s.width -= s.padding[0] + s.padding[2]
			s.height -= s.padding[1] + s.padding[3]
		}
	}
	if s.content != nil {
		if c, ok := s.content.(Sizeable); ok {
			c.SetSize(s.width, s.height)
		}
	}
}

func (s *singlePaneLayout) IsFocused() bool {
	return s.focused
}

func (s *singlePaneLayout) GetSize() (int, int) {
	return s.width, s.height
}

func (s *singlePaneLayout) BindingKeys() []key.Binding {
	if b, ok := s.content.(Bindings); ok {
		return b.BindingKeys()
	}
	return []key.Binding{}
}

func NewSinglePane(content tea.Model, opts ...SinglePaneOption) SinglePaneLayout {
	layout := &singlePaneLayout{
		content: content,
	}
	for _, opt := range opts {
		opt(layout)
	}
	return layout
}

func WithSignlePaneSize(width, height int) SinglePaneOption {
	return func(opts *singlePaneLayout) {
		opts.width = width
		opts.height = height
	}
}

func WithSinglePaneFocusable(focusable bool) SinglePaneOption {
	return func(opts *singlePaneLayout) {
		opts.focusable = focusable
	}
}

func WithSinglePaneBordered(bordered bool) SinglePaneOption {
	return func(opts *singlePaneLayout) {
		opts.bordered = bordered
	}
}

func WithSignlePaneBorderText(borderText map[BorderPosition]string) SinglePaneOption {
	return func(opts *singlePaneLayout) {
		opts.borderText = borderText
	}
}

func WithSinglePanePadding(padding ...int) SinglePaneOption {
	return func(opts *singlePaneLayout) {
		opts.padding = padding
	}
}
