package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
)

type viewTool struct {
	workingDir string
}

const (
	ViewToolName = "view"

	MaxReadSize = 250 * 1024

	DefaultReadLimit = 2000

	MaxLineLength = 2000
)

type ViewPatams struct {
	FilePath string `json:"file_path"`
	Offset   int    `json:"offset"`
	Limit    int    `json:"limit"`
}

func (b *viewTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: ViewToolName,
		Desc: `Reads a file from the local filesystem. The file_path parameter must be an absolute path, not a relative path. By default, it reads up to 2000 lines starting from the beginning of the file. You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters. Any lines longer than 2000 characters will be truncated. For image files, the tool will display the image for you.`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"file_path": {
				Type:     "string",
				Desc:     "The absolute path to the file to read",
				Required: true,
			},
			"offset": {
				Type: "int",
				Desc: "The line number to start reading from. Only provide if the file is too large to read at once",
			},
			"limit": {
				Type: "int",
				Desc: "The number of lines to read. Only provide if the file is too large to read at once.",
			},
		}),
	}, nil
}

func (b *viewTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
	var params ViewPatams
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return fmt.Sprintf("failed to parse parameters: %s", err), nil
	}

	if params.FilePath == "" {
		return "file_path is required", nil
	}

	if !filepath.IsAbs(params.FilePath) {
		return fmt.Sprintf("file path must be absolute, got: %s", params.FilePath), nil
	}

	fileInfo, err := os.Stat(params.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			dir := filepath.Dir(params.FilePath)
			base := filepath.Base(params.FilePath)

			dirEntries, dirErr := os.ReadDir(dir)
			if dirErr == nil {
				var suggestions []string
				for _, entry := range dirEntries {
					if strings.Contains(entry.Name(), base) || strings.Contains(base, entry.Name()) {
						suggestions = append(suggestions, filepath.Join(dir, entry.Name()))
						if len(suggestions) >= 3 {
							break
						}
					}
				}

				if len(suggestions) > 0 {
					return fmt.Sprintf("file not found: %s. Did you mean one of these?\n%s",
						params.FilePath, strings.Join(suggestions, "\n")), nil
				}
			}

			return fmt.Sprintf("file not found: %s", params.FilePath), nil
		}
		return fmt.Sprintf("failed to access file: %s", err), nil
	}

	if fileInfo.IsDir() {
		return fmt.Sprintf("path is a directory, not a file: %s", params.FilePath), nil
	}

	if fileInfo.Size() > MaxReadSize {
		return fmt.Sprintf("file is too large (%d bytes). Maximum size is %d bytes",
			fileInfo.Size(), MaxReadSize), nil
	}

	if params.Limit <= 0 {
		params.Limit = DefaultReadLimit
	}

	isImage, _ := isImageFile(params.FilePath)
	if isImage {
		// TODO: Implement image reading
		return "reading images is not supported", nil
	}

	content, _, err := readTextFile(params.FilePath, params.Offset, params.Limit)
	if err != nil {
		return fmt.Sprintf("failed to read file: %s", err), nil
	}

	recordFileRead(params.FilePath)

	return addLineNumbers(content, params.Offset+1), nil
}

func addLineNumbers(content string, startLine int) string {
	if content == "" {
		return ""
	}

	lines := strings.Split(content, "\n")

	var result []string
	for i, line := range lines {
		line = strings.TrimSuffix(line, "\r")

		lineNum := i + startLine
		numStr := fmt.Sprintf("%d", lineNum)

		if len(numStr) >= 6 {
			result = append(result, fmt.Sprintf("%s\t%s", numStr, line))
		} else {
			paddedNum := fmt.Sprintf("%6s", numStr)
			result = append(result, fmt.Sprintf("%s\t|%s", paddedNum, line))
		}
	}

	return strings.Join(result, "\n")
}

func readTextFile(filePath string, offset, limit int) (string, int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()

	lineCount := 0
	if offset > 0 {
		scanner := NewLineScanner(file)
		for lineCount < offset && scanner.Scan() {
			lineCount++
		}
		if err = scanner.Err(); err != nil {
			return "", 0, err
		}
	}

	if offset == 0 {
		_, err = file.Seek(0, io.SeekStart)
		if err != nil {
			return "", 0, err
		}
	}

	var lines []string
	lineCount = offset
	scanner := NewLineScanner(file)

	for scanner.Scan() && len(lines) < limit {
		lineCount++
		lineText := scanner.Text()
		if len(lineText) > MaxLineLength {
			lineText = lineText[:MaxLineLength] + "..."
		}
		lines = append(lines, lineText)
	}

	if err := scanner.Err(); err != nil {
		return "", 0, err
	}

	return strings.Join(lines, "\n"), lineCount, nil
}

func isImageFile(filePath string) (bool, string) {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".jpg", ".jpeg":
		return true, "jpeg"
	case ".png":
		return true, "png"
	case ".gif":
		return true, "gif"
	case ".bmp":
		return true, "bmp"
	case ".svg":
		return true, "svg"
	case ".webp":
		return true, "webp"
	default:
		return false, ""
	}
}

type LineScanner struct {
	scanner *bufio.Scanner
}

func NewLineScanner(r io.Reader) *LineScanner {
	return &LineScanner{
		scanner: bufio.NewScanner(r),
	}
}

func (s *LineScanner) Scan() bool {
	return s.scanner.Scan()
}

func (s *LineScanner) Text() string {
	return s.scanner.Text()
}

func (s *LineScanner) Err() error {
	return s.scanner.Err()
}

func NewViewTool(workingDir string) tool.InvokableTool {
	return &viewTool{
		workingDir,
	}
}
