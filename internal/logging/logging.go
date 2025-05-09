package logging

import (
	"fmt"
	"log/slog"
	"os"
	"runtime/debug"
	"time"

	"github.com/opencode-ai/opencode/internal/status"
)

// RecoverPanic is a common function to handle panics gracefully.
// It logs the error, creates a panic log file with stack trace,
// and executes an optional cleanup function before returning.
func RecoverPanic(name string, cleanup func()) {
	if r := recover(); r != nil {
		// Log the panic
		errorMsg := fmt.Sprintf("Panic in %s: %v", name, r)
		slog.Error(errorMsg)
		status.Error(errorMsg)

		// Create a timestamped panic log file
		timestamp := time.Now().Format("20060102-150405")
		filename := fmt.Sprintf("opencode-panic-%s-%s.log", name, timestamp)

		file, err := os.Create(filename)
		if err != nil {
			errMsg := fmt.Sprintf("Failed to create panic log: %v", err)
			slog.Error(errMsg)
			status.Error(errMsg)
		} else {
			defer file.Close()

			// Write panic information and stack trace
			fmt.Fprintf(file, "Panic in %s: %v\n\n", name, r)
			fmt.Fprintf(file, "Time: %s\n\n", time.Now().Format(time.RFC3339))
			fmt.Fprintf(file, "Stack Trace:\n%s\n", debug.Stack())

			infoMsg := fmt.Sprintf("Panic details written to %s", filename)
			slog.Info(infoMsg)
			status.Info(infoMsg)
		}

		// Execute cleanup function if provided
		if cleanup != nil {
			cleanup()
		}
	}
}

