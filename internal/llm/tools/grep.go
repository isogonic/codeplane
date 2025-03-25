package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
)

type grepTool struct {
	workingDir string
}

const (
	GrepToolName = "grep"

	MaxGrepResults = 100
)

type GrepParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
	Include string `json:"include"`
}

type grepMatch struct {
	path    string
	modTime time.Time
}

func (b *grepTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: GrepToolName,
		Desc: `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files containing specific patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"command": {
				Type:     "string",
				Desc:     "The command to execute",
				Required: true,
			},
			"timeout": {
				Type: "number",
				Desc: "Optional timeout in milliseconds (max 600000)",
			},
		}),
	}, nil
}

func (b *grepTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
	var params GrepParams
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return "", err
	}

	searchPath := params.Path
	if searchPath == "" {
		var err error
		searchPath, err = os.Getwd()
		if err != nil {
			return fmt.Sprintf("unable to get current working directory: %s", err), nil
		}
	}

	matches, err := searchWithRipgrep(params.Pattern, searchPath, params.Include)
	if err != nil {
		matches, err = searchFilesWithRegex(params.Pattern, searchPath, params.Include)
		if err != nil {
			return fmt.Sprintf("error searching files: %s", err), nil
		}
	}

	sort.Slice(matches, func(i, j int) bool {
		return matches[i].modTime.After(matches[j].modTime)
	})

	truncated := false
	if len(matches) > MaxGrepResults {
		truncated = true
		matches = matches[:MaxGrepResults]
	}

	filenames := make([]string, len(matches))
	for i, m := range matches {
		filenames[i] = m.path
	}

	var output string
	if len(filenames) == 0 {
		output = "No files found"
	} else {
		output = fmt.Sprintf("Found %d file%s\n%s",
			len(filenames),
			pluralize(len(filenames)),
			strings.Join(filenames, "\n"))

		if truncated {
			output += "\n(Results are truncated. Consider using a more specific path or pattern.)"
		}
	}

	return output, nil
}

func pluralize(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func searchWithRipgrep(pattern, path, include string) ([]grepMatch, error) {
	_, err := exec.LookPath("rg")
	if err != nil {
		return nil, fmt.Errorf("ripgrep not found: %w", err)
	}

	args := []string{"-l", pattern}
	if include != "" {
		args = append(args, "--glob", include)
	}
	args = append(args, path)

	cmd := exec.Command("rg", args...)
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return []grepMatch{}, nil
		}
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	matches := make([]grepMatch, 0, len(lines))

	for _, line := range lines {
		if line == "" {
			continue
		}

		fileInfo, err := os.Stat(line)
		if err != nil {
			continue
		}

		matches = append(matches, grepMatch{
			path:    line,
			modTime: fileInfo.ModTime(),
		})
	}

	return matches, nil
}

func searchFilesWithRegex(pattern, rootPath, include string) ([]grepMatch, error) {
	matches := []grepMatch{}

	regex, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid regex pattern: %w", err)
	}

	var includePattern *regexp.Regexp
	if include != "" {
		regexPattern := globToRegex(include)
		includePattern, err = regexp.Compile(regexPattern)
		if err != nil {
			return nil, fmt.Errorf("invalid include pattern: %w", err)
		}
	}

	err = filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			return nil
		}

		if includePattern != nil && !includePattern.MatchString(path) {
			return nil
		}

		match, err := fileContainsPattern(path, regex)
		if err != nil {
			return nil
		}

		if match {
			matches = append(matches, grepMatch{
				path:    path,
				modTime: info.ModTime(),
			})
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return matches, nil
}

func fileContainsPattern(filePath string, pattern *regexp.Regexp) (bool, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return false, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if pattern.MatchString(scanner.Text()) {
			return true, nil
		}
	}

	if err := scanner.Err(); err != nil {
		return false, err
	}

	return false, nil
}

func globToRegex(glob string) string {
	regexPattern := strings.ReplaceAll(glob, ".", "\\.")
	regexPattern = strings.ReplaceAll(regexPattern, "*", ".*")
	regexPattern = strings.ReplaceAll(regexPattern, "?", ".")

	re := regexp.MustCompile(`\{([^}]+)\}`)
	regexPattern = re.ReplaceAllStringFunc(regexPattern, func(match string) string {
		inner := match[1 : len(match)-1]
		return "(" + strings.ReplaceAll(inner, ",", "|") + ")"
	})

	return "^" + regexPattern + "$"
}

func NewGrepTool(workingDir string) tool.InvokableTool {
	return &grepTool{
		workingDir,
	}
}
