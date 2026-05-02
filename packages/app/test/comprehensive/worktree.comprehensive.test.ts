import { describe, expect, test } from "bun:test"
import { Worktree } from "../../src/utils/worktree"

describe("Worktree state machine", () => {
  test("initial state is undefined", () => {
    expect(Worktree.get(`/test-init-${Math.random()}`)).toBeUndefined()
  })
  test("pending sets pending", () => {
    const dir = `/dir-pending-${Math.random()}`
    Worktree.pending(dir)
    expect(Worktree.get(dir)?.status).toBe("pending")
  })
  test("ready sets ready", () => {
    const dir = `/dir-ready-${Math.random()}`
    Worktree.pending(dir)
    Worktree.ready(dir)
    expect(Worktree.get(dir)?.status).toBe("ready")
  })
  test("failed sets failed with message", () => {
    const dir = `/dir-failed-${Math.random()}`
    Worktree.pending(dir)
    Worktree.failed(dir, "boom")
    const state = Worktree.get(dir)
    expect(state?.status).toBe("failed")
    if (state?.status === "failed") expect(state.message).toBe("boom")
  })
  test("pending no-op when already non-pending", () => {
    const dir = `/dir-no-op-${Math.random()}`
    Worktree.ready(dir)
    Worktree.pending(dir)
    expect(Worktree.get(dir)?.status).toBe("ready")
  })
  test("normalizes trailing slash", () => {
    const dir = `/dir-slash-${Math.random()}`
    Worktree.ready(dir)
    expect(Worktree.get(`${dir}/`)?.status).toBe("ready")
    expect(Worktree.get(`${dir}//`)?.status).toBe("ready")
  })
  test("scope keys are independent", () => {
    const dir = `/dir-scope-${Math.random()}`
    Worktree.ready(dir, "scope-a")
    Worktree.failed(dir, "boom", "scope-b")
    expect(Worktree.get(dir, "scope-a")?.status).toBe("ready")
    expect(Worktree.get(dir, "scope-b")?.status).toBe("failed")
  })
  test("wait resolves immediately for ready", async () => {
    const dir = `/dir-wait-ready-${Math.random()}`
    Worktree.ready(dir)
    const state = await Worktree.wait(dir)
    expect(state.status).toBe("ready")
  })
  test("wait resolves immediately for failed", async () => {
    const dir = `/dir-wait-failed-${Math.random()}`
    Worktree.failed(dir, "boom")
    const state = await Worktree.wait(dir)
    expect(state.status).toBe("failed")
  })
  test("wait pending then ready resolves", async () => {
    const dir = `/dir-wait-pending-${Math.random()}`
    Worktree.pending(dir)
    const promise = Worktree.wait(dir)
    Worktree.ready(dir)
    const state = await promise
    expect(state.status).toBe("ready")
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk pending->ready #${i}`, () => {
      const dir = `/dir-bulk-${i}-${Math.random()}`
      Worktree.pending(dir)
      Worktree.ready(dir)
      expect(Worktree.get(dir)?.status).toBe("ready")
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`bulk pending->failed #${i}`, () => {
      const dir = `/dir-bulk-fail-${i}-${Math.random()}`
      Worktree.pending(dir)
      Worktree.failed(dir, `error-${i}`)
      const s = Worktree.get(dir)
      if (s?.status === "failed") expect(s.message).toBe(`error-${i}`)
    })
  }
})
