package discovery

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/opencode-ai/opencode/internal/lsp"
	"log/slog"
)

// LanguageInfo stores information about a detected language
type LanguageInfo struct {
	// Language identifier (e.g., "go", "typescript", "python")
	ID string

	// Number of files detected for this language
	FileCount int

	// Project files associated with this language (e.g., go.mod, package.json)
	ProjectFiles []string

	// Whether this is likely a primary language in the project
	IsPrimary bool
}

// ProjectFile represents a project configuration file
type ProjectFile struct {
	// File name or pattern to match
	Name string

	// Associated language ID
	LanguageID string

	// Whether this file strongly indicates the language is primary
	IsPrimary bool
}

// Common project files that indicate specific languages
var projectFilePatterns = []ProjectFile{
	{Name: "go.mod", LanguageID: "go", IsPrimary: true},
	{Name: "go.sum", LanguageID: "go", IsPrimary: false},
	{Name: "package.json", LanguageID: "javascript", IsPrimary: true}, // Could be TypeScript too
	{Name: "tsconfig.json", LanguageID: "typescript", IsPrimary: true},
	{Name: "jsconfig.json", LanguageID: "javascript", IsPrimary: true},
	{Name: "pyproject.toml", LanguageID: "python", IsPrimary: true},
	{Name: "setup.py", LanguageID: "python", IsPrimary: true},
	{Name: "requirements.txt", LanguageID: "python", IsPrimary: true},
	{Name: "Cargo.toml", LanguageID: "rust", IsPrimary: true},
	{Name: "Cargo.lock", LanguageID: "rust", IsPrimary: false},
	{Name: "CMakeLists.txt", LanguageID: "cmake", IsPrimary: true},
	{Name: "pom.xml", LanguageID: "java", IsPrimary: true},
	{Name: "build.gradle", LanguageID: "java", IsPrimary: true},
	{Name: "build.gradle.kts", LanguageID: "kotlin", IsPrimary: true},
	{Name: "composer.json", LanguageID: "php", IsPrimary: true},
	{Name: "Gemfile", LanguageID: "ruby", IsPrimary: true},
	{Name: "Rakefile", LanguageID: "ruby", IsPrimary: true},
	{Name: "mix.exs", LanguageID: "elixir", IsPrimary: true},
	{Name: "rebar.config", LanguageID: "erlang", IsPrimary: true},
	{Name: "dune-project", LanguageID: "ocaml", IsPrimary: true},
	{Name: "stack.yaml", LanguageID: "haskell", IsPrimary: true},
	{Name: "cabal.project", LanguageID: "haskell", IsPrimary: true},
	{Name: "Makefile", LanguageID: "make", IsPrimary: false},
	{Name: "Dockerfile", LanguageID: "dockerfile", IsPrimary: false},
}

// Map of file extensions to language IDs
var extensionToLanguage = map[string]string{
	".go":    "go",
	".js":    "javascript",
	".jsx":   "javascript",
	".ts":    "typescript",
	".tsx":   "typescript",
	".py":    "python",
	".rs":    "rust",
	".java":  "java",
	".c":     "c",
	".cpp":   "cpp",
	".h":     "c",
	".hpp":   "cpp",
	".rb":    "ruby",
	".php":   "php",
	".cs":    "csharp",
	".fs":    "fsharp",
	".swift": "swift",
	".kt":    "kotlin",
	".scala": "scala",
	".hs":    "haskell",
	".ml":    "ocaml",
	".ex":    "elixir",
	".exs":   "elixir",
	".erl":   "erlang",
	".lua":   "lua",
	".r":     "r",
	".sh":    "shell",
	".bash":  "shell",
	".zsh":   "shell",
	".html":  "html",
	".css":   "css",
	".scss":  "scss",
	".sass":  "sass",
	".less":  "less",
	".json":  "json",
	".xml":   "xml",
	".yaml":  "yaml",
	".yml":   "yaml",
	".md":    "markdown",
	".dart":  "dart",
}

// Directories to exclude from scanning
var excludedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"vendor":       true,
	"dist":         true,
	"build":        true,
	"target":       true,
	".idea":        true,
	".vscode":      true,
	".github":      true,
	".gitlab":      true,
	"__pycache__":  true,
	".next":        true,
	".nuxt":        true,
	"venv":         true,
	"env":          true,
	".env":         true,
}

// DetectLanguages scans a directory to identify programming languages used in the project
func DetectLanguages(rootDir string) (map[string]LanguageInfo, error) {
	languages := make(map[string]LanguageInfo)
	var mutex sync.Mutex

	// Walk the directory tree
	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files that can't be accessed
		}

		// Skip excluded directories
		if info.IsDir() {
			if excludedDirs[info.Name()] || strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip hidden files
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		// Check for project files
		for _, pattern := range projectFilePatterns {
			if info.Name() == pattern.Name {
				mutex.Lock()
				lang, exists := languages[pattern.LanguageID]
				if !exists {
					lang = LanguageInfo{
						ID:           pattern.LanguageID,
						FileCount:    0,
						ProjectFiles: []string{},
						IsPrimary:    pattern.IsPrimary,
					}
				}
				lang.ProjectFiles = append(lang.ProjectFiles, path)
				if pattern.IsPrimary {
					lang.IsPrimary = true
				}
				languages[pattern.LanguageID] = lang
				mutex.Unlock()
				break
			}
		}

		// Check file extension
		ext := strings.ToLower(filepath.Ext(path))
		if langID, ok := extensionToLanguage[ext]; ok {
			mutex.Lock()
			lang, exists := languages[langID]
			if !exists {
				lang = LanguageInfo{
					ID:           langID,
					FileCount:    0,
					ProjectFiles: []string{},
				}
			}
			lang.FileCount++
			languages[langID] = lang
			mutex.Unlock()
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Determine primary languages based on file count if not already marked
	determinePrimaryLanguages(languages)

	// Log detected languages
	for id, info := range languages {
		if info.IsPrimary {
			slog.Debug("Detected primary language", "language", id, "files", info.FileCount, "projectFiles", len(info.ProjectFiles))
		} else {
			slog.Debug("Detected secondary language", "language", id, "files", info.FileCount)
		}
	}

	return languages, nil
}

// determinePrimaryLanguages marks languages as primary based on file count
func determinePrimaryLanguages(languages map[string]LanguageInfo) {
	// Find the language with the most files
	var maxFiles int
	for _, info := range languages {
		if info.FileCount > maxFiles {
			maxFiles = info.FileCount
		}
	}

	// Mark languages with at least 20% of the max files as primary
	threshold := max(maxFiles/5, 5) // At least 5 files to be considered primary

	for id, info := range languages {
		if !info.IsPrimary && info.FileCount >= threshold {
			info.IsPrimary = true
			languages[id] = info
		}
	}
}

// GetLanguageIDFromExtension returns the language ID for a given file extension
func GetLanguageIDFromExtension(ext string) string {
	ext = strings.ToLower(ext)
	if langID, ok := extensionToLanguage[ext]; ok {
		return langID
	}
	return ""
}

// GetLanguageIDFromProtocol converts a protocol.LanguageKind to our language ID string
func GetLanguageIDFromProtocol(langKind string) string {
	// Convert protocol language kind to our language ID
	switch langKind {
	case "go":
		return "go"
	case "typescript":
		return "typescript"
	case "typescriptreact":
		return "typescript"
	case "javascript":
		return "javascript"
	case "javascriptreact":
		return "javascript"
	case "python":
		return "python"
	case "rust":
		return "rust"
	case "java":
		return "java"
	case "c":
		return "c"
	case "cpp":
		return "cpp"
	default:
		// Try to normalize the language kind
		return strings.ToLower(langKind)
	}
}

// GetLanguageIDFromPath determines the language ID from a file path
func GetLanguageIDFromPath(path string) string {
	// Check file extension first
	ext := filepath.Ext(path)
	if langID := GetLanguageIDFromExtension(ext); langID != "" {
		return langID
	}

	// Check if it's a known project file
	filename := filepath.Base(path)
	for _, pattern := range projectFilePatterns {
		if filename == pattern.Name {
			return pattern.LanguageID
		}
	}

	// Use LSP's detection as a fallback
	uri := "file://" + path
	langKind := lsp.DetectLanguageID(uri)
	return GetLanguageIDFromProtocol(string(langKind))
}
