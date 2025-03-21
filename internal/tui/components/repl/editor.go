package repl

import tea "github.com/charmbracelet/bubbletea"

type editorCmp struct{}

func (i *editorCmp) Init() tea.Cmd {
	return nil
}

func (i *editorCmp) Update(_ tea.Msg) (tea.Model, tea.Cmd) {
	return i, nil
}

func (i *editorCmp) View() string {
	return "Editor"
}

func NewEditorCmp() tea.Model {
	return &editorCmp{}
}
