const globalFlagOptions = new Set(["--print-logs", "--pure"])
const globalValueOptions = new Set(["--log-level"])
const helpOptions = new Set(["-h", "--help"])
const versionOptions = new Set(["-v", "--version"])

function hasDisplayOnlyFlag(args: string[]) {
  return args.some((arg) => helpOptions.has(arg) || versionOptions.has(arg))
}

function hasSubcommand(args: string[]) {
  let skipNext = false

  for (const arg of args) {
    if (skipNext) {
      skipNext = false
      continue
    }

    if (arg === "--") return false
    if (globalFlagOptions.has(arg) || helpOptions.has(arg) || versionOptions.has(arg)) continue
    if (globalValueOptions.has(arg)) {
      skipNext = true
      continue
    }
    if (arg.startsWith("-")) continue
    return true
  }

  return false
}

export function resolveCliArgs(args: string[], interactive = !!process.stdin.isTTY && !!process.stdout.isTTY) {
  if (hasDisplayOnlyFlag(args)) return args
  if (hasSubcommand(args)) return args
  return [interactive ? "tui" : "web", ...args]
}
