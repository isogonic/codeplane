package layout

import (
	"reflect"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
)

type Focusable interface {
	Focus() tea.Cmd
	Blur() tea.Cmd
	IsFocused() bool
}

type Bordered interface {
	BorderText() map[BorderPosition]string
}

type Sizeable interface {
	SetSize(width, height int)
	GetSize() (int, int)
}

type Bindings interface {
	BindingKeys() []key.Binding
}

func KeyMapToSlice(t any) (bindings []key.Binding) {
	typ := reflect.TypeOf(t)
	if typ.Kind() != reflect.Struct {
		return nil
	}
	for i := range typ.NumField() {
		v := reflect.ValueOf(t).Field(i)
		bindings = append(bindings, v.Interface().(key.Binding))
	}
	return
}
