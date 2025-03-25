package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"github.com/kujtimiihoxha/termai/internal/permission"
	"github.com/sergi/go-diff/diffmatchpatch"
)

type editTool struct {
	workingDir string
}

const (
	EditToolName = "edit"
)

type EditParams struct {
	FilePath  string `json:"file_path"`
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
}

func (b *editTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: EditToolName,
		Desc: `This is a tool for editing files. For moving or renaming files, you should generally use the Bash tool with the 'mv' command instead. For larger edits, use the Write tool to overwrite files. F.

Before using this tool:

1. Use the View tool to understand the file's contents and context

2. Verify the directory path is correct (only applicable when creating new files):
   - Use the LS tool to verify the parent directory exists and is the correct location

To make a file edit, provide the following:
1. file_path: The absolute path to the file to modify (must be absolute, not relative)
2. old_string: The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)
3. new_string: The edited text to replace the old_string

The tool will replace ONE occurrence of old_string with new_string in the specified file.

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. UNIQUENESS: The old_string MUST uniquely identify the specific instance you want to change. This means:
   - Include AT LEAST 3-5 lines of context BEFORE the change point
   - Include AT LEAST 3-5 lines of context AFTER the change point
   - Include all whitespace, indentation, and surrounding code exactly as it appears in the file

2. SINGLE INSTANCE: This tool can only change ONE instance at a time. If you need to change multiple instances:
   - Make separate calls to this tool for each instance
   - Each call must uniquely identify its specific instance using extensive context

3. VERIFICATION: Before using this tool:
   - Check how many instances of the target text exist in the file
   - If multiple instances exist, gather enough context to uniquely identify each one
   - Plan separate tool calls for each instance

WARNING: If you do not follow these requirements:
   - The tool will fail if old_string matches multiple locations
   - The tool will fail if old_string doesn't match exactly (including whitespace)
   - You may change the wrong instance if you don't include enough context

When making edits:
   - Ensure the edit results in idiomatic, correct code
   - Do not leave the code in a broken state
   - Always use absolute file paths (starting with /)

If you want to create a new file, use:
   - A new file path, including dir name if needed
   - An empty old_string
   - The new file's contents as new_string

Remember: when making multiple file edits in a row to the same file, you should prefer to send all edits in a single message with multiple calls to this tool, rather than multiple messages with a single call each.`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"file_path": {
				Type:     "string",
				Desc:     "The absolute path to the file to modify",
				Required: true,
			},
			"old_string": {
				Type:     "string",
				Desc:     "The text to replace",
				Required: true,
			},
			"new_string": {
				Type:     "string",
				Desc:     "The text to replace it with",
				Required: true,
			},
		}),
	}, nil
}

func (b *editTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
	var params EditParams
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return "", err
	}

	if params.FilePath == "" {
		return "", errors.New("file_path is required")
	}

	if !filepath.IsAbs(params.FilePath) {
		return "", fmt.Errorf("file path must be absolute, got: %s", params.FilePath)
	}

	if params.OldString == "" {
		return createNewFile(params.FilePath, params.NewString)
	}

	if params.NewString == "" {
		return deleteContent(params.FilePath, params.OldString)
	}

	return replaceContent(params.FilePath, params.OldString, params.NewString)
}

func createNewFile(filePath, content string) (string, error) {
	fileInfo, err := os.Stat(filePath)
	if err == nil {
		if fileInfo.IsDir() {
			return "", fmt.Errorf("path is a directory, not a file: %s", filePath)
		}
		return "", fmt.Errorf("file already exists: %s. Use the Replace tool to overwrite an existing file", filePath)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("failed to access file: %w", err)
	}

	dir := filepath.Dir(filePath)
	if err = os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create parent directories: %w", err)
	}

	p := permission.Default.Request(
		permission.CreatePermissionRequest{
			Path:        filepath.Dir(filePath),
			ToolName:    EditToolName,
			Action:      "create",
			Description: fmt.Sprintf("Create file %s", filePath),
			Params: map[string]interface{}{
				"file_path": filePath,
				"content":   content,
			},
		},
	)
	if !p {
		return "", fmt.Errorf("permission denied")
	}

	err = os.WriteFile(filePath, []byte(content), 0o644)
	if err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	recordFileWrite(filePath)
	recordFileRead(filePath)

	// result := FileEditResult{
	// 	FilePath: filePath,
	// 	Created:  true,
	// 	Updated:  false,
	// 	Deleted:  false,
	// 	Diff:     generateDiff("", content),
	// }
	//
	// resultJSON, err := json.Marshal(result)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to serialize result: %w", err)
	// }
	//
	return "File created: " + filePath, nil
}

func deleteContent(filePath, oldString string) (string, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("file not found: %s", filePath)
		}
		return "", fmt.Errorf("failed to access file: %w", err)
	}

	if fileInfo.IsDir() {
		return "", fmt.Errorf("path is a directory, not a file: %s", filePath)
	}

	if getLastReadTime(filePath).IsZero() {
		return "", fmt.Errorf("you must read the file before editing it. Use the View tool first")
	}

	modTime := fileInfo.ModTime()
	lastRead := getLastReadTime(filePath)
	if modTime.After(lastRead) {
		return "", fmt.Errorf("file %s has been modified since it was last read (mod time: %s, last read: %s)",
			filePath, modTime.Format(time.RFC3339), lastRead.Format(time.RFC3339))
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}

	oldContent := string(content)

	index := strings.Index(oldContent, oldString)
	if index == -1 {
		return "", fmt.Errorf("old_string not found in file. Make sure it matches exactly, including whitespace and line breaks")
	}

	lastIndex := strings.LastIndex(oldContent, oldString)
	if index != lastIndex {
		return "", fmt.Errorf("old_string appears multiple times in the file. Please provide more context to ensure a unique match")
	}

	newContent := oldContent[:index] + oldContent[index+len(oldString):]

	p := permission.Default.Request(
		permission.CreatePermissionRequest{
			Path:        filepath.Dir(filePath),
			ToolName:    EditToolName,
			Action:      "delete",
			Description: fmt.Sprintf("Delete content from file %s", filePath),
			Params: map[string]interface{}{
				"file_path": filePath,
				"content":   content,
			},
		},
	)
	if !p {
		return "", fmt.Errorf("permission denied")
	}

	err = os.WriteFile(filePath, []byte(newContent), 0o644)
	if err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	recordFileWrite(filePath)

	// result := FileEditResult{
	// 	FilePath:      filePath,
	// 	Created:       false,
	// 	Updated:       true,
	// 	Deleted:       true,
	// 	Diff:          generateDiff(oldContent, newContent),
	// 	SnippetBefore: getContextSnippet(oldContent, index, len(oldString)),
	// 	SnippetAfter:  getContextSnippet(newContent, index, 0),
	// }
	//
	// resultJSON, err := json.Marshal(result)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to serialize result: %w", err)
	// }

	return "Content deleted from file: " + filePath, nil
}

func replaceContent(filePath, oldString, newString string) (string, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Sprintf("file not found: %s", filePath), nil
		}
		return fmt.Sprintf("failed to access file: %s", err), nil
	}

	if fileInfo.IsDir() {
		return fmt.Sprintf("path is a directory, not a file: %s", filePath), nil
	}

	if getLastReadTime(filePath).IsZero() {
		return "you must read the file before editing it. Use the View tool first", nil
	}

	modTime := fileInfo.ModTime()
	lastRead := getLastReadTime(filePath)
	if modTime.After(lastRead) {
		return fmt.Sprintf("file %s has been modified since it was last read (mod time: %s, last read: %s)",
			filePath, modTime.Format(time.RFC3339), lastRead.Format(time.RFC3339)), nil
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Sprintf("failed to read file: %s", err), nil
	}

	oldContent := string(content)

	index := strings.Index(oldContent, oldString)
	if index == -1 {
		return "old_string not found in file. Make sure it matches exactly, including whitespace and line breaks", nil
	}

	lastIndex := strings.LastIndex(oldContent, oldString)
	if index != lastIndex {
		return "old_string appears multiple times in the file. Please provide more context to ensure a unique match", nil
	}

	newContent := oldContent[:index] + newString + oldContent[index+len(oldString):]

	p := permission.Default.Request(
		permission.CreatePermissionRequest{
			Path:        filepath.Dir(filePath),
			ToolName:    EditToolName,
			Action:      "replace",
			Description: fmt.Sprintf("Replace content in file %s", filePath),
			Params: map[string]interface{}{
				"file_path":  filePath,
				"old_string": oldString,
				"new_string": newString,
			},
		},
	)
	if !p {
		return "", fmt.Errorf("permission denied")
	}

	err = os.WriteFile(filePath, []byte(newContent), 0o644)
	if err != nil {
		return fmt.Sprintf("failed to write file: %s", err), nil
	}

	recordFileWrite(filePath)

	// result := FileEditResult{
	// 	FilePath:      filePath,
	// 	Created:       false,
	// 	Updated:       true,
	// 	Deleted:       false,
	// 	Diff:          generateDiff(oldContent, newContent),
	// 	SnippetBefore: getContextSnippet(oldContent, index, len(oldString)),
	// 	SnippetAfter:  getContextSnippet(newContent, index, len(newString)),
	// }
	//
	// resultJSON, err := json.Marshal(result)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to serialize result: %w", err)
	// }

	return "Content replaced in file: " + filePath, nil
}

func getContextSnippet(content string, position, length int) string {
	contextLines := 3

	lines := strings.Split(content, "\n")
	lineIndex := 0
	currentPos := 0

	for i, line := range lines {
		if currentPos <= position && position < currentPos+len(line)+1 {
			lineIndex = i
			break
		}
		currentPos += len(line) + 1 // +1 for the newline
	}

	startLine := max(0, lineIndex-contextLines)
	endLine := min(len(lines), lineIndex+contextLines+1)

	var snippetBuilder strings.Builder
	for i := startLine; i < endLine; i++ {
		if i == lineIndex {
			snippetBuilder.WriteString(fmt.Sprintf("> %s\n", lines[i]))
		} else {
			snippetBuilder.WriteString(fmt.Sprintf("  %s\n", lines[i]))
		}
	}

	return snippetBuilder.String()
}

func generateDiff(oldContent, newContent string) string {
	dmp := diffmatchpatch.New()

	diffs := dmp.DiffMain(oldContent, newContent, false)

	patches := dmp.PatchMake(oldContent, diffs)
	patchText := dmp.PatchToText(patches)

	if patchText == "" && (oldContent != newContent) {
		var result strings.Builder

		result.WriteString("@@ Diff @@\n")
		for _, diff := range diffs {
			switch diff.Type {
			case diffmatchpatch.DiffInsert:
				result.WriteString("+ " + diff.Text + "\n")
			case diffmatchpatch.DiffDelete:
				result.WriteString("- " + diff.Text + "\n")
			case diffmatchpatch.DiffEqual:
				if len(diff.Text) > 40 {
					result.WriteString("  " + diff.Text[:20] + "..." + diff.Text[len(diff.Text)-20:] + "\n")
				} else {
					result.WriteString("  " + diff.Text + "\n")
				}
			}
		}
		return result.String()
	}

	return patchText
}

func NewEditTool(workingDir string) tool.InvokableTool {
	return &editTool{
		workingDir: workingDir,
	}
}
