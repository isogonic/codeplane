package util

import tea "github.com/charmbracelet/bubbletea"

func CmdHandler(msg tea.Msg) tea.Cmd {
	return func() tea.Msg {
		return msg
	}
}

func ReportError(err error) tea.Cmd {
	return CmdHandler(ErrorMsg(err))
}

type (
	InfoMsg  string
	ErrorMsg error
)
