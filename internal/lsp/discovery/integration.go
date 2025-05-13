package discovery

import (
	"fmt"

	"github.com/sst/opencode/internal/config"
	"log/slog"
)

// IntegrateLSPServers discovers languages and LSP servers and integrates them into the application configuration
func IntegrateLSPServers(workingDir string) error {
	// Get the current configuration
	cfg := config.Get()
	if cfg == nil {
		return fmt.Errorf("config not loaded")
	}

	// Check if this is the first run
	shouldInit, err := config.ShouldShowInitDialog()
	if err != nil {
		return fmt.Errorf("failed to check initialization status: %w", err)
	}

	// Always run language detection, but log differently for first run vs. subsequent runs
	if shouldInit || len(cfg.LSP) == 0 {
		slog.Info("Running initial LSP auto-discovery...")
	} else {
		slog.Debug("Running LSP auto-discovery to detect new languages...")
	}

	// Configure LSP servers
	servers, err := ConfigureLSPServers(workingDir)
	if err != nil {
		return fmt.Errorf("failed to configure LSP servers: %w", err)
	}

	// Update the configuration with discovered servers
	for langID, serverInfo := range servers {
		// Skip languages that already have a configured server
		if _, exists := cfg.LSP[langID]; exists {
			slog.Debug("LSP server already configured for language", "language", langID)
			continue
		}

		if serverInfo.Available {
			// Only add servers that were found
			cfg.LSP[langID] = config.LSPConfig{
				Disabled: false,
				Command:  serverInfo.Path,
				Args:     serverInfo.Args,
			}
			slog.Info("Added LSP server to configuration",
				"language", langID,
				"command", serverInfo.Command,
				"path", serverInfo.Path)
		} else {
			slog.Warn("LSP server not available",
				"language", langID,
				"command", serverInfo.Command,
				"installCmd", serverInfo.InstallCmd)
		}
	}

	return nil
}
