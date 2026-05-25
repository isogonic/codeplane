import { spawnSync } from "node:child_process"
import { existsSync, promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export type DesktopComputerPoint = { x: number; y: number }

export type DesktopComputerStep = {
  action: string
  coordinate?: number[]
  to?: number[]
  text?: string
  key?: string
  scrollAmount?: number
  durationMs?: number
}

export type DesktopComputerInput = DesktopComputerStep & {
  actions?: DesktopComputerStep[]
}

export type DesktopComputerAction = {
  action: string
  point?: DesktopComputerPoint
  target?: DesktopComputerPoint
  amount: number
  text?: string
  key?: string
  durationMs?: number
}

export type DesktopComputerResult = {
  actions: DesktopComputerAction[]
  screenshot: { dataUrl: string; width: number; height: number }
  cursor?: DesktopComputerPoint
}

export type DesktopComputerCapture = () => Promise<DesktopComputerResult["screenshot"]>

const CLICK_DELAY_US = 60_000
let desktopCursor: DesktopComputerPoint | undefined

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
  return path.join(tmpdir(), `codeplane-desktop-computer-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`)
}

function readPngSize(bytes: Uint8Array) {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !png.every((value, index) => bytes[index] === value)) {
    return { width: 0, height: 0 }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

async function screenshotFromFile(file: string) {
  const bytes = await fs.readFile(file)
  const size = readPngSize(bytes)
  return {
    ...size,
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
  }
}

function psString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function captureMac(file: string) {
  if (!commandExists("screencapture")) throw new Error("macOS screencapture is not available.")
  try {
    runCommand("screencapture", ["-x", "-C", "-t", "png", file], { timeout: 20_000 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // screencapture exits non-zero on macOS when the parent process lacks
    // Screen Recording in TCC. Translate to the actionable error the user
    // needs to see instead of leaking the generic CLI exit message.
    if (/operation not permitted|not authorized|screen recording/i.test(message)) {
      throw new Error(
        "Screen Recording permission is required to capture the desktop. " +
          "Open System Settings -> Privacy & Security -> Screen Recording, enable Codeplane, then quit and reopen Codeplane Desktop for the change to take effect.",
        { cause: error },
      )
    }
    throw error
  }
  if (!existsSync(file)) {
    throw new Error(
      "Screen Recording permission is required to capture the desktop. " +
        "Open System Settings -> Privacy & Security -> Screen Recording, enable Codeplane, then quit and reopen Codeplane Desktop for the change to take effect.",
    )
  }
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
  const attempts = [
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

async function captureScreen(capture?: DesktopComputerCapture) {
  if (capture) return capture()
  const file = tempPngPath()
  if (process.platform === "darwin") captureMac(file)
  else if (process.platform === "win32") captureWindows(file)
  else captureLinux(file)
  return screenshotFromFile(file)
}

function coordinate(value: number[] | undefined, name: string): DesktopComputerPoint {
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

function runMacActions(actions: DesktopComputerAction[]) {
  const script = `
ObjC.import('ApplicationServices')
ObjC.import('Foundation')

function openApp(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('text must contain the app name for open_app.')
  const task = $.NSTask.alloc.init
  task.launchPath = '/usr/bin/open'
  task.arguments = ['-a', trimmed]
  task.launch
}

const tap = $.kCGHIDEventTap
const left = 0
const right = 1
const middle = 2
const source = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState)
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
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  '1': 18,
  '2': 19,
  '3': 20,
  '4': 21,
  '6': 22,
  '5': 23,
  '=': 24,
  '9': 25,
  '7': 26,
  '-': 27,
  '8': 28,
  '0': 29,
  ']': 30,
  o: 31,
  u: 32,
  '[': 33,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ';': 41,
  '\\\\': 42,
  ',': 43,
  '/': 44,
  n: 45,
  m: 46,
  '.': 47,
  "\\x60": 50,
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
  if (['cmd', 'command', 'meta', 'super'].indexOf(value) >= 0) return Number($.kCGEventFlagMaskCommand)
  if (['ctrl', 'control'].indexOf(value) >= 0) return Number($.kCGEventFlagMaskControl)
  if (['alt', 'option'].indexOf(value) >= 0) return Number($.kCGEventFlagMaskAlternate)
  if (value === 'shift') return Number($.kCGEventFlagMaskShift)
  return 0
}

function postKey(code, down, flags) {
  const ev = $.CGEventCreateKeyboardEvent(source, code, down)
  if (flags) $.CGEventSetFlags(ev, flags)
  $.CGEventPost(tap, ev)
}

function typeText(value) {
  const text = String(value || '')
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i)
    const down = $.CGEventCreateKeyboardEvent(source, 0, true)
    $.CGEventKeyboardSetUnicodeString(down, char.length, char)
    $.CGEventPost(tap, down)
    const up = $.CGEventCreateKeyboardEvent(source, 0, false)
    $.CGEventKeyboardSetUnicodeString(up, char.length, char)
    $.CGEventPost(tap, up)
  }
}

function pressKey(input) {
  const raw = String(input.key || input.text || '')
  if (!raw) throw new Error('key is required for key action.')
  const parts = raw.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const key = parts[parts.length - 1]
  const flags = parts.slice(0, -1).reduce((mask, part) => mask | modifier(part), 0)
  if (keyCodes[key] !== undefined) {
    postKey(keyCodes[key], true, flags)
    postKey(keyCodes[key], false, flags)
    return
  }
  typeText(key)
}

function runStep(input) {
  if (input.action === 'screenshot') return
  if (input.action === 'wait') {
    $.usleep(Math.max(0, Math.min(Number(input.durationMs || 1000), 30000)) * 1000)
    return
  }
  if (input.action === 'type') {
    typeText(input.text)
    return
  }
  if (input.action === 'key') {
    pressKey(input)
    return
  }
  if (input.action === 'open_app') {
    openApp(input.text)
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
  try {
    runCommand(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        script,
        JSON.stringify(
          actions.map((action) => ({
            action: action.action,
            x: action.point?.x,
            y: action.point?.y,
            toX: action.target?.x,
            toY: action.target?.y,
            amount: action.amount,
            text: action.text,
            key: action.key,
            durationMs: action.durationMs,
          })),
        ),
      ],
      { timeout: 10_000 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // JXA/CoreGraphics raises distinctive errors when TCC is missing.
    // Translate to the action the user needs to take instead of leaking raw
    // AppleScript exit text.
    if (/not allowed assistive access|-1719|-25211/i.test(message)) {
      throw new Error(
        "Accessibility permission is required for clicks, typing, and shortcuts. " +
          "Open System Settings -> Privacy & Security -> Accessibility, enable Codeplane, then quit and reopen Codeplane Desktop for the change to take effect.",
        { cause: error },
      )
    }
    throw error
  }
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

function runWindowsActions(actions: DesktopComputerAction[]) {
  const flags = {
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

function runLinuxActions(actions: DesktopComputerAction[]) {
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

function normalizeAction(action: string) {
  if (action === "move" || action === "mouse_move") return "move"
  if (action === "click" || action === "left_click") return "left_click"
  if (action === "drag" || action === "left_click_drag") return "drag"
  if (action === "keypress" || action === "key") return "key"
  return action
}

function stepsFromParams(params: DesktopComputerInput) {
  if (params.action !== "batch") return [params]
  if (!params.actions?.length) throw new Error("actions is required and must not be empty for batch action.")
  return params.actions
}

function runtimeAction(input: DesktopComputerStep): DesktopComputerAction {
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

function updateCursor(actions: DesktopComputerAction[]) {
  for (const action of actions) {
    if (!action.point) continue
    desktopCursor = action.action === "drag" && action.target ? action.target : action.point
  }
}

function performActions(params: DesktopComputerInput) {
  const actions = stepsFromParams(params).map(runtimeAction)
  const executable = actions.filter((action) => action.action !== "screenshot")
  if (executable.every((action) => action.action === "wait")) {
    for (const action of executable) settle(action.durationMs ?? 1_000)
  } else if (process.platform === "darwin") {
    runMacActions(actions)
  } else if (process.platform === "win32") {
    runWindowsActions(actions)
  } else {
    runLinuxActions(actions)
  }
  updateCursor(actions)
  return actions
}

export function desktopComputerNeedsAccessibility(params: DesktopComputerInput) {
  return stepsFromParams(params).some((step) => !["screenshot", "wait"].includes(normalizeAction(step.action)))
}

// Run native desktop control from Electron so OS permissions apply to the
// desktop app process instead of the spawned local server binary.
export async function performDesktopComputer(
  params: DesktopComputerInput,
  options: { captureScreen?: DesktopComputerCapture } = {},
): Promise<DesktopComputerResult> {
  const actions = performActions(params)
  settle(params.action === "wait" ? undefined : (params.durationMs ?? 120))
  const screenshot = await captureScreen(options.captureScreen)
  return {
    actions,
    screenshot,
    cursor: desktopCursor,
  }
}
