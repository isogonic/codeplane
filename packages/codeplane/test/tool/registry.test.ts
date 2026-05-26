import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))
const toolInput = {
  providerID: ProviderID.codeplane,
  modelID: ModelID.make("gpt-5"),
  agent: {
    name: "build",
    mode: "primary" as const,
    options: {},
    permission: Permission.fromConfig({ "*": "allow" }),
  },
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  it.live("includes the built-in list, project, tools, git, and forge tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("list")
        expect(ids).toContain("project")
        expect(ids).toContain("tools")
        expect(ids).toContain("git")
        expect(ids).toContain("forge")
      }),
    ),
  )

  it.live("does not expose retired rich block tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()

        for (const id of [
          "chart",
          "kpi",
          "callout",
          "timeline",
          "progress",
          "badge",
          "quote",
          "preview",
          "stock",
          "tabs",
          "choice",
          "select",
          "file-tree",
          "image-grid",
          "comparison",
          "video",
          "diff",
        ]) {
          expect(ids).not.toContain(id)
        }
      }),
    ),
  )

  it.live("keeps forge uncallable until Git host API credentials are configured", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service

        const availability = yield* registry.availability(toolInput)
        expect(availability.known).toContain("forge")
        expect(availability.available).not.toContain("forge")
        expect(availability.blocked.find((item) => item.id === "forge")?.reason).toContain("No Git host config")
        expect((yield* registry.tools(toolInput)).map((tool) => tool.id)).not.toContain("forge")
      }),
    ),
  )

  it.live("makes forge callable as soon as configured credentials exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const previous = process.env.CODEPLANE_TEST_FORGE_TOKEN
          process.env.CODEPLANE_TEST_FORGE_TOKEN = "token"
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (previous === undefined) delete process.env.CODEPLANE_TEST_FORGE_TOKEN
              else process.env.CODEPLANE_TEST_FORGE_TOKEN = previous
            }),
          )

          const registry = yield* ToolRegistry.Service

          const availability = yield* registry.availability(toolInput)
          expect(availability.available).toContain("forge")
          expect(availability.blocked.find((item) => item.id === "forge")).toBeUndefined()
          expect((yield* registry.tools(toolInput)).map((tool) => tool.id)).toContain("forge")
        }),
      {
        config: {
          git: {
            github: {
              url: "https://github.com",
              provider: "github",
              hosts: ["github.com"],
              credential: { type: "env", env: "CODEPLANE_TEST_FORGE_TOKEN" },
            },
          },
        },
      },
    ),
  )

  it.live("does not fail tool availability when model metadata is unavailable", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const availability = yield* registry.availability({
          ...toolInput,
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
        })

        expect(availability.known).toContain("task")
      }),
    ),
  )

  it.live("loads tools from .codeplane/tool (singular)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const codeplane = path.join(dir, ".codeplane")
        const tool = path.join(codeplane, "tool")
        yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tool, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools from .codeplane/tools (plural)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const codeplane = path.join(dir, ".codeplane")
        const tools = path.join(codeplane, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools with external dependencies without crashing", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const codeplane = path.join(dir, ".codeplane")
        const tools = path.join(codeplane, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(codeplane, "package.json"),
            JSON.stringify({
              name: "custom-tools",
              dependencies: {
                "@codeplane-ai/plugin": "^0.0.0",
                cowsay: "^1.6.0",
              },
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(codeplane, "package-lock.json"),
            JSON.stringify({
              name: "custom-tools",
              lockfileVersion: 3,
              packages: {
                "": {
                  dependencies: {
                    "@codeplane-ai/plugin": "^0.0.0",
                    cowsay: "^1.6.0",
                  },
                },
              },
            }),
          ),
        )

        const cowsay = path.join(codeplane, "node_modules", "cowsay")
        yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "package.json"),
            JSON.stringify({
              name: "cowsay",
              type: "module",
              exports: "./index.js",
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "index.js"),
            ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "cowsay.ts"),
            [
              "import { say } from 'cowsay'",
              "export default {",
              "  description: 'tool that imports cowsay at top level',",
              "  args: { text: { type: 'string' } },",
              "  execute: async ({ text }: { text: string }) => {",
              "    return say({ text })",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("cowsay")
      }),
    ),
  )

  it.live("keeps desktop tools visible for desktop-managed local servers", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const previousClient = process.env.CODEPLANE_CLIENT
          const previousDesktopManaged = process.env.CODEPLANE_DESKTOP_MANAGED
          try {
            process.env.CODEPLANE_CLIENT = "cli"
            process.env.CODEPLANE_DESKTOP_MANAGED = "1"

            const registry = yield* ToolRegistry.Service
            const availability = yield* registry.availability(toolInput)
            const computerBlock = availability.blocked.find((item) => item.id === "computer")
            const browserBlock = availability.blocked.find((item) => item.id === "browser")

            expect(availability.known).toContain("computer")
            expect(availability.known).toContain("browser")
            expect(availability.available).toContain("computer")
            expect(availability.available).toContain("browser")
            expect(computerBlock?.reason ?? "").not.toContain("only available in the desktop app")
            expect(browserBlock?.reason ?? "").not.toContain("only available in the desktop app")
            expect(computerBlock?.reason ?? "").not.toContain("vision")
            expect(browserBlock?.reason ?? "").not.toContain("vision")
          } finally {
            if (previousClient === undefined) delete process.env.CODEPLANE_CLIENT
            else process.env.CODEPLANE_CLIENT = previousClient
            if (previousDesktopManaged === undefined) delete process.env.CODEPLANE_DESKTOP_MANAGED
            else process.env.CODEPLANE_DESKTOP_MANAGED = previousDesktopManaged
          }
        }),
      { config: { tools: { browser: true, computer: true } } },
    ),
  )
})
