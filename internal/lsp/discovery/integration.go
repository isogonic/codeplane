package discovery

import (
	"fmt"

	"github.com/opencode-ai/opencode/internal/config"
	"github.com/opencode-ai/opencode/internal/logging"
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
		logging.Info("Running initial LSP auto-discovery...")
	} else {
		logging.Debug("Running LSP auto-discovery to detect new languages...")
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
			logging.Debug("LSP server already configured for language", "language", langID)
			continue
		}

		if serverInfo.Available {
			// Only add servers that were found
			cfg.LSP[langID] = config.LSPConfig{
				Disabled: false,
				Command:  serverInfo.Path,
				Args:     serverInfo.Args,
			}
			logging.Info("Added LSP server to configuration", 
				"language", langID, 
				"command", serverInfo.Command, 
				"path", serverInfo.Path)
		} else {
			logging.Warn("LSP server not available", 
				"language", langID, 
				"command", serverInfo.Command, 
				"installCmd", serverInfo.InstallCmd)
		}
	}

	// Mark the project as initialized
	if shouldInit {
		if err := config.MarkProjectInitialized(); err != nil {
			logging.Warn("Failed to mark project as initialized", "error", err)
		}
	}

	return nil
}