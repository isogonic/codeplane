import { describe, expect, test } from "bun:test"
import type { Todo } from "@codeplane-ai/sdk/v2"
import { isHighPriority, todoProgress, todoStatus } from "./todo-progress"

const t = (status: string, priority = "medium"): Todo => ({ content: "x", status, priority }) as Todo

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
    expect(p).toMatchObject({ done: 1, total: 3, allResolved: false })
  })

  test("excludes cancelled from the denominator (reaches 100%)", () => {
    // 2 completed + 2 cancelled => nothing left to do => 2 of 2
    const p = todoProgress([t("completed"), t("completed"), t("cancelled"), t("cancelled")])
    expect(p.done).toBe(2)
    expect(p.total).toBe(2)
    expect(p.allResolved).toBe(true)
  })

  test("a single cancelled-only list is fully resolved with no work", () => {
    const p = todoProgress([t("cancelled")])
    expect(p).toMatchObject({ done: 0, total: 0, allResolved: true })
  })

  test("empty list is not resolved", () => {
    expect(todoProgress([]).allResolved).toBe(false)
  })

  test("tolerant of non-canonical statuses", () => {
    const p = todoProgress([t("DONE"), t("Cancelled")])
    expect(p).toMatchObject({ done: 1, total: 1, allResolved: true })
  })
})

describe("isHighPriority", () => {
  test("matches high and synonyms, case-insensitive", () => {
    expect(isHighPriority(t("x", "high"))).toBe(true)
    expect(isHighPriority(t("x", "High"))).toBe(true)
    expect(isHighPriority(t("x", "urgent"))).toBe(true)
    expect(isHighPriority(t("x", "medium"))).toBe(false)
    expect(isHighPriority(t("x", "low"))).toBe(false)
  })
})
