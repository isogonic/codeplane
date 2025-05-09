package discovery

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"log/slog"
)

// ServerInfo contains information about an LSP server
type ServerInfo struct {
	// Command to run the server
	Command string

	// Arguments to pass to the command
	Args []string

	// Command to install the server (for user guidance)
	InstallCmd string

	// Whether this server is available
	Available bool

	// Full path to the executable (if found)
	Path string
}

// LanguageServerMap maps language IDs to their corresponding LSP servers
var LanguageServerMap = map[string]ServerInfo{
	"go": {
		Command:    "gopls",
		InstallCmd: "go install golang.org/x/tools/gopls@latest",
	},
	"typescript": {
		Command:    "typescript-language-server",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g typescript-language-server typescript",
	},
	"javascript": {
		Command:    "typescript-language-server",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g typescript-language-server typescript",
	},
	"python": {
		Command:    "pylsp",
		InstallCmd: "pip install python-lsp-server",
	},
	"rust": {
		Command:    "rust-analyzer",
		InstallCmd: "rustup component add rust-analyzer",
	},
	"java": {
		Command:    "jdtls",
		InstallCmd: "Install Eclipse JDT Language Server",
	},
	"c": {
		Command:    "clangd",
		InstallCmd: "Install clangd from your package manager",
	},
	"cpp": {
		Command:    "clangd",
		InstallCmd: "Install clangd from your package manager",
	},
	"php": {
		Command:    "intelephense",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g intelephense",
	},
	"ruby": {
		Command:    "solargraph",
		Args:       []string{"stdio"},
		InstallCmd: "gem install solargraph",
	},
	"lua": {
		Command:    "lua-language-server",
		InstallCmd: "Install lua-language-server from your package manager",
	},
	"html": {
		Command:    "vscode-html-language-server",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g vscode-langservers-extracted",
	},
	"css": {
		Command:    "vscode-css-language-server",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g vscode-langservers-extracted",
	},
	"json": {
		Command:    "vscode-json-language-server",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g vscode-langservers-extracted",
	},
	"yaml": {
		Command:    "yaml-language-server",
		Args:       []string{"--stdio"},
		InstallCmd: "npm install -g yaml-language-server",
	},
}

// FindLSPServer searches for an LSP server for the given language
func FindLSPServer(languageID string) (ServerInfo, error) {
	// Get server info for the language
	serverInfo, exists := LanguageServerMap[languageID]
	if !exists {
		return ServerInfo{}, fmt.Errorf("no LSP server defined for language: %s", languageID)
	}

	// Check if the command is in PATH
	path, err := exec.LookPath(serverInfo.Command)
	if err == nil {
		serverInfo.Available = true
		serverInfo.Path = path
		slog.Debug("Found LSP server in PATH", "language", languageID, "command", serverInfo.Command, "path", path)
		return serverInfo, nil
	}

	// If not in PATH, search in common installation locations
	paths := getCommonLSPPaths(languageID, serverInfo.Command)
	for _, searchPath := range paths {
		if _, err := os.Stat(searchPath); err == nil {
			// Found the server
			serverInfo.Available = true
			serverInfo.Path = searchPath
			slog.Debug("Found LSP server in common location", "language", languageID, "command", serverInfo.Command, "path", searchPath)
			return serverInfo, nil
		}
	}

	// Server not found
	slog.Debug("LSP server not found", "language", languageID, "command", serverInfo.Command)
	return serverInfo, fmt.Errorf("LSP server for %s not found. Install with: %s", languageID, serverInfo.InstallCmd)
}

// getCommonLSPPaths returns common installation paths for LSP servers based on language and OS
func getCommonLSPPaths(languageID, command string) []string {
	var paths []string
	homeDir, err := os.UserHomeDir()
	if err != nil {
		slog.Error("Failed to get user home directory", "error", err)
		return paths
	}

	// Add platform-specific paths
	switch runtime.GOOS {
	case "darwin":
		// macOS paths
		paths = append(paths,
			fmt.Sprintf("/usr/local/bin/%s", command),
			fmt.Sprintf("/opt/homebrew/bin/%s", command),
			fmt.Sprintf("%s/.local/bin/%s", homeDir, command),
		)
	case "linux":
		// Linux paths
		paths = append(paths,
			fmt.Sprintf("/usr/bin/%s", command),
			fmt.Sprintf("/usr/local/bin/%s", command),
			fmt.Sprintf("%s/.local/bin/%s", homeDir, command),
		)
	case "windows":
		// Windows paths
		paths = append(paths,
			fmt.Sprintf("%s\\AppData\\Local\\Programs\\%s.exe", homeDir, command),
			fmt.Sprintf("C:\\Program Files\\%s\\bin\\%s.exe", command, command),
		)
	}

	// Add language-specific paths
	switch languageID {
	case "go":
		gopath := os.Getenv("GOPATH")
		if gopath == "" {
			gopath = filepath.Join(homeDir, "go")
		}
		paths = append(paths, filepath.Join(gopath, "bin", command))
		if runtime.GOOS == "windows" {
			paths = append(paths, filepath.Join(gopath, "bin", command+".exe"))
		}
	case "typescript", "javascript", "html", "css", "json", "yaml", "php":
		// Node.js global packages
		if runtime.GOOS == "windows" {
			paths = append(paths,
				fmt.Sprintf("%s\\AppData\\Roaming\\npm\\%s.cmd", homeDir, command),
				fmt.Sprintf("%s\\AppData\\Roaming\\npm\\node_modules\\.bin\\%s.cmd", homeDir, command),
			)
		} else {
			paths = append(paths,
				fmt.Sprintf("%s/.npm-global/bin/%s", homeDir, command),
				fmt.Sprintf("%s/.nvm/versions/node/*/bin/%s", homeDir, command),
				fmt.Sprintf("/usr/local/lib/node_modules/.bin/%s", command),
			)
		}
	case "python":
		// Python paths
		if runtime.GOOS == "windows" {
			paths = append(paths,
				fmt.Sprintf("%s\\AppData\\Local\\Programs\\Python\\Python*\\Scripts\\%s.exe", homeDir, command),
				fmt.Sprintf("C:\\Python*\\Scripts\\%s.exe", command),
			)
		} else {
			paths = append(paths,
				fmt.Sprintf("%s/.local/bin/%s", homeDir, command),
				fmt.Sprintf("%s/.pyenv/shims/%s", homeDir, command),
				fmt.Sprintf("/usr/local/bin/%s", command),
			)
		}
	case "rust":
		// Rust paths
		if runtime.GOOS == "windows" {
			paths = append(paths,
				fmt.Sprintf("%s\\.rustup\\toolchains\\*\\bin\\%s.exe", homeDir, command),
				fmt.Sprintf("%s\\.cargo\\bin\\%s.exe", homeDir, command),
			)
		} else {
			paths = append(paths,
				fmt.Sprintf("%s/.rustup/toolchains/*/bin/%s", homeDir, command),
				fmt.Sprintf("%s/.cargo/bin/%s", homeDir, command),
			)
		}
	}

	// Add VSCode extensions path
	vscodePath := getVSCodeExtensionsPath(homeDir)
	if vscodePath != "" {
		paths = append(paths, vscodePath)
	}

	// Expand any glob patterns in paths
	var expandedPaths []string
	for _, path := range paths {
		if strings.Contains(path, "*") {
			// This is a glob pattern, expand it
			matches, err := filepath.Glob(path)
			if err == nil {
				expandedPaths = append(expandedPaths, matches...)
			}
		} else {
			expandedPaths = append(expandedPaths, path)
		}
	}

	return expandedPaths
}

// getVSCodeExtensionsPath returns the path to VSCode extensions directory
func getVSCodeExtensionsPath(homeDir string) string {
	var basePath string

	switch runtime.GOOS {
	case "darwin":
		basePath = filepath.Join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage")
	case "linux":
		basePath = filepath.Join(homeDir, ".config", "Code", "User", "globalStorage")
	case "windows":
		basePath = filepath.Join(homeDir, "AppData", "Roaming", "Code", "User", "globalStorage")
	default:
		return ""
	}

	// Check if the directory exists
	if _, err := os.Stat(basePath); err != nil {
		return ""
	}

	return basePath
}

// ConfigureLSPServers detects languages and configures LSP servers
func ConfigureLSPServers(rootDir string) (map[string]ServerInfo, error) {
	// Detect languages in the project
	languages, err := DetectLanguages(rootDir)
	if err != nil {
		return nil, fmt.Errorf("failed to detect languages: %w", err)
	}

	// Find LSP servers for detected languages
	servers := make(map[string]ServerInfo)
	for langID, langInfo := range languages {
		// Prioritize primary languages but include all languages that have server definitions
		if !langInfo.IsPrimary && langInfo.FileCount < 3 {
			// Skip non-primary languages with very few files
			slog.Debug("Skipping non-primary language with few files", "language", langID, "files", langInfo.FileCount)
			continue
		}

		// Check if we have a server for this language
		serverInfo, err := FindLSPServer(langID)
		if err != nil {
			slog.Warn("LSP server not found", "language", langID, "error", err)
			continue
		}

		// Add to the map of configured servers
		servers[langID] = serverInfo
		if langInfo.IsPrimary {
			slog.Info("Configured LSP server for primary language", "language", langID, "command", serverInfo.Command, "path", serverInfo.Path)
		} else {
			slog.Info("Configured LSP server for secondary language", "language", langID, "command", serverInfo.Command, "path", serverInfo.Path)
		}
	}

	return servers, nil
}

