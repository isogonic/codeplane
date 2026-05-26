export type MacComputerScriptAction = {
  action: string
  x?: number
  y?: number
  toX?: number
  toY?: number
  amount: number
  text?: string
  key?: string
  durationMs?: number
}

export function buildMacComputerScript(clickDelayUs: number) {
  const clickDelaySeconds = Math.max(0.001, Math.min(clickDelayUs, 1_000_000) / 1_000_000)
  return `
ObjC.import('ApplicationServices')
ObjC.import('Foundation')

const system = Application('System Events')
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
const specialKeyCodes = {
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

function openApp(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('text must contain the app name for open_app.')
  const task = $.NSTask.alloc.init
  task.launchPath = '/usr/bin/open'
  task.arguments = ['-a', trimmed]
  task.launch
}

function pause(seconds) {
  delay(Math.max(0, Math.min(Number(seconds || 0), 30)))
}

function pauseMs(ms) {
  pause(Math.max(0, Math.min(Number(ms || 0), 30000)) / 1000)
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
  pause(${clickDelaySeconds})
  post(up, x, y, button)
}

function modifier(value) {
  if (['cmd', 'command', 'meta', 'super'].indexOf(value) >= 0) return 'command down'
  if (['ctrl', 'control'].indexOf(value) >= 0) return 'control down'
  if (['alt', 'option'].indexOf(value) >= 0) return 'option down'
  if (value === 'shift') return 'shift down'
  return undefined
}

function withModifiers(using) {
  if (using.length === 0) return undefined
  return { using: using.length === 1 ? using[0] : using }
}

function typeText(value) {
  const text = String(value || '')
  if (!text) return
  system.keystroke(text)
}

function pressKey(input) {
  const raw = String(input.key || input.text || '')
  if (!raw) throw new Error('key is required for key action.')
  const parts = raw.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const key = parts[parts.length - 1]
  const options = withModifiers(parts.slice(0, -1).map(modifier).filter(Boolean))
  if (specialKeyCodes[key] !== undefined) {
    if (options) system.keyCode(specialKeyCodes[key], options)
    else system.keyCode(specialKeyCodes[key])
    return
  }
  if (options) system.keystroke(key, options)
  else system.keystroke(key)
}

function runStep(input) {
  if (input.action === 'screenshot') return
  if (input.action === 'wait') {
    pauseMs(input.durationMs || 1000)
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
    pause(${clickDelaySeconds})
    click(input.x, input.y, event.leftDown, event.leftUp, left)
  }
  if (input.action === 'right_click') click(input.x, input.y, event.rightDown, event.rightUp, right)
  if (input.action === 'middle_click') click(input.x, input.y, event.otherDown, event.otherUp, middle)
  if (input.action === 'drag') {
    move(input.x, input.y)
    post(event.leftDown, input.x, input.y, left)
    pause(${clickDelaySeconds})
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const x = input.x + ((input.toX - input.x) * i / steps)
      const y = input.y + ((input.toY - input.y) * i / steps)
      move(x, y)
      post(event.leftDragged, x, y, left)
      pause(0.02)
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

run(this.arguments)
`.trim()
}
