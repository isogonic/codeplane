package styles

import (
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

func HuhTheme() *huh.Theme {
	t := huh.ThemeBase()

	t.Focused.Base = t.Focused.Base.BorderStyle(lipgloss.HiddenBorder())
	t.Focused.Title = t.Focused.Title.Foreground(Text)
	t.Focused.NoteTitle = t.Focused.NoteTitle.Foreground(Text)
	t.Focused.Directory = t.Focused.Directory.Foreground(Text)
	t.Focused.Description = t.Focused.Description.Foreground(SubText0)
	t.Focused.ErrorIndicator = t.Focused.ErrorIndicator.Foreground(Red)
	t.Focused.ErrorMessage = t.Focused.ErrorMessage.Foreground(Red)
	t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(Blue)
	t.Focused.NextIndicator = t.Focused.NextIndicator.Foreground(Blue)
	t.Focused.PrevIndicator = t.Focused.PrevIndicator.Foreground(Blue)
	t.Focused.Option = t.Focused.Option.Foreground(Text)
	t.Focused.MultiSelectSelector = t.Focused.MultiSelectSelector.Foreground(Blue)
	t.Focused.SelectedOption = t.Focused.SelectedOption.Foreground(Green)
	t.Focused.SelectedPrefix = t.Focused.SelectedPrefix.Foreground(Green)
	t.Focused.UnselectedPrefix = t.Focused.UnselectedPrefix.Foreground(Text)
	t.Focused.UnselectedOption = t.Focused.UnselectedOption.Foreground(Text)
	t.Focused.FocusedButton = t.Focused.FocusedButton.Foreground(Base).Background(Blue)
	t.Focused.BlurredButton = t.Focused.BlurredButton.Foreground(Text).Background(Base)

	t.Focused.TextInput.Cursor = t.Focused.TextInput.Cursor.Foreground(Teal)
	t.Focused.TextInput.Placeholder = t.Focused.TextInput.Placeholder.Foreground(Overlay0)
	t.Focused.TextInput.Prompt = t.Focused.TextInput.Prompt.Foreground(Blue)

	t.Blurred = t.Focused
	t.Blurred.Base = t.Blurred.Base.BorderStyle(lipgloss.HiddenBorder())

	t.Help.Ellipsis = t.Help.Ellipsis.Foreground(SubText0)
	t.Help.ShortKey = t.Help.ShortKey.Foreground(SubText0)
	t.Help.ShortDesc = t.Help.ShortDesc.Foreground(Ovelay1)
	t.Help.ShortSeparator = t.Help.ShortSeparator.Foreground(SubText0)
	t.Help.FullKey = t.Help.FullKey.Foreground(SubText0)
	t.Help.FullDesc = t.Help.FullDesc.Foreground(Ovelay1)
	t.Help.FullSeparator = t.Help.FullSeparator.Foreground(SubText0)

	return t
}
