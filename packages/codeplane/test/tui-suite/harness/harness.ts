import type { JSX } from "@opentui/solid"
import { testRender } from "@opentui/solid"
import type { TestRenderer, MockInput, MockMouse } from "@opentui/core/testing"
import type { CapturedFrame } from "@opentui/core"
import { captureFrameSnapshot, frameToText, type FrameSnapshot } from "./snapshot"
import { parseChord } from "./keys"

export interface HarnessOptions {
  /** Initial terminal width in columns. Default 100. */
  width?: number
  /** Initial terminal height in rows. Default 30. */
  height?: number
  /** Enable kitty keyboard protocol parsing. Default true. */
  kittyKeyboard?: boolean
  /** Other modifiers mode (kitty alt-form). Default false. */
  otherModifiersMode?: boolean
}

/**
 * Find result for a piece of text on the rendered screen.
 */
export interface FindResult {
  /** Zero-based row of the first match. */
  row: number
  /** Zero-based column of the first match. */
  col: number
  /** The matched substring. */
  text: string
}

/**
 * Drives a Solid TUI in-process and lets you observe + interact with it.
 *
 * Usage:
 *   const h = await mount(() => <MyComponent />)
 *   await h.press("down")
 *   await h.frame()
 *   h.expectVisible("Selected")
 *   await h.unmount()
 */
export class TuiHarness {
  readonly renderer: TestRenderer
  readonly input: MockInput
  readonly mouse: MockMouse
  private readonly _renderOnce: () => Promise<void>
  private readonly _captureFrame: () => string
  private readonly _captureSpans: () => CapturedFrame
  private readonly _resize: (w: number, h: number) => void
  private destroyed = false

  constructor(opts: {
    renderer: TestRenderer
    mockInput: MockInput
    mockMouse: MockMouse
    renderOnce: () => Promise<void>
    captureCharFrame: () => string
    captureSpans: () => CapturedFrame
    resize: (w: number, h: number) => void
  }) {
    this.renderer = opts.renderer
    this.input = opts.mockInput
    this.mouse = opts.mockMouse
    this._renderOnce = opts.renderOnce
    this._captureFrame = opts.captureCharFrame
    this._captureSpans = opts.captureSpans
    this._resize = opts.resize
  }

  /** Render once and wait for the renderer to report idle. */
  async settle(): Promise<void> {
    await this._renderOnce()
    await this.renderer.idle()
  }

  /** Capture the current frame as a structured snapshot (text + styled spans). */
  frame(): FrameSnapshot {
    const spans = this._captureSpans()
    const text = this._captureFrame()
    return captureFrameSnapshot(spans, text)
  }

  /** Capture the current frame's plain text. */
  text(): string {
    return this._captureFrame()
  }

  /** Press a single chord like "down", "ctrl+a", "shift+tab". */
  async press(chord: string): Promise<void> {
    const { key, modifiers } = parseChord(chord)
    this.input.pressKey(key, modifiers)
    await this.settle()
  }

  /** Press a sequence of chords with a small delay between each. */
  async pressSeq(chords: string[], delayMs = 0): Promise<void> {
    for (const c of chords) {
      await this.press(c)
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  /** Type a string of literal characters. */
  async type(text: string): Promise<void> {
    await this.input.typeText(text)
    await this.settle()
  }

  /** Paste text via bracketed-paste (faster than type, no per-char re-render). */
  async paste(text: string): Promise<void> {
    await this.input.pasteBracketedText(text)
    await this.settle()
  }

  /** Resize the simulated terminal. */
  async resize(width: number, height: number): Promise<void> {
    this._resize(width, height)
    await this.settle()
  }

  /** Find the first occurrence of `needle` (string or regex) in the frame. */
  find(needle: string | RegExp): FindResult | null {
    const text = this._captureFrame()
    const lines = text.split("\n")
    if (typeof needle === "string") {
      for (let row = 0; row < lines.length; row++) {
        const col = lines[row]!.indexOf(needle)
        if (col >= 0) return { row, col, text: needle }
      }
      return null
    }
    const flags = needle.flags.includes("g") ? needle.flags : needle.flags + "g"
    const re = new RegExp(needle.source, flags)
    for (let row = 0; row < lines.length; row++) {
      re.lastIndex = 0
      const m = re.exec(lines[row]!)
      if (m) return { row, col: m.index, text: m[0] }
    }
    return null
  }

  /** Find all occurrences of `needle`. */
  findAll(needle: string | RegExp): FindResult[] {
    const text = this._captureFrame()
    const lines = text.split("\n")
    const out: FindResult[] = []
    if (typeof needle === "string") {
      for (let row = 0; row < lines.length; row++) {
        const line = lines[row]!
        let from = 0
        while (true) {
          const col = line.indexOf(needle, from)
          if (col < 0) break
          out.push({ row, col, text: needle })
          from = col + Math.max(1, needle.length)
        }
      }
      return out
    }
    const flags = needle.flags.includes("g") ? needle.flags : needle.flags + "g"
    const re = new RegExp(needle.source, flags)
    for (let row = 0; row < lines.length; row++) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(lines[row]!))) {
        out.push({ row, col: m.index, text: m[0] })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }
    return out
  }

  /** Wait until `predicate` is satisfied or `timeoutMs` elapses. */
  async waitFor(predicate: (h: TuiHarness) => boolean, timeoutMs = 2000, pollMs = 16): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      await this.settle()
      if (predicate(this)) return
      await new Promise((r) => setTimeout(r, pollMs))
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms\nlast frame:\n${frameToText(this.frame())}`)
  }

  /** Wait until `text` is visible on screen. */
  waitForText(text: string | RegExp, timeoutMs = 2000): Promise<void> {
    return this.waitFor((h) => h.find(text) !== null, timeoutMs)
  }

  /** Wait until `text` disappears from the screen. */
  waitForGone(text: string | RegExp, timeoutMs = 2000): Promise<void> {
    return this.waitFor((h) => h.find(text) === null, timeoutMs)
  }

  /** Tear down the renderer. Idempotent. */
  async unmount(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    try {
      this.renderer.destroy()
    } catch {
      // ignore destroy errors
    }
  }
}

/** Mount a Solid TUI component and return a harness that drives it. */
export async function mount(node: () => JSX.Element, opts: HarnessOptions = {}): Promise<TuiHarness> {
  const setup = await testRender(node, {
    width: opts.width ?? 100,
    height: opts.height ?? 30,
    kittyKeyboard: opts.kittyKeyboard ?? true,
    otherModifiersMode: opts.otherModifiersMode ?? false,
    exitOnCtrlC: false,
    targetFps: 60,
    gatherStats: false,
  })
  const h = new TuiHarness(setup)
  await h.settle()
  return h
}

/** Convenience: run a function with a harness, always tearing down afterwards. */
export async function withHarness<T>(
  node: () => JSX.Element,
  fn: (h: TuiHarness) => Promise<T>,
  opts: HarnessOptions = {},
): Promise<T> {
  const h = await mount(node, opts)
  try {
    return await fn(h)
  } finally {
    await h.unmount()
  }
}
