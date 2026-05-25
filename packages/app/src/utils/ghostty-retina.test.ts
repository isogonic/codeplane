import { describe, expect, test } from "bun:test"
import { patchGhosttyRetinaCanvas } from "@/utils/ghostty-retina"

const setDevicePixelRatio = (value: number) => {
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value,
  })
}

const createGhosttyModule = () => {
  const rendererDevicePixelRatios: number[] = []

  class CanvasRenderer {
    devicePixelRatio = 1

    resize() {
      rendererDevicePixelRatios.push(this.devicePixelRatio)
    }
  }

  class Terminal {
    cols = 80
    rows = 24
    viewportY = 3
    canvas = document.createElement("canvas")
    calls = {
      assertOpen: 0,
      cancelRenderLoop: 0,
      clearSelection: 0,
      flushWriteQueue: 0,
      render: 0,
      resizeEmitter: [] as Array<{ cols: number; rows: number }>,
      startRenderLoop: 0,
      wasmResize: [] as Array<{ cols: number; rows: number }>,
    }
    renderer = {
      resize: (cols: number, rows: number) => {
        this.canvas.width = cols * 20
        this.canvas.height = rows * 40
      },
      render: () => {
        this.calls.render += 1
      },
    }
    wasmTerm = {
      resize: (cols: number, rows: number) => {
        this.calls.wasmResize.push({ cols, rows })
      },
    }
    selectionManager = {
      clearSelection: () => {
        this.calls.clearSelection += 1
      },
    }
    resizeEmitter = {
      fire: (size: { cols: number; rows: number }) => {
        this.calls.resizeEmitter.push(size)
      },
    }

    assertOpen() {
      this.calls.assertOpen += 1
    }

    cancelRenderLoop() {
      this.calls.cancelRenderLoop += 1
    }

    flushWriteQueue() {
      this.calls.flushWriteQueue += 1
    }

    startRenderLoop() {
      this.calls.startRenderLoop += 1
    }

    handleFontChange() {
      this.renderer.resize(this.cols, this.rows)
      this.canvas.width = this.cols * 10
      this.canvas.height = this.rows * 20
      this.renderer.render()
    }

    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      this.wasmTerm.resize(cols, rows)
      this.renderer.resize(cols, rows)
      this.canvas.width = cols * 10
      this.canvas.height = rows * 20
      this.resizeEmitter.fire({ cols, rows })
      this.renderer.render()
    }
  }

  return {
    module: {
      CanvasRenderer,
      Terminal,
    },
    rendererDevicePixelRatios,
    Terminal,
    CanvasRenderer,
  }
}

describe("patchGhosttyRetinaCanvas", () => {
  test("refreshes renderer devicePixelRatio before resizing", () => {
    const testModule = createGhosttyModule()
    patchGhosttyRetinaCanvas(testModule.module)

    setDevicePixelRatio(2)
    const renderer = new testModule.CanvasRenderer()
    renderer.resize()

    expect(testModule.rendererDevicePixelRatios).toEqual([2])
  })

  test("keeps font-change canvas dimensions from renderer resize", () => {
    const testModule = createGhosttyModule()
    patchGhosttyRetinaCanvas(testModule.module)

    const terminal = new testModule.Terminal()
    terminal.handleFontChange()

    expect(terminal.canvas.width).toBe(1600)
    expect(terminal.canvas.height).toBe(960)
    expect(terminal.calls.clearSelection).toBe(1)
    expect(terminal.calls.render).toBe(1)
  })

  test("keeps terminal resize canvas dimensions from renderer resize", () => {
    const testModule = createGhosttyModule()
    patchGhosttyRetinaCanvas(testModule.module)

    const terminal = new testModule.Terminal()
    terminal.resize(100, 30)

    expect(terminal.cols).toBe(100)
    expect(terminal.rows).toBe(30)
    expect(terminal.canvas.width).toBe(2000)
    expect(terminal.canvas.height).toBe(1200)
    expect(terminal.calls.wasmResize).toEqual([{ cols: 100, rows: 30 }])
    expect(terminal.calls.resizeEmitter).toEqual([{ cols: 100, rows: 30 }])
    expect(terminal.calls.cancelRenderLoop).toBe(1)
    expect(terminal.calls.flushWriteQueue).toBe(1)
    expect(terminal.calls.startRenderLoop).toBe(1)
    expect(terminal.calls.render).toBe(1)
  })
})
