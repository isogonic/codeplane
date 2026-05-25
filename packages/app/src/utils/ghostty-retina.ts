const retinaPatch = Symbol.for("codeplane.ghostty.retina-canvas")

type PatchablePrototype = {
  [retinaPatch]?: true
}

type RendererPrototype = PatchablePrototype & {
  resize(this: RendererInstance, cols: number, rows: number): void
}

type RendererInstance = {
  devicePixelRatio?: number
}

type TerminalPrototype = PatchablePrototype & {
  resize(this: TerminalInstance, cols: number, rows: number): void
}

type TerminalInstance = {
  cols: number
  rows: number
  renderer?: {
    resize(cols: number, rows: number): void
    render(wasmTerm: unknown, full: boolean, viewportY: number, terminal: unknown): void
  }
  wasmTerm?: {
    resize(cols: number, rows: number): void
  }
  canvas?: HTMLCanvasElement
  selectionManager?: {
    clearSelection(): void
  }
  resizeEmitter?: {
    fire(size: { cols: number; rows: number }): void
  }
  viewportY: number
  assertOpen(): void
  cancelRenderLoop(): void
  flushWriteQueue(): void
  startRenderLoop(): void
}

type GhosttyModule = {
  CanvasRenderer: {
    prototype: RendererPrototype
  }
  Terminal: {
    prototype: TerminalPrototype
  }
}

const currentDevicePixelRatio = (fallback?: number) => {
  if (typeof window === "undefined") return fallback ?? 1
  return window.devicePixelRatio ?? fallback ?? 1
}

export const patchGhosttyRetinaCanvas = <T extends GhosttyModule>(mod: T) => {
  const rendererPrototype = mod.CanvasRenderer.prototype
  if (!rendererPrototype[retinaPatch]) {
    const originalResize = Reflect.get(rendererPrototype, "resize")
    rendererPrototype.resize = function resize(cols, rows) {
      this.devicePixelRatio = currentDevicePixelRatio(this.devicePixelRatio)
      return originalResize.call(this, cols, rows)
    }
    rendererPrototype[retinaPatch] = true
  }

  // ghostty-web's terminal methods overwrite the renderer's high-DPI canvas size.
  const terminalPrototype = mod.Terminal.prototype
  if (!terminalPrototype[retinaPatch]) {
    Object.defineProperty(terminalPrototype, "handleFontChange", {
      configurable: true,
      value: function handleFontChange(this: TerminalInstance) {
        if (!this.renderer || !this.wasmTerm || !this.canvas) return

        this.selectionManager?.clearSelection()
        this.renderer.resize(this.cols, this.rows)
        this.renderer.render(this.wasmTerm, true, this.viewportY, this)
      },
    })

    terminalPrototype.resize = function resize(cols, rows) {
      this.assertOpen()
      if (cols === this.cols && rows === this.rows) return

      this.cancelRenderLoop()
      try {
        this.cols = cols
        this.rows = rows
        this.wasmTerm?.resize(cols, rows)
        this.renderer?.resize(cols, rows)
        this.resizeEmitter?.fire({ cols, rows })
        if (this.renderer && this.wasmTerm) this.renderer.render(this.wasmTerm, true, this.viewportY, this)
      } catch (err) {
        console.error("Terminal resize failed:", err)
      }

      this.flushWriteQueue()
      this.startRenderLoop()
    }
    terminalPrototype[retinaPatch] = true
  }
  return mod
}
