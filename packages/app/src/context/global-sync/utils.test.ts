import { describe, expect, test } from "bun:test"
import type { Agent, Project } from "@opencode-ai/sdk/v2/client"
import { normalizeAgentList, sanitizeProject } from "./utils"

const agent = (name = "build") =>
  ({
    name,
    mode: "primary",
    permission: {},
    options: {},
  }) as Agent

describe("normalizeAgentList", () => {
  test("keeps array payloads", () => {
    expect(normalizeAgentList([agent("build"), agent("docs")])).toEqual([agent("build"), agent("docs")])
  })

  test("wraps a single agent payload", () => {
    expect(normalizeAgentList(agent("docs"))).toEqual([agent("docs")])
  })

  test("extracts agents from keyed objects", () => {
    expect(
      normalizeAgentList({
        build: agent("build"),
        docs: agent("docs"),
      }),
    ).toEqual([agent("build"), agent("docs")])
  })

  test("drops invalid payloads", () => {
    expect(normalizeAgentList({ name: "AbortError" })).toEqual([])
    expect(normalizeAgentList([{ name: "build" }, agent("docs")])).toEqual([agent("docs")])
  })
})

describe("sanitizeProject", () => {
  test("drops discovered icon urls while preserving manual icon settings", () => {
    const project = {
      id: "project",
      worktree: "/tmp/project",
      icon: {
        url: "data:image/png;base64,discovered",
        override: "data:image/png;base64,manual",
        color: "pink",
      },
    } as Project

    expect(sanitizeProject(project).icon).toEqual({
      url: undefined,
      override: "data:image/png;base64,manual",
      color: "pink",
    })
    expect(sanitizeProject({ ...project, icon: { url: "data:image/png;base64,discovered" } }).icon).toBeUndefined()
  })
})
