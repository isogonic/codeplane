export type DesktopNotificationPayload = {
  title: string
  description?: string
  href?: string
}

export type DesktopNotificationResult = {
  href?: string
  reason: "empty-title" | "failed" | "mock" | "show" | "throw" | "timeout" | "unsupported"
  shown: boolean
  title: string
}

type NotificationOptions<TIcon = unknown> = {
  body: string
  icon?: TIcon
  title: string
}

type NativeNotification = {
  on(event: "click" | "close", listener: () => void): void
  once(event: "failed", listener: (_event?: unknown, error?: unknown) => void): void
  once(event: "show", listener: () => void): void
  show(): void
}

type Timer = ReturnType<typeof setTimeout>

export type DesktopNotificationBridge<TIcon = unknown> = {
  create(options: NotificationOptions<TIcon>): NativeNotification
  icon?: () => TIcon | undefined
  isSupported(): boolean
  log?: (event: string, data?: unknown) => void
  routeClick?: (href?: string) => void | Promise<void>
  testMode?: boolean
  timeoutMs?: number
}

function errorText(error: unknown) {
  if (error === undefined) return undefined
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown notification error"
  }
}

export async function showDesktopNotification<TIcon = unknown>(
  payload: DesktopNotificationPayload,
  bridge: DesktopNotificationBridge<TIcon>,
): Promise<DesktopNotificationResult> {
  const title = payload.title.trim()
  const base = { href: payload.href, title }
  if (!title) return { ...base, reason: "empty-title", shown: false }

  if (bridge.testMode) {
    bridge.log?.("notifications.notify.mock", base)
    return { ...base, reason: "mock", shown: true }
  }

  const supported = bridge.isSupported()
  bridge.log?.("notifications.notify.request", {
    ...base,
    supported,
  })
  if (!supported) return { ...base, reason: "unsupported", shown: false }

  const notification = bridge.create({
    title,
    body: payload.description?.trim() || title,
    icon: bridge.icon?.(),
  })

  notification.on("click", () => {
    bridge.log?.("notifications.notify.click", base)
    void bridge.routeClick?.(payload.href)
  })
  notification.on("close", () => {
    bridge.log?.("notifications.notify.close", base)
  })

  return await new Promise<DesktopNotificationResult>((resolve) => {
    let timer: Timer | undefined
    let settled = false
    const settle = (shown: boolean, reason: DesktopNotificationResult["reason"], error?: unknown) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      bridge.log?.("notifications.notify.settle", {
        ...base,
        error: errorText(error),
        reason,
        shown,
      })
      resolve({ ...base, reason, shown })
    }

    notification.once("show", () => settle(true, "show"))
    notification.once("failed", (_event, error) => settle(false, "failed", error))
    try {
      notification.show()
    } catch (error) {
      bridge.log?.("notifications.notify.throw", {
        ...base,
        error: errorText(error),
      })
      settle(false, "throw", error)
      return
    }
    timer = setTimeout(() => settle(false, "timeout"), bridge.timeoutMs ?? 1500)
  })
}
