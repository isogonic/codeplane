import { describe, expect, test } from "bun:test"
import { Todo } from "@/session/todo"

describe("Todo.normalizeStatus", () => {
  test("passes through canonical values", () => {
    for (const s of ["pending", "in_progress", "completed", "cancelled"] as const) {
      expect(Todo.normalizeStatus(s)).toBe(s)
    }
  })

  test("coerces case, whitespace and hyphens", () => {
    expect(Todo.normalizeStatus("Completed")).toBe("completed")
    expect(Todo.normalizeStatus(" In Progress ")).toBe("in_progress")
    expect(Todo.normalizeStatus("in-progress")).toBe("in_progress")
  })

  test("maps common synonyms", () => {
    expect(Todo.normalizeStatus("done")).toBe("completed")
    expect(Todo.normalizeStatus("finished")).toBe("completed")
    expect(Todo.normalizeStatus("working")).toBe("in_progress")
    expect(Todo.normalizeStatus("canceled")).toBe("cancelled")
    expect(Todo.normalizeStatus("skipped")).toBe("cancelled")
    expect(Todo.normalizeStatus("todo")).toBe("pending")
  })

  test("defaults unknown/empty to pending", () => {
    expect(Todo.normalizeStatus("")).toBe("pending")
    expect(Todo.normalizeStatus("banana")).toBe("pending")
    expect(Todo.normalizeStatus(undefined)).toBe("pending")
  })
})

describe("Todo.normalizePriority", () => {
  test("passes through canonical values", () => {
    for (const p of ["high", "medium", "low"] as const) {
      expect(Todo.normalizePriority(p)).toBe(p)
    }
  })

  test("coerces variants and synonyms", () => {
    expect(Todo.normalizePriority("High")).toBe("high")
    expect(Todo.normalizePriority("urgent")).toBe("high")
    expect(Todo.normalizePriority("normal")).toBe("medium")
    expect(Todo.normalizePriority("minor")).toBe("low")
  })

  test("defaults unknown/empty to medium", () => {
    expect(Todo.normalizePriority("")).toBe("medium")
    expect(Todo.normalizePriority("whatever")).toBe("medium")
    expect(Todo.normalizePriority(undefined)).toBe("medium")
  })
})

describe("Todo.normalize", () => {
  test("normalizes a whole todo and keeps content", () => {
    expect(Todo.normalize({ content: "Ship it", status: "DONE", priority: "URGENT" })).toEqual({
      content: "Ship it",
      status: "completed",
      priority: "high",
    })
  })
})
