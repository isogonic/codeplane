import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./computer.txt"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Agent } from "@/agent/agent"
import { Flag } from "@/flag/flag"
import { Provider } from "@/provider"

const Action = Schema.Union([
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

export const Parameters = Schema.Struct({
  action: Action.annotate({
    description:
      "Desktop action: screenshot, mouse_move/move, left_click/click, double_click, right_click, middle_click, left_click_drag/drag, scroll, type, key/keypress, wait, or open_app.",
  }),
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
})

type Point = { x: number; y: number }
type Screenshot = { dataUrl: string; width: number; height: number; path: string }

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

function runMacMouse(input: Record<string, unknown>) {
  const script = `
ObjC.import('ApplicationServices')

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

function run(argv) {
  const input = JSON.parse(argv[0])
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
`.trim()
  runCommand("osascript", ["-l", "JavaScript", "-e", script, JSON.stringify(input)], { timeout: 10_000 })
}

const MAC_KEY_CODES: Record<string, number> = {
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

function macModifier(value: string) {
  if (["cmd", "command", "meta", "super"].includes(value)) return "command down"
  if (["ctrl", "control"].includes(value)) return "control down"
  if (["alt", "option"].includes(value)) return "option down"
  if (value === "shift") return "shift down"
}

function runAppleScript(script: string, args: string[] = []) {
  runCommand("osascript", ["-e", script, ...args], { timeout: 10_000 })
}

function runMacType(text: string) {
  runAppleScript('on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run', [text])
}

function runMacKey(input: string) {
  const parts = input.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean)
  const key = parts.at(-1)
  if (!key) throw new Error("key is required for key action.")
  const modifiers = parts.slice(0, -1).flatMap((part) => {
    const modifier = macModifier(part)
    return modifier ? [modifier] : []
  })
  const using = modifiers.length ? ` using {${modifiers.join(", ")}}` : ""
  const code = MAC_KEY_CODES[key]
  if (code !== undefined) {
    runAppleScript(`tell application "System Events" to key code ${code}${using}`)
    return
  }
  runAppleScript(`on run argv\ntell application "System Events" to keystroke (item 1 of argv)${using}\nend run`, [key])
}

function linuxXdotool() {
  if (!commandExists("xdotool")) {
    throw new Error("Linux desktop control requires xdotool. Install xdotool or run under an X11 desktop session.")
  }
}

function runLinuxMouse(action: string, point: Point | undefined, to: Point | undefined, amount: number) {
  linuxXdotool()
  if (action === "scroll") {
    if (point) runCommand("xdotool", ["mousemove", String(point.x), String(point.y)])
    const button = amount >= 0 ? "5" : "4"
    for (let i = 0; i < Math.min(50, Math.max(1, Math.abs(Math.round(amount)))); i++) {
      runCommand("xdotool", ["click", button])
    }
    return
  }
  if (!point) throw new Error("coordinate is required for mouse action.")
  if (action === "move") runCommand("xdotool", ["mousemove", String(point.x), String(point.y)])
  if (action === "left_click") runCommand("xdotool", ["mousemove", String(point.x), String(point.y), "click", "1"])
  if (action === "double_click") runCommand("xdotool", ["mousemove", String(point.x), String(point.y), "click", "--repeat", "2", "--delay", "80", "1"])
  if (action === "right_click") runCommand("xdotool", ["mousemove", String(point.x), String(point.y), "click", "3"])
  if (action === "middle_click") runCommand("xdotool", ["mousemove", String(point.x), String(point.y), "click", "2"])
  if (action === "drag") {
    if (!to) throw new Error("to coordinate is required for drag action.")
    runCommand("xdotool", [
      "mousemove",
      String(point.x),
      String(point.y),
      "mousedown",
      "1",
      "mousemove",
      "--sync",
      String(to.x),
      String(to.y),
      "mouseup",
      "1",
    ])
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

function runWindowsMouse(action: string, point: Point | undefined, to: Point | undefined, amount: number) {
  const p = point ?? { x: 0, y: 0 }
  const target = to ?? p
  const flags: Record<string, number> = {
    leftDown: 0x0002,
    leftUp: 0x0004,
    rightDown: 0x0008,
    rightUp: 0x0010,
    middleDown: 0x0020,
    middleUp: 0x0040,
    wheel: 0x0800,
  }
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@
function Click($down, $up) { [Mouse]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [Mouse]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero) }
[Mouse]::SetCursorPos(${p.x}, ${p.y}) | Out-Null
if (${psString(action)} -eq 'left_click') { Click ${flags.leftDown} ${flags.leftUp} }
if (${psString(action)} -eq 'double_click') { Click ${flags.leftDown} ${flags.leftUp}; Start-Sleep -Milliseconds 60; Click ${flags.leftDown} ${flags.leftUp} }
if (${psString(action)} -eq 'right_click') { Click ${flags.rightDown} ${flags.rightUp} }
if (${psString(action)} -eq 'middle_click') { Click ${flags.middleDown} ${flags.middleUp} }
if (${psString(action)} -eq 'drag') { [Mouse]::mouse_event(${flags.leftDown}, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [Mouse]::SetCursorPos(${target.x}, ${target.y}) | Out-Null; Start-Sleep -Milliseconds 60; [Mouse]::mouse_event(${flags.leftUp}, 0, 0, 0, [UIntPtr]::Zero) }
if (${psString(action)} -eq 'scroll') { [Mouse]::mouse_event(${flags.wheel}, 0, 0, [uint32](${Math.round(-amount * 120)}), [UIntPtr]::Zero) }
`.trim()
  runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 10_000,
  })
}

function runWindowsType(text: string) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psString(text)})`
  runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 10_000,
  })
}

function runWindowsKey(key: string) {
  runWindowsType(windowsShortcut(key))
}

function normalizeAction(action: Schema.Schema.Type<typeof Action>) {
  if (action === "move" || action === "mouse_move") return "move"
  if (action === "click" || action === "left_click") return "left_click"
  if (action === "drag" || action === "left_click_drag") return "drag"
  if (action === "keypress" || action === "key") return "key"
  return action
}

function performAction(params: Schema.Schema.Type<typeof Parameters>) {
  const action = normalizeAction(params.action)
  const point = params.coordinate ? coordinate(params.coordinate, "coordinate") : undefined
  const target = params.to ? coordinate(params.to, "to") : undefined
  const amount = params.scrollAmount ?? 5

  if (action === "screenshot") return
  if (action === "wait") {
    settle(params.durationMs ?? 1_000)
    return
  }
  if (action === "open_app") {
    if (!params.text?.trim()) throw new Error("text must contain the app name for open_app.")
    if (process.platform === "darwin") runCommand("open", ["-a", params.text.trim()])
    else if (process.platform === "win32") {
      runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process ${psString(params.text.trim())}`])
    } else {
      runCommand("sh", ["-lc", `gtk-launch ${JSON.stringify(params.text.trim())} >/dev/null 2>&1 || ${JSON.stringify(params.text.trim())} >/dev/null 2>&1 &`])
    }
    return
  }
  if (action === "type") {
    if (params.text === undefined) throw new Error("text is required for type action.")
    if (process.platform === "darwin") runMacType(params.text)
    else if (process.platform === "win32") runWindowsType(params.text)
    else {
      linuxXdotool()
      runCommand("xdotool", ["type", "--clearmodifiers", "--", params.text])
    }
    return
  }
  if (action === "key") {
    const key = params.key ?? params.text
    if (!key) throw new Error("key is required for key action.")
    if (process.platform === "darwin") runMacKey(key)
    else if (process.platform === "win32") runWindowsKey(key)
    else {
      linuxXdotool()
      runCommand("xdotool", ["key", "--clearmodifiers", key.replaceAll("Cmd", "Super").replaceAll("Command", "Super")])
    }
    return
  }

  if (process.platform === "darwin") {
    if (action !== "scroll" && !point) throw new Error("coordinate is required for mouse action.")
    runMacMouse({ action, x: point?.x, y: point?.y, toX: target?.x, toY: target?.y, amount })
  } else if (process.platform === "win32") {
    runWindowsMouse(action, point, target, amount)
  } else {
    runLinuxMouse(action, point, target, amount)
  }

  if (point) agentCursor = action === "drag" && target ? target : point
}

function actionSummary(params: Schema.Schema.Type<typeof Parameters>) {
  const action = normalizeAction(params.action)
  if (action === "screenshot") return "Captured desktop screenshot."
  if (action === "wait") return `Waited ${params.durationMs ?? 1_000}ms.`
  if (action === "type") return `Typed ${JSON.stringify((params.text ?? "").slice(0, 80))}.`
  if (action === "key") return `Pressed ${params.key ?? params.text}.`
  if (action === "open_app") return `Opened application ${params.text}.`
  if (action === "drag") return `Dragged from ${JSON.stringify(params.coordinate)} to ${JSON.stringify(params.to)}.`
  if (action === "scroll") return `Scrolled ${params.scrollAmount ?? 5} at ${JSON.stringify(params.coordinate ?? agentCursor ?? null)}.`
  return `${action} at ${JSON.stringify(params.coordinate)}.`
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

          const agents = yield* Agent.Service
          const agentInfo = yield* agents.get(ctx.agent)
          const providerSvc = yield* Provider.Service
          if (!agentInfo.model?.providerID || !agentInfo.model?.modelID) {
            return {
              output: "Computer use requires a model that supports vision/image input.",
              title: "computer",
              metadata: {},
            }
          }
          const model = yield* providerSvc.getModel(agentInfo.model.providerID, agentInfo.model.modelID)
          if (!model?.capabilities?.input?.image) {
            return {
              output: "Computer use is only available with vision-capable models. Switch to a model that supports image input.",
              title: "computer",
              metadata: {},
            }
          }

          yield* ctx.ask({
            permission: "computer",
            patterns: [normalizeAction(params.action)],
            always: ["*"],
            metadata: { action: params.action, coordinate: params.coordinate, to: params.to },
          })

          yield* Effect.promise(() => Promise.resolve(performAction(params)))
          settle(params.action === "wait" ? undefined : (params.durationMs ?? 350))
          const screenshot = yield* Effect.promise(() => captureScreen())
          const output = [
            `# Computer Use`,
            "",
            actionSummary(params),
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
            title: `computer: ${normalizeAction(params.action)}`,
            metadata: {
              action: normalizeAction(params.action),
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
                filename: `computer-${normalizeAction(params.action)}-${Date.now()}.png`,
              },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }) as any,
)
