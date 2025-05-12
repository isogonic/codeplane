package app

import (
	"context"
	"database/sql"
	"maps"
	"sync"
	"time"

	"log/slog"

	"github.com/opencode-ai/opencode/internal/config"
	"github.com/opencode-ai/opencode/internal/history"
	"github.com/opencode-ai/opencode/internal/llm/agent"
	"github.com/opencode-ai/opencode/internal/logging"
	"github.com/opencode-ai/opencode/internal/lsp"
	"github.com/opencode-ai/opencode/internal/message"
	"github.com/opencode-ai/opencode/internal/permission"
	"github.com/opencode-ai/opencode/internal/session"
	"github.com/opencode-ai/opencode/internal/status"
	"github.com/opencode-ai/opencode/internal/tui/theme"
)

type App struct {
	Logs        logging.Service
	Sessions    session.Service
	Messages    message.Service
	History     history.Service
	Permissions permission.Service
	Status      status.Service

	CoderAgent agent.Service

	LSPClients map[string]*lsp.Client

	clientsMutex sync.RWMutex

	watcherCancelFuncs []context.CancelFunc
	cancelFuncsMutex   sync.Mutex
	watcherWG          sync.WaitGroup
}

func New(ctx context.Context, conn *sql.DB) (*App, error) {
	err := logging.InitService(conn)
	if err != nil {
		slog.Error("Failed to initialize logging service", "error", err)
		return nil, err
	}
	err = session.InitService(conn)
	if err != nil {
		slog.Error("Failed to initialize session service", "error", err)
		return nil, err
	}
	err = message.InitService(conn)
	if err != nil {
		slog.Error("Failed to initialize message service", "error", err)
		return nil, err
	}
	err = history.InitService(conn)
	if err != nil {
		slog.Error("Failed to initialize history service", "error", err)
		return nil, err
	}
	err = permission.InitService()
	if err != nil {
		slog.Error("Failed to initialize permission service", "error", err)
		return nil, err
	}
	err = status.InitService()
	if err != nil {
		slog.Error("Failed to initialize status service", "error", err)
		return nil, err
	}

	app := &App{
		Logs:        logging.GetService(),
		Sessions:    session.GetService(),
		Messages:    message.GetService(),
		History:     history.GetService(),
		Permissions: permission.GetService(),
		Status:      status.GetService(),
		LSPClients:  make(map[string]*lsp.Client),
	}

	// Initialize theme based on configuration
	app.initTheme()

	// Initialize LSP clients in the background
	go app.initLSPClients(ctx)

	app.CoderAgent, err = agent.NewAgent(
		config.AgentCoder,
		app.Sessions,
		app.Messages,
		agent.CoderAgentTools(
			app.Permissions,
			app.Sessions,
			app.Messages,
			app.History,
			app.LSPClients,
		),
	)
	if err != nil {
		slog.Error("Failed to create coder agent", err)
		return nil, err
	}

	return app, nil
}

// initTheme sets the application theme based on the configuration
func (app *App) initTheme() {
	cfg := config.Get()
	if cfg == nil || cfg.TUI.Theme == "" {
		return // Use default theme
	}

	// Try to set the theme from config
	err := theme.SetTheme(cfg.TUI.Theme)
	if err != nil {
		slog.Warn("Failed to set theme from config, using default theme", "theme", cfg.TUI.Theme, "error", err)
	} else {
		slog.Debug("Set theme from config", "theme", cfg.TUI.Theme)
	}
}

// Shutdown performs a clean shutdown of the application
func (app *App) Shutdown() {
	// Cancel all watcher goroutines
	app.cancelFuncsMutex.Lock()
	for _, cancel := range app.watcherCancelFuncs {
		cancel()
	}
	app.cancelFuncsMutex.Unlock()
	app.watcherWG.Wait()

	// Perform additional cleanup for LSP clients
	app.clientsMutex.RLock()
	clients := make(map[string]*lsp.Client, len(app.LSPClients))
	maps.Copy(clients, app.LSPClients)
	app.clientsMutex.RUnlock()

	for name, client := range clients {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := client.Shutdown(shutdownCtx); err != nil {
			slog.Error("Failed to shutdown LSP client", "name", name, "error", err)
		}
		cancel()
	}
}
