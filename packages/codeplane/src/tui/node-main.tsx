import React from "react"
import { render } from "ink"
import { App } from "./app"

function parseArgs(argv: string[]) {
  const result: {
    instance?: string
    route?: string
  } = {}

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--instance") result.instance = argv[index + 1]
    if (arg === "--route") result.route = argv[index + 1]
  }

  return result
}

const args = parseArgs(process.argv.slice(2))

render(<App initialInstanceID={args.instance} initialRoute={args.route} />, {
  alternateScreen: true,
  patchConsole: false,
  exitOnCtrlC: true,
  isScreenReaderEnabled: process.env.INK_SCREEN_READER === "true" || process.env.CODEPLANE_TUI_SCREEN_READER === "1",
})
