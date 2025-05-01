package tool

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/opencode-ai/opencode/internal/config"
	"github.com/opencode-ai/opencode/internal/logging"
	"github.com/opencode-ai/opencode/internal/lsp/discovery"
)

// ConfigureLspServerRequest represents the request for the configureLspServer tool
type ConfigureLspServerRequest struct {
	// Language identifier (e.g., "go", "typescript", "python")
	Language string `json:"language"`
}

// ConfigureLspServerResponse represents the response from the configureLspServer tool
type ConfigureLspServerResponse struct {
	// Whether the server was found
	Found bool `json:"found"`

	// Path to the server executable
	Path string `json:"path,omitempty"`

	// Command to run the server
	Command string `json:"command,omitempty"`

	// Arguments to pass to the command
	Args []string `json:"args,omitempty"`

	// Installation instructions if the server was not found
	InstallInstructions string `json:"installInstructions,omitempty"`

	// Whether the server was added to the configuration
	Added bool `json:"added,omitempty"`
}

// ConfigureLspServer searches for an LSP server for the given language
func ConfigureLspServer(ctx context.Context, rawArgs json.RawMessage) (any, error) {
	var args ConfigureLspServerRequest
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("failed to parse arguments: %w", err)
	}

	if args.Language == "" {
		return nil, fmt.Errorf("language parameter is required")
	}

	// Find the LSP server for the language
	serverInfo, err := discovery.FindLSPServer(args.Language)
	if err != nil {
		// Server not found, return instructions
		return ConfigureLspServerResponse{
			Found:              false,
			Command:            serverInfo.Command,
			Args:               serverInfo.Args,
			InstallInstructions: serverInfo.InstallCmd,
			Added:              false,
		}, nil
	}

	// Server found, update the configuration if available
	added := false
	if serverInfo.Available {
		// Get the current configuration
		cfg := config.Get()
		if cfg != nil {
			// Add the server to the configuration
			cfg.LSP[args.Language] = config.LSPConfig{
				Disabled: false,
				Command:  serverInfo.Path,
				Args:     serverInfo.Args,
			}
			added = true
			logging.Info("Added LSP server to configuration", 
				"language", args.Language, 
				"command", serverInfo.Command, 
				"path", serverInfo.Path)
		}
	}

	// Return the server information
	return ConfigureLspServerResponse{
		Found:   true,
		Path:    serverInfo.Path,
		Command: serverInfo.Command,
		Args:    serverInfo.Args,
		Added:   added,
	}, nil
}