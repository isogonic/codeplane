package main

import (
	"github.com/opencode-ai/opencode/cmd"
	"github.com/opencode-ai/opencode/internal/logging"
	"github.com/opencode-ai/opencode/internal/status"
)

func main() {
	defer logging.RecoverPanic("main", func() {
		status.Error("Application terminated due to unhandled panic")
	})

	cmd.Execute()
}
