package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
)

type lsTool struct {
	workingDir string
}

const (
	LSToolName = "ls"

	MaxFiles         = 1000
	TruncatedMessage = "There are more than 1000 files in the repository. Use the LS tool (passing a specific path), Bash tool, and other tools to explore nested directories. The first 1000 files and directories are included below:\n\n"
)

type LSParams struct {
	Path   string   `json:"path"`
	Ignore []string `json:"ignore"`
}

func (b *lsTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: LSToolName,
		Desc: "Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"path": {
				Type:     "string",
				Desc:     "The absolute path to the directory to list (must be absolute, not relative)",
				Required: true,
			},
			"ignore": {
				Type: "array",
				ElemInfo: &schema.ParameterInfo{
					Type: schema.String,
					Desc: "List of glob patterns to ignore",
				},
			},
		}),
	}, nil
}

func (b *lsTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
	var params LSParams
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return "", err
	}

	if !filepath.IsAbs(params.Path) {
		return fmt.Sprintf("path must be absolute, got: %s", params.Path), nil
	}

	files, err := b.listDirectory(params.Path)
	if err != nil {
		return fmt.Sprintf("error listing directory: %s", err), nil
	}

	tree := createFileTree(files)
	output := printTree(tree, params.Path)

	if len(files) >= MaxFiles {
		output = TruncatedMessage + output
	}

	return output, nil
}

func (b *lsTool) listDirectory(initialPath string) ([]string, error) {
	var results []string

	err := filepath.Walk(initialPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files we don't have permission to access
		}

		if shouldSkip(path) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if path != initialPath {
			if info.IsDir() {
				path = path + string(filepath.Separator)
			}

			relPath, err := filepath.Rel(b.workingDir, path)
			if err == nil {
				results = append(results, relPath)
			} else {
				results = append(results, path)
			}
		}

		if len(results) >= MaxFiles {
			return fmt.Errorf("max files reached")
		}

		return nil
	})

	if err != nil && err.Error() != "max files reached" {
		return nil, err
	}

	return results, nil
}

func shouldSkip(path string) bool {
	base := filepath.Base(path)

	if base != "." && strings.HasPrefix(base, ".") {
		return true
	}

	if strings.Contains(path, filepath.Join("__pycache__", "")) {
		return true
	}

	return false
}

type TreeNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Type     string     `json:"type"` // "file" or "directory"
	Children []TreeNode `json:"children,omitempty"`
}

func createFileTree(sortedPaths []string) []TreeNode {
	root := []TreeNode{}

	for _, path := range sortedPaths {
		parts := strings.Split(path, string(filepath.Separator))
		currentLevel := &root
		currentPath := ""

		for i, part := range parts {
			if part == "" {
				continue
			}

			if currentPath == "" {
				currentPath = part
			} else {
				currentPath = filepath.Join(currentPath, part)
			}

			isLastPart := i == len(parts)-1
			isDir := !isLastPart || strings.HasSuffix(path, string(filepath.Separator))

			found := false
			for i := range *currentLevel {
				if (*currentLevel)[i].Name == part {
					found = true
					if (*currentLevel)[i].Children != nil {
						currentLevel = &(*currentLevel)[i].Children
					}
					break
				}
			}

			if !found {
				nodeType := "file"
				if isDir {
					nodeType = "directory"
				}

				newNode := TreeNode{
					Name: part,
					Path: currentPath,
					Type: nodeType,
				}

				if isDir {
					newNode.Children = []TreeNode{}
					*currentLevel = append(*currentLevel, newNode)
					currentLevel = &(*currentLevel)[len(*currentLevel)-1].Children
				} else {
					*currentLevel = append(*currentLevel, newNode)
				}
			}
		}
	}

	return root
}

func printTree(tree []TreeNode, rootPath string) string {
	var result strings.Builder

	result.WriteString(fmt.Sprintf("- %s%s\n", rootPath, string(filepath.Separator)))

	printTreeRecursive(&result, tree, 0, "  ")

	return result.String()
}

func printTreeRecursive(builder *strings.Builder, tree []TreeNode, level int, prefix string) {
	for _, node := range tree {
		linePrefix := prefix + "- "

		nodeName := node.Name
		if node.Type == "directory" {
			nodeName += string(filepath.Separator)
		}
		fmt.Fprintf(builder, "%s%s\n", linePrefix, nodeName)

		if node.Type == "directory" && len(node.Children) > 0 {
			printTreeRecursive(builder, node.Children, level+1, prefix+"  ")
		}
	}
}

func NewLsTool(workingDir string) tool.InvokableTool {
	return &lsTool{
		workingDir,
	}
}
