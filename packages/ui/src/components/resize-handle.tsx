import { splitProps, type JSX } from "solid-js"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  collapseThreshold?: number
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onCollapse",
    "collapseThreshold",
    "class",
    "classList",
  ])

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const startSize = local.size
    let current = startSize
    // rAF-coalesce onResize: the user moves the mouse at ~120-1000 Hz on
    // modern trackpads, and `onResize` calls into persisted-store writes
    // that synchronously serialize + send IPC. Without coalescing the
    // sidebar/panel resize stalls the entire renderer thread, which on
    // the desktop shell is also driving the chrome — exactly the
    // "extremely buggy / laggy" feel users reported. Schedule the
    // newest value to the next frame so we do at most ~60 onResize
    // calls per second, regardless of how fast the OS sends mousemove.
    let pendingClamped: number | undefined
    let rafID: number | undefined
    const flush = () => {
      rafID = undefined
      if (pendingClamped === undefined) return
      const value = pendingClamped
      pendingClamped = undefined
      local.onResize(value)
    }

    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"

    const onMouseMove = (moveEvent: MouseEvent) => {
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : edge === "start"
            ? start - pos
            : pos - start
      current = startSize + delta
      pendingClamped = Math.min(local.max, Math.max(local.min, current))
      if (rafID === undefined) rafID = requestAnimationFrame(flush)
    }

    const onMouseUp = () => {
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      // Run any queued frame synchronously on release so the final
      // size is applied immediately (no stale frame between mouseup
      // and the next rAF).
      if (rafID !== undefined) {
        cancelAnimationFrame(rafID)
        rafID = undefined
      }
      flush()

      const threshold = local.collapseThreshold ?? 0
      if (local.onCollapse && threshold > 0 && current < threshold) {
        local.onCollapse()
      }
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onMouseDown={handleMouseDown}
    />
  )
}
