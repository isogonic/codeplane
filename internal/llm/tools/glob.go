package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"

	"github.com/bmatcuk/doublestar/v4"
)

type globTool struct {
	workingDir string
}

const (
	GlobToolName = "glob"
)

type fileInfo struct {
	path    string
	modTime time.Time
}

type GlobParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
}

func (b *globTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: GlobToolName,
		Desc: `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"pattern": {
				Type:     "string",
				Desc:     "The glob pattern to match files against",
				Required: true,
			},
			"path": {
				Type: "string",
				Desc: "The directory to search in. Defaults to the current working directory.",
			},
		}),
	}, nil
}

func (b *globTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
	var params GlobParams
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return fmt.Sprintf("error parsing parameters: %s", err), nil
	}

	// If path is empty, use current working directory
	searchPath := params.Path
	if searchPath == "" {
		searchPath = b.workingDir
	}

	files, truncated, err := globFiles(params.Pattern, searchPath, 100)
	if err != nil {
		return fmt.Sprintf("error performing glob search: %s", err), nil
	}

	// Format the output for the assistant
	var output string
	if len(files) == 0 {
		output = "No files found"
	} else {
		output = strings.Join(files, "\n")
		if truncated {
			output += "\n(Results are truncated. Consider using a more specific path or pattern.)"
		}
	}

	return output, nil
}

func globFiles(pattern, searchPath string, limit int) ([]string, bool, error) {
	// Make sure pattern starts with the search path if not absolute
	if !strings.HasPrefix(pattern, "/") && !strings.HasPrefix(pattern, searchPath) {
		// If searchPath doesn't end with a slash, add one before appending the pattern
		if !strings.HasSuffix(searchPath, "/") {
			searchPath += "/"
		}
		pattern = searchPath + pattern
	}

	// Open the filesystem for walking
	fsys := os.DirFS("/")

	// Convert the absolute pattern to a relative one for the DirFS
	// DirFS uses the root directory ("/") so we should strip leading "/"
	relPattern := strings.TrimPrefix(pattern, "/")

	// Collect matching files
	var matches []fileInfo

	// Use doublestar to walk the filesystem and find matches
	err := doublestar.GlobWalk(fsys, relPattern, func(path string, d fs.DirEntry) error {
		// Skip directories from results
		if d.IsDir() {
			return nil
		}
		if skipHidden(path) {
			return nil
		}

		// Get file info for modification time
		info, err := d.Info()
		if err != nil {
			return nil // Skip files we can't access
		}

		// Add to matches
		absPath := "/" + path // Restore absolute path
		matches = append(matches, fileInfo{
			path:    absPath,
			modTime: info.ModTime(),
		})

		// Check limit
		if len(matches) >= limit*2 { // Collect more than needed for sorting
			return fs.SkipAll
		}

		return nil
	})
	if err != nil {
		return nil, false, fmt.Errorf("glob walk error: %w", err)
	}

	// Sort files by modification time (newest first)
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].modTime.After(matches[j].modTime)
	})

	// Check if we need to truncate the results
	truncated := len(matches) > limit
	if truncated {
		matches = matches[:limit]
	}

	// Extract just the paths
	results := make([]string, len(matches))
	for i, m := range matches {
		results[i] = m.path
	}

	return results, truncated, nil
}

func skipHidden(path string) bool {
	base := filepath.Base(path)
	return base != "." && strings.HasPrefix(base, ".")
}

func NewGlobTool(workingDir string) tool.InvokableTool {
	return &globTool{
		workingDir,
	}
}
