package main

import (
	"log"
	"os"

	"github.com/kujtimiihoxha/termai/cmd"
)

func main() {
	// Create a log file and make that the log output DEBUG
	// TODO: remove this on release
	logfile, err := os.OpenFile("debug.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o666)
	if err != nil {
		panic(err)
	}

	log.SetOutput(logfile)

	cmd.Execute()
}
