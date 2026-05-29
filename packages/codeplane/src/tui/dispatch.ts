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

// The first positional token (the yargs command), skipping global/tui
// options and their values. Returns undefined when there is none — e.g.
// only options, or everything is after `--`.
function leadingPositional(args: string[]): string | undefined {
  let skipNext = false

  for (const arg of args) {
    if (skipNext) {
      skipNext = false
      continue
    }

    if (arg === "--") return undefined
    if (globalFlagOptions.has(arg) || helpOptions.has(arg) || versionOptions.has(arg)) continue
    if (tuiFlagOptions.has(arg)) continue
    if (isValueOption(arg)) {
      skipNext = true
      continue
    }
    if (isEqualsValueOption(arg, globalValueOptions) || isEqualsValueOption(arg, tuiValueOptions)) continue
    if (arg.startsWith("-")) continue
    return arg
  }

  return undefined
}

function hasSubcommand(args: string[]) {
  return leadingPositional(args) !== undefined
}

export function resolveCliArgs(args: string[], interactive = !!process.stdin.isTTY && !!process.stdout.isTTY) {
  if (hasDisplayOnlyFlag(args)) return args
  if (hasSubcommand(args)) return args
  return [hasTuiOption(args) || interactive ? "tui" : "web", ...args]
}

// The command that will actually run after default-command injection, or
// undefined for help/version (where no command runs). Mirrors
// resolveCliArgs so callers — notably cli/preflight.ts — can reason about
// the effective command *before* yargs parses, e.g. to require --instance
// for server commands. Keep in lockstep with resolveCliArgs.
export function effectiveCommand(
  args: string[],
  interactive = !!process.stdin.isTTY && !!process.stdout.isTTY,
): string | undefined {
  if (hasDisplayOnlyFlag(args)) return undefined
  const sub = leadingPositional(args)
  if (sub !== undefined) return sub
  return hasTuiOption(args) || interactive ? "tui" : "web"
}
