import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./computer.txt"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Agent } from "@/agent/agent"
import { Config } from "@/config"
import { Flag } from "@/flag/flag"
import { Provider } from "@/provider"

const AtomicAction = Schema.Union([
  Schema.Literal("screenshot"),
  Schema.Literal("mouse_move"),
  Schema.Literal("move"),
  Schema.Literal("left_click"),
  Schema.Literal("click"),
  Schema.Literal("double_click"),
  Schema.Literal("right_click"),
  Schema.Literal("middle_click"),
  Schema.Literal("left_click_drag"),
  Schema.Literal("drag"),
  Schema.Literal("scroll"),
  Schema.Literal("type"),
  Schema.Literal("key"),
  Schema.Literal("keypress"),
  Schema.Literal("wait"),
  Schema.Literal("open_app"),
])

const Fields = {
  coordinate: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))).annotate({
    description: "Screen coordinate [x, y] for mouse actions, in pixels from the top-left of the primary/virtual desktop.",
  }),
  to: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))).annotate({
    description: "Destination coordinate [x, y] for drag actions.",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to type, app name for open_app, or optional notes/modifier hint for the action.",
  }),
  key: Schema.optional(Schema.String).annotate({
    description: "Key or shortcut to press, such as Enter, Escape, Tab, Cmd+S, Ctrl+L, or Alt+F4.",
  }),
  scrollAmount: Schema.optional(Schema.Number).annotate({
    description: "Scroll amount. Positive scrolls down, negative scrolls up. Defaults to 5 notches/lines.",
  }),
  durationMs: Schema.optional(Schema.Number).annotate({
    description: "Delay for wait actions or post-action settling time in milliseconds.",
  }),
}

const Step = Schema.Struct({
  action: AtomicAction.annotate({
    description:
      "Desktop action: screenshot, mouse_move/move, left_click/click, double_click, right_click, middle_click, left_click_drag/drag, scroll, type, key/keypress, wait, or open_app.",
  }),
  ...Fields,
})

const Action = Schema.Union([AtomicAction, Schema.Literal("batch")])

export const Parameters = Schema.Struct({
  action: Action.annotate({
    description:
      "Desktop action. Use batch with actions[] for fast multi-step cursor/keyboard control without reinitializing the native controller between steps.",
  }),
  ...Fields,
  actions: Schema.optional(Schema.mutable(Schema.Array(Step))).annotate({
    description:
      "Fast action batch. Use with action='batch' to run multiple moves, clicks, drags, scrolls, keypresses, typing, waits, and app launches in one native control pass.",
  }),
})

type Point = { x: number; y: number }
type Screenshot = { dataUrl: string; width: number; height: number; path: string }
type StepInput = Schema.Schema.Type<typeof Step>
type ParametersInput = Schema.Schema.Type<typeof Parameters>
type RuntimeAction = {
  action: string
  point?: Point
  target?: Point
  amount: number
  text?: string
  key?: string
  durationMs?: number
}

const CLICK_DELAY_US = 60_000
let agentCursor: Point | undefined

function commandExists(command: string) {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000,
  })
  return probe.status === 0
}

function runCommand(command: string, args: string[], options?: { timeout?: number }) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: options?.timeout ?? 15_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} exited with status ${result.status}`).trim())
  }
  return result.stdout
}

function tempPngPath() {
  return path.join(tmpdir(), `codeplane-computer-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`)
}

function readPngSize(bytes: Uint8Array) {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !png.every((value, index) => bytes[index] === value)) {
    return { width: 0, height: 0 }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

async function screenshotFromFile(file: string): Promise<Screenshot> {
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
  const size = readPngSize(bytes)
  return {
    ...size,
    path: file,
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
  }
}

function psString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function captureMac(file: string) {
  if (!commandExists("screencapture")) throw new Error("macOS screencapture is not available.")
  runCommand("screencapture", ["-x", "-C", "-t", "png", file], { timeout: 20_000 })
}

function captureWindows(file: string) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$path = ${psString(file)}
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
$cursor = [System.Windows.Forms.Cursor]::Current
if ($cursor -ne $null) {
  $cursorBounds = New-Object System.Drawing.Rectangle ([System.Windows.Forms.Cursor]::Position), $cursor.Size
  $cursor.Draw($graphics, $cursorBounds)
}
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`.trim()
  runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 20_000,
  })
}

function captureLinux(file: string) {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "gnome-screenshot", args: ["-p", "-f", file] },
    { command: "grim", args: [file] },
    { command: "spectacle", args: ["-b", "-p", "-o", file] },
    { command: "scrot", args: [file] },
    { command: "import", args: ["-window", "root", file] },
  ]
  const errors: string[] = []
  for (const attempt of attempts) {
    if (!commandExists(attempt.command)) continue
    try {
      runCommand(attempt.command, attempt.args, { timeout: 20_000 })
      if (existsSync(file)) return
    } catch (error) {
      errors.push(`${attempt.command}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(
    [
      "No Linux screenshot backend succeeded.",
      "Install one of: gnome-screenshot, grim, spectacle, scrot, or ImageMagick import.",
      ...errors,
    ].join("\n"),
  )
}

async function captureScreen(): Promise<Screenshot> {
  const file = tempPngPath()
  if (process.platform === "darwin") captureMac(file)
  else if (process.platform === "win32") captureWindows(file)
  else captureLinux(file)
  return screenshotFromFile(file)
}

function coordinate(value: number[] | undefined, name: string): Point {
  if (!value || value.length < 2) throw new Error(`${name} coordinate is required as [x, y].`)
  const x = Math.round(value[0])
  const y = Math.round(value[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${name} coordinate must contain finite numbers.`)
  return { x, y }
}

function settle(ms: number | undefined) {
  if (!ms || ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, 30_000))
}

function runMacActions(actions: RuntimeAction[]) {
  const script = `
ObjC.import('ApplicationServices')

const systemEvents = Application('System Events')
const tap = $.kCGHIDEventTap
const left = 0
const right = 1
const middle = 2
const event = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  moved: 5,
  leftDragged: 6,
  rightDragged: 7,
  scrollWheel: 22,
  otherDown: 25,
  otherUp: 26,
  otherDragged: 27,
}
const keyCodes = {
  enter: 36,
  return: 36,
  tab: 48,
  escape: 53,
  esc: 53,
  space: 49,
  backspace: 51,
  delete: 117,
  forwarddelete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  left: 123,
  arrowleft: 123,
  right: 124,
  arrowright: 124,
  down: 125,
  arrowdown: 125,
  up: 126,
  arrowup: 126,
}

function point(x, y) {
  return $.CGPointMake(x, y)
}

function post(type, x, y, button) {
  const ev = $.CGEventCreateMouseEvent(null, type, point(x, y), button)
  $.CGEventPost(tap, ev)
}

function move(x, y) {
  $.CGWarpMouseCursorPosition(point(x, y))
  $.CGAssociateMouseAndMouseCursorPosition(1)
  post(event.moved, x, y, left)
}

function click(x, y, down, up, button) {
  move(x, y)
  post(down, x, y, button)
  $.usleep(${CLICK_DELAY_US})
  post(up, x, y, button)
}

function modifier(value) {
  if (['cmd', 'command', 'meta', 'super'].indexOf(value) >= 0) return 'command down'
  if (['ctrl', 'control'].indexOf(value) >= 0) return 'control down'
  if (['alt', 'option'].indexOf(value) >= 0) return 'option down'
  if (value === 'shift') return 'shift down'
}

function pressKey(input) {
  const raw = String(input.key || input.text || '')
  if (!raw) throw new Error('key is required for key action.')
  const parts = raw.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const key = parts[parts.length - 1]
  const using = parts.slice(0, -1).map(modifier).filter(Boolean)
  const options = using.length ? { using } : {}
  if (keyCodes[key] !== undefined) {
    systemEvents.keyCode(keyCodes[key], options)
    return
  }
  systemEvents.keystroke(key, options)
}

function runStep(input) {
  if (input.action === 'screenshot') return
  if (input.action === 'wait') {
    $.usleep(Math.max(0, Math.min(Number(input.durationMs || 1000), 30000)) * 1000)
    return
  }
  if (input.action === 'type') {
    systemEvents.keystroke(String(input.text || ''))
    return
  }
  if (input.action === 'key') {
    pressKey(input)
    return
  }
  if (input.action === 'open_app') {
    Application(String(input.text || '')).activate()
    return
  }
  if (input.action === 'move') move(input.x, input.y)
  if (input.action === 'left_click') click(input.x, input.y, event.leftDown, event.leftUp, left)
  if (input.action === 'double_click') {
    click(input.x, input.y, event.leftDown, event.leftUp, left)
    $.usleep(${CLICK_DELAY_US})
    click(input.x, input.y, event.leftDown, event.leftUp, left)
  }
  if (input.action === 'right_click') click(input.x, input.y, event.rightDown, event.rightUp, right)
  if (input.action === 'middle_click') click(input.x, input.y, event.otherDown, event.otherUp, middle)
  if (input.action === 'drag') {
    move(input.x, input.y)
    post(event.leftDown, input.x, input.y, left)
    $.usleep(${CLICK_DELAY_US})
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const x = input.x + ((input.toX - input.x) * i / steps)
      const y = input.y + ((input.toY - input.y) * i / steps)
      move(x, y)
      post(event.leftDragged, x, y, left)
      $.usleep(20000)
    }
    post(event.leftUp, input.toX, input.toY, left)
  }
  if (input.action === 'scroll') {
    if (Number.isFinite(input.x) && Number.isFinite(input.y)) move(input.x, input.y)
    const ev = $.CGEventCreateScrollWheelEvent(null, 0, 1, -input.amount)
    $.CGEventPost(tap, ev)
  }
}

function run(argv) {
  JSON.parse(argv[0]).forEach(runStep)
}
`.trim()
  runCommand("osascript", ["-l", "JavaScript", "-e", script, JSON.stringify(actions.map((action) => ({
    action: action.action,
    x: action.point?.x,
    y: action.point?.y,
    toX: action.target?.x,
    toY: action.target?.y,
    amount: action.amount,
    text: action.text,
    key: action.key,
    durationMs: action.durationMs,
  })))], { timeout: 10_000 })
}

function linuxXdotool() {
  if (!commandExists("xdotool")) {
    throw new Error("Linux desktop control requires xdotool. Install xdotool or run under an X11 desktop session.")
  }
}

function windowsSendKeysValue(input: string) {
  const normalized = input.trim().toLowerCase()
  const lookup: Record<string, string> = {
    enter: "{ENTER}",
    return: "{ENTER}",
    escape: "{ESC}",
    esc: "{ESC}",
    tab: "{TAB}",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    space: " ",
    up: "{UP}",
    arrowup: "{UP}",
    down: "{DOWN}",
    arrowdown: "{DOWN}",
    left: "{LEFT}",
    arrowleft: "{LEFT}",
    right: "{RIGHT}",
    arrowright: "{RIGHT}",
    home: "{HOME}",
    end: "{END}",
    pageup: "{PGUP}",
    pagedown: "{PGDN}",
  }
  return lookup[normalized] ?? input
}

function windowsShortcut(input: string) {
  const parts = input.split("+").map((part) => part.trim()).filter(Boolean)
  const key = windowsSendKeysValue(parts.pop() ?? "")
  const prefix = parts
    .map((part) => {
      const item = part.toLowerCase()
      if (item === "ctrl" || item === "control") return "^"
      if (item === "alt" || item === "option") return "%"
      if (item === "shift") return "+"
      return ""
    })
    .join("")
  return `${prefix}${key}`
}

function windowsText(input: string) {
  return input.replace(/[+^%~()[\]{}\n\t]/g, (char) => {
    if (char === "\n") return "{ENTER}"
    if (char === "\t") return "{TAB}"
    if (char === "{") return "{{}"
    if (char === "}") return "{}}"
    return `{${char}}`
  })
}

function runWindowsActions(actions: RuntimeAction[]) {
  const flags: Record<string, number> = {
    leftDown: 0x0002,
    leftUp: 0x0004,
    rightDown: 0x0008,
    rightUp: 0x0010,
    middleDown: 0x0020,
    middleUp: 0x0040,
    wheel: 0x0800,
  }
  const payload = actions.map((action) => ({
    action: action.action,
    x: action.point?.x ?? 0,
    y: action.point?.y ?? 0,
    toX: action.target?.x ?? action.point?.x ?? 0,
    toY: action.target?.y ?? action.point?.y ?? 0,
    amount: action.amount,
    text: action.text,
    sendKeys: action.action === "key" ? windowsShortcut(action.key ?? action.text ?? "") : windowsText(action.text ?? ""),
    durationMs: action.durationMs,
  }))
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
'@
function Click($down, $up) { [Mouse]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [Mouse]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero) }
$actions = @(${psString(JSON.stringify(payload))} | ConvertFrom-Json)
foreach ($input in $actions) {
  if ($input.action -eq 'screenshot') { continue }
  if ($input.action -eq 'wait') {
    $duration = if ($null -eq $input.durationMs) { 1000 } else { [int]$input.durationMs }
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max($duration, 0), 30000))
    continue
  }
  if ($input.action -eq 'type' -or $input.action -eq 'key') { [System.Windows.Forms.SendKeys]::SendWait([string]$input.sendKeys); continue }
  if ($input.action -eq 'open_app') { Start-Process ([string]$input.text); continue }
  [Mouse]::SetCursorPos([int]$input.x, [int]$input.y) | Out-Null
  if ($input.action -eq 'move') { continue }
  if ($input.action -eq 'left_click') { Click ${flags.leftDown} ${flags.leftUp}; continue }
  if ($input.action -eq 'double_click') { Click ${flags.leftDown} ${flags.leftUp}; Start-Sleep -Milliseconds 40; Click ${flags.leftDown} ${flags.leftUp}; continue }
  if ($input.action -eq 'right_click') { Click ${flags.rightDown} ${flags.rightUp}; continue }
  if ($input.action -eq 'middle_click') { Click ${flags.middleDown} ${flags.middleUp}; continue }
  if ($input.action -eq 'drag') { [Mouse]::mouse_event(${flags.leftDown}, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [Mouse]::SetCursorPos([int]$input.toX, [int]$input.toY) | Out-Null; Start-Sleep -Milliseconds 40; [Mouse]::mouse_event(${flags.leftUp}, 0, 0, 0, [UIntPtr]::Zero); continue }
  if ($input.action -eq 'scroll') { [Mouse]::mouse_event(${flags.wheel}, 0, 0, [int](-[double]$input.amount * 120), [UIntPtr]::Zero); continue }
}
`.trim()
  runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 10_000,
  })
}

function runLinuxActions(actions: RuntimeAction[]) {
  linuxXdotool()
  let args: string[] = []
  const flush = () => {
    if (args.length === 0) return
    runCommand("xdotool", args)
    args = []
  }
  for (const action of actions) {
    if (action.action === "screenshot") continue
    if (action.action === "wait") {
      flush()
      settle(action.durationMs ?? 1_000)
      continue
    }
    if (action.action === "open_app") {
      flush()
      if (!action.text?.trim()) throw new Error("text must contain the app name for open_app.")
      runCommand("sh", ["-lc", `gtk-launch ${JSON.stringify(action.text.trim())} >/dev/null 2>&1 || ${JSON.stringify(action.text.trim())} >/dev/null 2>&1 &`])
      continue
    }
    if (action.action === "type") {
      args.push("type", "--clearmodifiers", "--", action.text ?? "")
      continue
    }
    if (action.action === "key") {
      args.push("key", "--clearmodifiers", (action.key ?? action.text ?? "").replaceAll("Cmd", "Super").replaceAll("Command", "Super"))
      continue
    }
    if (action.action === "scroll") {
      if (action.point) args.push("mousemove", String(action.point.x), String(action.point.y))
      const button = action.amount >= 0 ? "5" : "4"
      for (let i = 0; i < Math.min(50, Math.max(1, Math.abs(Math.round(action.amount)))); i++) args.push("click", button)
      continue
    }
    if (!action.point) throw new Error("coordinate is required for mouse action.")
    args.push("mousemove", String(action.point.x), String(action.point.y))
    if (action.action === "move") continue
    if (action.action === "left_click") args.push("click", "1")
    if (action.action === "double_click") args.push("click", "--repeat", "2", "--delay", "40", "1")
    if (action.action === "right_click") args.push("click", "3")
    if (action.action === "middle_click") args.push("click", "2")
    if (action.action === "drag") {
      if (!action.target) throw new Error("to coordinate is required for drag action.")
      args.push("mousedown", "1", "mousemove", "--sync", String(action.target.x), String(action.target.y), "mouseup", "1")
    }
  }
  flush()
}

function normalizeAction(action: Schema.Schema.Type<typeof Action>) {
  if (action === "move" || action === "mouse_move") return "move"
  if (action === "click" || action === "left_click") return "left_click"
  if (action === "drag" || action === "left_click_drag") return "drag"
  if (action === "keypress" || action === "key") return "key"
  return action
}

function stepsFromParams(params: ParametersInput): StepInput[] {
  if (params.action !== "batch") return [params as StepInput]
  if (!params.actions?.length) throw new Error("actions is required and must not be empty for batch action.")
  return params.actions
}

function runtimeAction(input: StepInput): RuntimeAction {
  const action = normalizeAction(input.action)
  const point = input.coordinate ? coordinate(input.coordinate, "coordinate") : undefined
  const target = input.to ? coordinate(input.to, "to") : undefined
  const result = {
    action,
    point,
    target,
    amount: input.scrollAmount ?? 5,
    text: input.text,
    key: input.key,
    durationMs: input.durationMs,
  }

  if (["move", "left_click", "double_click", "right_click", "middle_click"].includes(action) && !point) {
    throw new Error("coordinate is required for mouse action.")
  }
  if (action === "drag" && (!point || !target)) throw new Error("coordinate and to are required for drag action.")
  if (action === "type" && result.text === undefined) throw new Error("text is required for type action.")
  if (action === "key" && !result.key && !result.text) throw new Error("key is required for key action.")
  if (action === "open_app" && !result.text?.trim()) throw new Error("text must contain the app name for open_app.")

  return result
}

function updateCursor(actions: RuntimeAction[]) {
  for (const action of actions) {
    if (!action.point) continue
    agentCursor = action.action === "drag" && action.target ? action.target : action.point
  }
}

function performActions(params: ParametersInput) {
  const actions = stepsFromParams(params).map(runtimeAction)
  const executable = actions.filter((action) => action.action !== "screenshot")
  if (executable.every((action) => action.action === "wait")) {
    for (const action of executable) settle(action.durationMs ?? 1_000)
  } else if (process.platform === "darwin") runMacActions(actions)
  else if (process.platform === "win32") runWindowsActions(actions)
  else runLinuxActions(actions)
  updateCursor(actions)
  return actions
}

function stepSummary(action: RuntimeAction) {
  if (action.action === "screenshot") return "Captured desktop screenshot."
  if (action.action === "wait") return `Waited ${action.durationMs ?? 1_000}ms.`
  if (action.action === "type") return `Typed ${JSON.stringify((action.text ?? "").slice(0, 80))}.`
  if (action.action === "key") return `Pressed ${action.key ?? action.text}.`
  if (action.action === "open_app") return `Opened application ${action.text}.`
  if (action.action === "drag") return `Dragged from ${JSON.stringify(action.point)} to ${JSON.stringify(action.target)}.`
  if (action.action === "scroll") return `Scrolled ${action.amount} at ${JSON.stringify(action.point ?? agentCursor ?? null)}.`
  return `${action.action} at ${JSON.stringify(action.point)}.`
}

function actionSummary(params: ParametersInput, actions: RuntimeAction[]) {
  if (params.action !== "batch") return stepSummary(actions[0]!)
  return [`Ran ${actions.length} fast desktop actions:`, ...actions.slice(0, 12).map((action, index) => `${index + 1}. ${stepSummary(action)}`), actions.length > 12 ? `...${actions.length - 12} more actions.` : undefined]
    .filter(Boolean)
    .join("\n")
}

function contextModel(ctx: Tool.Context) {
  const model = ctx.extra?.model
  if (!model || typeof model !== "object") return
  if (!("capabilities" in model)) return
  return model as Provider.Model
}

export const ComputerTool = Tool.define(
  "computer",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      timeoutMs: 120_000,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const client = Flag.CODEPLANE_CLIENT
          const isDesktop = client === "app" || process.env.CODEPLANE_DESKTOP_MANAGED === "1"
          if (!isDesktop) {
            return {
              output: "Computer use is only available in the Codeplane Desktop app.",
              title: "computer",
              metadata: {},
            }
          }

          const config = yield* Config.Service
          const cfg = yield* config.get()
          if (cfg.tools?.computer !== true) {
            return {
              output: "Computer use is disabled. Enable Computer use in Desktop Settings → General first.",
              title: "computer",
              metadata: {},
            }
          }

          const agents = yield* Agent.Service
          const agentInfo = yield* agents.get(ctx.agent)
          const activeModel = contextModel(ctx)
          if (activeModel) {
            if (!activeModel.capabilities?.input?.image) {
              return {
                output: "Computer use is only available with vision-capable models. Switch to a model that supports image input.",
                title: "computer",
                metadata: {},
              }
            }
          } else if (!agentInfo.model?.providerID || !agentInfo.model?.modelID) {
            return {
              output: "Computer use requires a model that supports vision/image input.",
              title: "computer",
              metadata: {},
            }
          } else {
            const providerSvc = yield* Provider.Service
            const model = yield* providerSvc
              .getModel(agentInfo.model.providerID, agentInfo.model.modelID)
              .pipe(Effect.catch(() => Effect.succeed(undefined)), Effect.catchDefect(() => Effect.succeed(undefined)))
            if (!model?.capabilities?.input?.image) {
              return {
                output: "Computer use is only available with vision-capable models. Switch to a model that supports image input.",
                title: "computer",
                metadata: {},
              }
            }
          }

          const steps = stepsFromParams(params)
          const patterns = [...new Set(steps.map((step) => normalizeAction(step.action)))]
          yield* ctx.ask({
            permission: "computer",
            patterns,
            always: ["*"],
            metadata: { action: params.action, actions: patterns, coordinate: params.coordinate, to: params.to },
          })

          const actions = yield* Effect.promise(() => Promise.resolve(performActions(params)))
          settle(params.action === "wait" ? undefined : (params.durationMs ?? 120))
          const screenshot = yield* Effect.promise(() => captureScreen())
          const output = [
            `# Computer Use`,
            "",
            actionSummary(params, actions),
            "",
            `Screenshot: ${screenshot.width}x${screenshot.height}.`,
            agentCursor ? `Agent cursor: (${agentCursor.x}, ${agentCursor.y}).` : undefined,
            "",
            "Security note: stop and ask the user before passwords, payments, account changes, destructive actions, or consent dialogs.",
          ]
            .filter(Boolean)
            .join("\n")

          return {
            output,
            title: `computer: ${params.action === "batch" ? `batch(${actions.length})` : normalizeAction(params.action)}`,
            metadata: {
              action: normalizeAction(params.action),
              actions: actions.map((action) => action.action),
              platform: process.platform,
              width: screenshot.width,
              height: screenshot.height,
              screenshotMime: "image/png",
              screenshotDataUrl: screenshot.dataUrl,
              cursor: agentCursor,
            },
            attachments: [
              {
                type: "file",
                mime: "image/png",
                url: screenshot.dataUrl,
                filename: `computer-${params.action === "batch" ? "batch" : normalizeAction(params.action)}-${Date.now()}.png`,
              },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }) as any,
)
