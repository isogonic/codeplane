package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"github.com/kujtimiihoxha/termai/internal/permission"
)

type writeTool struct {
	workingDir string
}

const (
	WriteToolName = "write"
)

type WriteParams struct {
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
}

func (b *writeTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: WriteToolName,
		Desc: "Write a file to the local filesystem. Overwrites the existing file if there is one.\n\nBefore using this tool:\n\n1. Use the ReadFile tool to understand the file's contents and context\n\n2. Directory Verification (only applicable when creating new files):\n   - Use the LS tool to verify the parent directory exists and is the correct location",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"file_path": {
				Type:     "string",
				Desc:     "The absolute path to the file to write (must be absolute, not relative)",
				Required: true,
			},
			"content": {
				Type:     "string",
				Desc:     "The content to write to the file",
				Required: true,
			},
		}),
	}, nil
}

func (b *writeTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
	var params WriteParams
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return "", fmt.Errorf("failed to parse parameters: %w", err)
	}

	if params.FilePath == "" {
		return "file_path is required", nil
	}

	if !filepath.IsAbs(params.FilePath) {
		return fmt.Sprintf("file path must be absolute, got: %s", params.FilePath), nil
	}

	// fileExists := false
	// oldContent := ""
	fileInfo, err := os.Stat(params.FilePath)
	if err == nil {
		if fileInfo.IsDir() {
			return fmt.Sprintf("path is a directory, not a file: %s", params.FilePath), nil
		}

		modTime := fileInfo.ModTime()
		lastRead := getLastReadTime(params.FilePath)
		if modTime.After(lastRead) {
			return fmt.Sprintf("file %s has been modified since it was last read (mod time: %s, last read: %s)",
				params.FilePath, modTime.Format(time.RFC3339), lastRead.Format(time.RFC3339)), nil
		}

		// oldContentBytes, readErr := os.ReadFile(params.FilePath)
		// if readErr != nil {
		// 	oldContent = string(oldContentBytes)
		// }
	} else if !os.IsNotExist(err) {
		return fmt.Sprintf("failed to access file: %s", err), nil
	}

	p := permission.Default.Request(
		permission.CreatePermissionRequest{
			Path:        b.workingDir,
			ToolName:    WriteToolName,
			Action:      "write",
			Description: fmt.Sprintf("Write to file %s", params.FilePath),
			Params: map[string]interface{}{
				"file_path": params.FilePath,
				"contnet":   params.Content,
			},
		},
	)
	if !p {
		return "", fmt.Errorf("permission denied")
	}
	dir := filepath.Dir(params.FilePath)
	if err = os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Sprintf("failed to create parent directories: %s", err), nil
	}

	err = os.WriteFile(params.FilePath, []byte(params.Content), 0o644)
	if err != nil {
		return fmt.Sprintf("failed to write file: %s", err), nil
	}

	recordFileWrite(params.FilePath)

	output := "File written: " + params.FilePath

	// if fileExists && oldContent != params.Content {
	// 	output = generateSimpleDiff(oldContent, params.Content)
	// }

	return output, nil
}

func generateSimpleDiff(oldContent, newContent string) string {
	if oldContent == newContent {
		return "[No changes]"
	}

	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	var diffBuilder strings.Builder
	diffBuilder.WriteString(fmt.Sprintf("@@ -%d,+%d @@\n", len(oldLines), len(newLines)))

	maxLines := max(len(oldLines), len(newLines))
	for i := range maxLines {
		oldLine := ""
		newLine := ""

		if i < len(oldLines) {
			oldLine = oldLines[i]
		}

		if i < len(newLines) {
			newLine = newLines[i]
		}

		if oldLine != newLine {
			if i < len(oldLines) {
				diffBuilder.WriteString(fmt.Sprintf("- %s\n", oldLine))
			}
			if i < len(newLines) {
				diffBuilder.WriteString(fmt.Sprintf("+ %s\n", newLine))
			}
		} else {
			diffBuilder.WriteString(fmt.Sprintf("  %s\n", oldLine))
		}
	}

	return diffBuilder.String()
}

func NewWriteTool(workingDir string) tool.InvokableTool {
	return &writeTool{
		workingDir: workingDir,
	}
}
