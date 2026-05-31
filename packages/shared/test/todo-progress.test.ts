import { describe, expect, test } from "bun:test"
import {
  isCompleted,
  isInProgress,
  todoProgress,
  todoStatus,
} from "@codeplane-ai/shared/todo-progress"

const t = (status: string) => ({ content: "x", status } as { status: string })

describe("todoStatus", () => {
  test("passes through canonical values", () => {
    expect(todoStatus(t("in_progress"))).toBe("in_progress")
  })
  test("tolerates case / spacing / synonyms", () => {
    expect(todoStatus(t("Completed"))).toBe("completed")
    expect(todoStatus(t("In Progress"))).toBe("in_progress")
    expect(todoStatus(t("done"))).toBe("completed")
    expect(todoStatus(t("canceled"))).toBe("cancelled")
  })
  test("defaults unknown to pending", () => {
    expect(todoStatus(t("???"))).toBe("pending")
  })
})

describe("todoProgress", () => {
  test("counts completed over non-cancelled total", () => {
    const p = todoProgress([t("completed"), t("in_progress"), t("pending")])
    expect(p).toMatchObject({ done: 1, total: 3 })
  })

  test("excludes cancelled from the denominator (reaches 100%)", () => {
    const p = todoProgress([t("completed"), t("completed"), t("cancelled"), t("cancelled")])
    expect(p.done).toBe(2)
    expect(p.total).toBe(2)
  })

  test("a single cancelled-only list is fully resolved with no work", () => {
    const p = todoProgress([t("cancelled")])
    expect(p).toMatchObject({ done: 0, total: 0 })
  })
})

describe("isCompleted / isInProgress", () => {
  test("recognizes in-progress aliases", () => {
    expect(isInProgress(t("active"))).toBe(true)
    expect(isInProgress(t("working"))).toBe(true)
    expect(isInProgress(t("doing"))).toBe(true)
  })
  test("recognizes completed aliases", () => {
    expect(isCompleted(t("finished"))).toBe(true)
    expect(isCompleted(t("done"))).toBe(true)
  })
})
