import { describe, expect, test } from "bun:test"
import {
  clearSessionPrefetch,
  clearSessionPrefetchDirectory,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "./session-prefetch"

describe("session prefetch", () => {
  test("stores and clears message metadata by directory", () => {
    clearSessionPrefetch("local", "/tmp/a", ["ses_1"])
    clearSessionPrefetch("local", "/tmp/b", ["ses_1"])

    setSessionPrefetch({
      scope: "local",
      directory: "/tmp/a",
      sessionID: "ses_1",
      limit: 200,
      cursor: "abc",
      complete: false,
      at: 123,
    })

    expect(getSessionPrefetch("local", "/tmp/a", "ses_1")).toEqual({
      limit: 200,
      cursor: "abc",
      complete: false,
      at: 123,
    })
    expect(getSessionPrefetch("local", "/tmp/b", "ses_1")).toBeUndefined()

    clearSessionPrefetch("local", "/tmp/a", ["ses_1"])

    expect(getSessionPrefetch("local", "/tmp/a", "ses_1")).toBeUndefined()
  })

  test("dedupes inflight work", async () => {
    clearSessionPrefetch("local", "/tmp/c", ["ses_2"])

    let calls = 0
    const run = () =>
      runSessionPrefetch({
        scope: "local",
        directory: "/tmp/c",
        sessionID: "ses_2",
        task: async () => {
          calls += 1
          return { limit: 100, cursor: "next", complete: true, at: 456 }
        },
      })

    const [a, b] = await Promise.all([run(), run()])

    expect(calls).toBe(1)
    expect(a).toEqual({ limit: 100, cursor: "next", complete: true, at: 456 })
    expect(b).toEqual({ limit: 100, cursor: "next", complete: true, at: 456 })
  })

  test("clears a whole directory", () => {
    setSessionPrefetch({
      scope: "local",
      directory: "/tmp/d",
      sessionID: "ses_1",
      limit: 10,
      cursor: "a",
      complete: true,
      at: 1,
    })
    setSessionPrefetch({
      scope: "local",
      directory: "/tmp/d",
      sessionID: "ses_2",
      limit: 20,
      cursor: "b",
      complete: false,
      at: 2,
    })
    setSessionPrefetch({
      scope: "local",
      directory: "/tmp/e",
      sessionID: "ses_1",
      limit: 30,
      cursor: "c",
      complete: true,
      at: 3,
    })

    clearSessionPrefetchDirectory("local", "/tmp/d")

    expect(getSessionPrefetch("local", "/tmp/d", "ses_1")).toBeUndefined()
    expect(getSessionPrefetch("local", "/tmp/d", "ses_2")).toBeUndefined()
    expect(getSessionPrefetch("local", "/tmp/e", "ses_1")).toEqual({
      limit: 30,
      cursor: "c",
      complete: true,
      at: 3,
    })
  })

  test("isolates same directory and session across server scopes", () => {
    clearSessionPrefetch("local", "/tmp/same", ["ses_1"])
    clearSessionPrefetch("remote", "/tmp/same", ["ses_1"])

    setSessionPrefetch({
      scope: "local",
      directory: "/tmp/same",
      sessionID: "ses_1",
      limit: 10,
      complete: false,
      at: 1,
    })
    setSessionPrefetch({
      scope: "remote",
      directory: "/tmp/same",
      sessionID: "ses_1",
      limit: 20,
      complete: true,
      at: 2,
    })

    expect(getSessionPrefetch("local", "/tmp/same", "ses_1")).toEqual({ limit: 10, complete: false, at: 1 })
    expect(getSessionPrefetch("remote", "/tmp/same", "ses_1")).toEqual({ limit: 20, complete: true, at: 2 })

    clearSessionPrefetch("local", "/tmp/same", ["ses_1"])

    expect(getSessionPrefetch("local", "/tmp/same", "ses_1")).toBeUndefined()
    expect(getSessionPrefetch("remote", "/tmp/same", "ses_1")).toEqual({ limit: 20, complete: true, at: 2 })
  })

  test("invalidates stale inflight work only for the matching server scope", async () => {
    clearSessionPrefetch("local", "/tmp/stale", ["ses_1"])
    clearSessionPrefetch("remote", "/tmp/stale", ["ses_1"])

    let resume = () => {}
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const pending = runSessionPrefetch({
      scope: "local",
      directory: "/tmp/stale",
      sessionID: "ses_1",
      task: async (rev) => {
        await gate
        if (!isSessionPrefetchCurrent("local", "/tmp/stale", "ses_1", rev)) return
        return { limit: 1, complete: true, at: 1 }
      },
    })

    setSessionPrefetch({
      scope: "remote",
      directory: "/tmp/stale",
      sessionID: "ses_1",
      limit: 2,
      complete: true,
      at: 2,
    })
    clearSessionPrefetch("local", "/tmp/stale", ["ses_1"])
    resume()

    expect(await pending).toBeUndefined()
    expect(getSessionPrefetch("remote", "/tmp/stale", "ses_1")).toEqual({ limit: 2, complete: true, at: 2 })
  })

  test("refreshes stale first-page prefetched history", () => {
    expect(
      shouldSkipSessionPrefetch({
        message: true,
        info: { limit: 200, cursor: "x", complete: false, at: 1 },
        chunk: 200,
        now: 1 + 15_001,
      }),
    ).toBe(false)
  })

  test("keeps deeper or complete history cached", () => {
    expect(
      shouldSkipSessionPrefetch({
        message: true,
        info: { limit: 400, cursor: "x", complete: false, at: 1 },
        chunk: 200,
        now: 1 + 15_001,
      }),
    ).toBe(true)

    expect(
      shouldSkipSessionPrefetch({
        message: true,
        info: { limit: 120, complete: true, at: 1 },
        chunk: 200,
        now: 1 + 15_001,
      }),
    ).toBe(true)
  })
})
