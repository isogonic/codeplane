import { describe, expect, test } from "bun:test"
import {
  showDesktopNotification,
  type DesktopNotificationBridge,
} from "../src/main/notification-bridge"

type Listener = (...args: unknown[]) => void

class FakeNotification {
  listeners = new Map<string, Listener[]>()
  options: { body: string; icon?: unknown; title: string }
  showImpl: () => void

  constructor(options: { body: string; icon?: unknown; title: string }, showImpl?: () => void) {
    this.options = options
    this.showImpl = showImpl ?? (() => this.emit("show"))
  }

  on(event: "click" | "close", listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  once(event: "failed" | "show", listener: Listener) {
    const wrapped: Listener = (...args) => {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((entry) => entry !== wrapped))
      listener(...args)
    }
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), wrapped])
  }

  show() {
    this.showImpl()
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function makeBridge(
  payload: Partial<DesktopNotificationBridge> & { notification?: FakeNotification } = {},
): DesktopNotificationBridge & { events: Array<{ event: string; data?: unknown }>; routes: Array<string | undefined> } {
  const events: Array<{ event: string; data?: unknown }> = []
  const routes: Array<string | undefined> = []
  return {
    create: (options) => payload.notification ?? new FakeNotification(options),
    icon: () => "icon",
    isSupported: () => true,
    log: (event, data) => events.push({ data, event }),
    routeClick: (href) => routes.push(href),
    timeoutMs: 10,
    ...payload,
    events,
    routes,
  }
}

describe("desktop notification bridge", () => {
  test("returns false for empty titles", async () => {
    const bridge = makeBridge()
    await expect(showDesktopNotification({ title: "  " }, bridge)).resolves.toMatchObject({
      reason: "empty-title",
      shown: false,
    })
  })

  test("uses the mock path for e2e without constructing a native notification", async () => {
    const bridge = makeBridge({
      create: () => {
        throw new Error("should not create notification")
      },
      testMode: true,
    })

    await expect(showDesktopNotification({ title: "Codeplane" }, bridge)).resolves.toMatchObject({
      reason: "mock",
      shown: true,
    })
    expect(bridge.events.some((entry) => entry.event === "notifications.notify.mock")).toBe(true)
  })

  test("returns false when native notifications are unsupported", async () => {
    const bridge = makeBridge({ isSupported: () => false })
    await expect(showDesktopNotification({ title: "Codeplane" }, bridge)).resolves.toMatchObject({
      reason: "unsupported",
      shown: false,
    })
  })

  test("resolves true only after the native show event", async () => {
    let notification: FakeNotification | undefined
    const bridge = makeBridge({
      create: (options) => {
        notification = new FakeNotification(options)
        return notification
      },
    })

    await expect(showDesktopNotification({ title: "Codeplane", href: "/session/1" }, bridge)).resolves.toMatchObject({
      reason: "show",
      shown: true,
    })
    expect(notification?.options.body).toBe("Codeplane")
    expect(bridge.events.some((entry) => entry.event === "notifications.notify.settle")).toBe(true)

    notification?.emit("click")
    expect(bridge.routes).toEqual(["/session/1"])
  })

  test("uses the description as the native body when provided", async () => {
    let body = ""
    const bridge = makeBridge({
      create: (options) => {
        body = options.body
        return new FakeNotification(options)
      },
    })

    await showDesktopNotification({ title: "Codeplane", description: "Done" }, bridge)
    expect(body).toBe("Done")
  })

  test("returns false on native failed events", async () => {
    const notification = new FakeNotification({ body: "Codeplane", title: "Codeplane" }, () =>
      notification.emit("failed", undefined, new Error("denied")),
    )
    const bridge = makeBridge({ notification })

    await expect(showDesktopNotification({ title: "Codeplane" }, bridge)).resolves.toMatchObject({
      reason: "failed",
      shown: false,
    })
  })

  test("returns false when native show throws", async () => {
    const bridge = makeBridge({
      create: (options) =>
        new FakeNotification(options, () => {
          throw new Error("boom")
        }),
    })

    await expect(showDesktopNotification({ title: "Codeplane" }, bridge)).resolves.toMatchObject({
      reason: "throw",
      shown: false,
    })
  })

  test("returns false when the native show event never arrives", async () => {
    const bridge = makeBridge({
      create: (options) => new FakeNotification(options, () => undefined),
      timeoutMs: 1,
    })

    await expect(showDesktopNotification({ title: "Codeplane" }, bridge)).resolves.toMatchObject({
      reason: "timeout",
      shown: false,
    })
  })
})
