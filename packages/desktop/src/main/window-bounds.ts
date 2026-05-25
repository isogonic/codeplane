export type DesktopWindowBounds = {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 480

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function dimension(value: unknown, fallback: number, minimum: number) {
  if (!finite(value)) return fallback
  return Math.max(minimum, Math.round(value))
}

export function normalizeWindowBoundsForRestore(saved?: Partial<DesktopWindowBounds> | null): DesktopWindowBounds {
  const width = dimension(saved?.width, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH)
  const height = dimension(saved?.height, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT)
  if (!finite(saved?.x) || !finite(saved?.y)) return { width, height, maximized: saved?.maximized }
  return { x: Math.round(saved.x), y: Math.round(saved.y), width, height, maximized: saved?.maximized }
}

export function hasWindowPosition(
  bounds: DesktopWindowBounds,
): bounds is DesktopWindowBounds & { x: number; y: number } {
  return finite(bounds.x) && finite(bounds.y)
}
