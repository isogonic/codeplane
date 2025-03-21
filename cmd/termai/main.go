package main

import (
	"context"
	"sync"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/kujtimiihoxha/termai/internal/logging"
	"github.com/kujtimiihoxha/termai/internal/tui"
)

var log = logging.Get()

func main() {
	log.Info("Starting termai...")
	ctx := context.Background()

	app := tea.NewProgram(
		tui.New(),
		tea.WithAltScreen(),
	)
	log.Info("Setting up subscriptions...")
	ch, unsub := setupSubscriptions(ctx)
	defer unsub()

	go func() {
		for msg := range ch {
			app.Send(msg)
		}
	}()
	if _, err := app.Run(); err != nil {
		panic(err)
	}
}

func setupSubscriptions(ctx context.Context) (chan tea.Msg, func()) {
	ch := make(chan tea.Msg)
	wg := sync.WaitGroup{}
	ctx, cancel := context.WithCancel(ctx)

	{
		sub := log.Subscribe(ctx)
		wg.Add(1)
		go func() {
			for ev := range sub {
				ch <- ev
			}
			wg.Done()
		}()
	}
	// cleanup function to be invoked when program is terminated.
	return ch, func() {
		cancel()
		// Wait for relays to finish before closing channel, to avoid sends
		// to a closed channel, which would result in a panic.
		wg.Wait()
		close(ch)
	}
}
