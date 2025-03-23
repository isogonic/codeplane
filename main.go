/*
Copyright © 2025 NAME HERE <EMAIL ADDRESS>
*/
package main

import (
	"log"
	"os"

	"github.com/kujtimiihoxha/termai/cmd"
)

func main() {
	// Create a log file and make that the log output
	logfile, err := os.OpenFile("debug.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o666)
	if err != nil {
		panic(err)
	}

	log.SetOutput(logfile)

	cmd.Execute()
}
