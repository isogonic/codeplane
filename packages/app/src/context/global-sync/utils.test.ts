import { describe, expect, test } from "bun:test"
import type { Agent, Project } from "@codeplane-ai/sdk/v2/client"
import { directoryContains, normalizeAgentList, projectForDirectory, sanitizeProject } from "./utils"

const agent = (name = "build") =>
  ({
    name,
    mode: "primary",
    permission: {},
    options: {},
  }) as Agent

const project = (input: Partial<Project> & Pick<Project, "id" | "worktree">) =>
  ({
    vcs: "git",
    name: input.id,
    time: { created: 1, updated: 1 },
    sandboxes: [],
    ...input,
  }) as Project

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

describe("directoryContains", () => {
  test("matches a workspace root and nested directories", () => {
    expect(directoryContains("/tmp/project", "/tmp/project")).toBe(true)
    expect(directoryContains("/tmp/project", "/tmp/project/packages/app")).toBe(true)
  })

  test("does not match sibling directories", () => {
    expect(directoryContains("/tmp/project", "/tmp/project-other")).toBe(false)
    expect(directoryContains("/tmp/project/packages", "/tmp/project")).toBe(false)
  })

  test("normalizes trailing slashes and windows separators", () => {
    expect(directoryContains("C:\\tmp\\project\\", "C:/tmp/project/src")).toBe(true)
    expect(directoryContains("C:/tmp/project", "C:/tmp/project-other/src")).toBe(false)
  })
})

describe("projectForDirectory", () => {
  test("matches real project roots and nested directories", () => {
    const root = project({ id: "root", worktree: "/tmp/project" })

    expect(projectForDirectory("/tmp/project/packages/app", [root])).toBe(root)
  })

  test("ignores the global fallback project", () => {
    expect(projectForDirectory("/Users/dev", [project({ id: "global", worktree: "/" })])).toBeUndefined()
  })

  test("prefers the deepest matching project", () => {
    const parent = project({ id: "parent", worktree: "/tmp/project" })
    const child = project({ id: "child", worktree: "/tmp/project/packages/app" })

    expect(projectForDirectory("/tmp/project/packages/app/src", [parent, child])).toBe(child)
  })

  test("matches sandboxes to their owning project", () => {
    const root = project({ id: "root", worktree: "/tmp/project", sandboxes: ["/tmp/project-worktree"] })

    expect(projectForDirectory("/tmp/project-worktree/src", [root])).toBe(root)
  })
})
