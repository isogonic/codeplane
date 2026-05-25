const globalFlagOptions = new Set(["--print-logs", "--pure"])
const globalValueOptions = new Set(["--log-level"])
const tuiFlagOptions = new Set(["--continue", "-c", "--fork"])
const tuiValueOptions = new Set([
  "--session",
  "-s",
  "--instance",
  "-i",
  "--dir",
  "--directory",
  "--model",
  "-m",
  "--agent",
  "--prompt",
])
const helpOptions = new Set(["-h", "--help"])
const versionOptions = new Set(["-v", "--version"])

function hasDisplayOnlyFlag(args: string[]) {
  return args.some((arg) => helpOptions.has(arg) || versionOptions.has(arg))
}

function isEqualsValueOption(arg: string, options: Set<string>) {
  return options.entries().some(([option]) => option.startsWith("--") && arg.startsWith(`${option}=`))
}

function isValueOption(arg: string) {
  return globalValueOptions.has(arg) || tuiValueOptions.has(arg)
}

function hasTuiOption(args: string[]) {
  return args.some((arg) => tuiFlagOptions.has(arg) || tuiValueOptions.has(arg) || isEqualsValueOption(arg, tuiValueOptions))
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
    if (tuiFlagOptions.has(arg)) continue
    if (isValueOption(arg)) {
      skipNext = true
      continue
    }
    if (isEqualsValueOption(arg, globalValueOptions) || isEqualsValueOption(arg, tuiValueOptions)) continue
    if (arg.startsWith("-")) continue
    return true
  }

  return false
}

export function resolveCliArgs(args: string[], interactive = !!process.stdin.isTTY && !!process.stdout.isTTY) {
  if (hasDisplayOnlyFlag(args)) return args
  if (hasSubcommand(args)) return args
  return [hasTuiOption(args) || interactive ? "tui" : "web", ...args]
}
