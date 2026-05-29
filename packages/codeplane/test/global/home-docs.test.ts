import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ConfigAgent } from "../../src/config/agent"
import { ConfigCommand } from "../../src/config/command"
import { HomeDocs } from "../../src/global/home-docs"
import { tmpdir } from "../fixture/fixture"

function makePaths(rootBase: string) {
  const globalRoot = path.join(rootBase, "home")
  const root = path.join(globalRoot, "instances", "alpha")
  return {
    root,
    globalRoot,
    config: root,
    data: path.join(root, "data"),
    secrets: path.join(root, "data", "secrets"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    log: path.join(root, "log"),
    bin: path.join(root, "bin"),
    plugins: path.join(root, "plugins"),
    agents: path.join(root, "agents"),
    commands: path.join(root, "commands"),
    skills: path.join(root, "skills"),
    local_server: path.join(globalRoot, "local_server"),
    local_server_binaries: path.join(globalRoot, "local_server", "binaries"),
    instances: path.join(globalRoot, "instances.json"),
  }
}

function makeSingleRootPaths(rootBase: string) {
  const root = path.join(rootBase, "single-root")
  return {
    root,
    globalRoot: root,
    config: root,
    data: path.join(root, "data"),
    secrets: path.join(root, "data", "secrets"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    log: path.join(root, "log"),
    bin: path.join(root, "bin"),
    plugins: path.join(root, "plugins"),
    agents: path.join(root, "agents"),
    commands: path.join(root, "commands"),
    skills: path.join(root, "skills"),
    local_server: path.join(root, "local_server"),
    local_server_binaries: path.join(root, "local_server", "binaries"),
    instances: path.join(root, "instances.json"),
  }
}

function makeManagedLocalPaths(rootBase: string) {
  const globalRoot = path.join(rootBase, "home")
  const localRoot = path.join(globalRoot, "local_server", "managed-instance")
  const root = path.join(localRoot, "config")
  return {
    root,
    globalRoot,
    config: root,
    data: path.join(localRoot, "data"),
    secrets: path.join(localRoot, "data", "secrets"),
    cache: path.join(localRoot, "cache"),
    state: path.join(localRoot, "state"),
    log: path.join(localRoot, "log"),
    bin: path.join(localRoot, "bin"),
    plugins: path.join(root, "plugins"),
    agents: path.join(root, "agents"),
    commands: path.join(root, "commands"),
    skills: path.join(root, "skills"),
    local_server: path.join(globalRoot, "local_server"),
    local_server_binaries: path.join(globalRoot, "local_server", "binaries"),
    instances: path.join(globalRoot, "instances.json"),
  }
}

async function expectFilesExist(files: string[]) {
  for (const file of files) {
    expect(await fs.stat(file)).toBeDefined()
  }
}

function count(text: string, value: string) {
  return text.split(value).length - 1
}

describe("home docs", () => {
  test("creates the full managed docs tree for split instance and shared roots", async () => {
    await using tmp = await tmpdir()
    const paths = makePaths(tmp.path)

    await HomeDocs.ensure(paths)

    await expectFilesExist([
      path.join(paths.root, "AGENTS.md"),
      path.join(paths.root, "README.md"),
      path.join(paths.root, "docs", "AGENTS.md"),
      path.join(paths.root, "docs", "README.md"),
      path.join(paths.root, "docs", "instance-architecture.md"),
      path.join(paths.root, "docs", "configuration.md"),
      path.join(paths.root, "docs", "providers.md"),
      path.join(paths.root, "docs", "mcp.md"),
      path.join(paths.root, "docs", "lsp.md"),
      path.join(paths.root, "docs", "storage.md"),
      path.join(paths.data, "AGENTS.md"),
      path.join(paths.data, "README.md"),
      path.join(paths.cache, "AGENTS.md"),
      path.join(paths.cache, "README.md"),
      path.join(paths.state, "AGENTS.md"),
      path.join(paths.state, "README.md"),
      path.join(paths.log, "AGENTS.md"),
      path.join(paths.log, "README.md"),
      path.join(paths.bin, "AGENTS.md"),
      path.join(paths.bin, "README.md"),
      path.join(paths.plugins, "AGENTS.md"),
      path.join(paths.plugins, "README.md"),
      path.join(paths.agents, "AGENTS.md"),
      path.join(paths.agents, "README.md"),
      path.join(paths.commands, "AGENTS.md"),
      path.join(paths.commands, "README.md"),
      path.join(paths.skills, "AGENTS.md"),
      path.join(paths.skills, "README.md"),
      path.join(paths.globalRoot, "AGENTS.md"),
      path.join(paths.globalRoot, "README.md"),
      path.join(paths.globalRoot, "docs", "shared-runtime.md"),
      path.join(paths.local_server, "AGENTS.md"),
      path.join(paths.local_server, "README.md"),
      path.join(paths.local_server_binaries, "AGENTS.md"),
      path.join(paths.local_server_binaries, "README.md"),
    ])

    const rootAgents = await fs.readFile(path.join(paths.root, "AGENTS.md"), "utf8")
    const rootReadme = await fs.readFile(path.join(paths.root, "README.md"), "utf8")
    const architectureGuide = await fs.readFile(path.join(paths.root, "docs", "instance-architecture.md"), "utf8")
    const configGuide = await fs.readFile(path.join(paths.root, "docs", "configuration.md"), "utf8")
    const dataAgents = await fs.readFile(path.join(paths.data, "AGENTS.md"), "utf8")
    const globalAgents = await fs.readFile(path.join(paths.globalRoot, "AGENTS.md"), "utf8")
    const sharedAgents = await fs.readFile(path.join(paths.local_server, "AGENTS.md"), "utf8")

    expect(rootAgents).toContain("authoritative instance config root")
    expect(rootAgents).toContain("codeplane.jsonc")
    expect(rootReadme).toContain("Codeplane Instance Home")
    expect(architectureGuide).toContain("saved-instance registry")
    expect(architectureGuide).toContain("desktop/TUI managed local-instance runtime data")
    expect(configGuide).toContain('"mcp"')
    expect(configGuide).toContain("{secret:anthropic-api-key}")
    expect(configGuide).toContain("{secret:name}")
    expect(dataAgents).toContain("codeplane.db")
    expect(rootAgents).toContain("secrets.jsonc")
    expect(globalAgents).toContain("shared across instances on the same machine")
    expect(sharedAgents).toContain("shared across instances")
    expect(await ConfigAgent.load(paths.root)).toEqual({})
    expect(await ConfigCommand.load(paths.root)).toEqual({})
  })

  test("refreshes managed content while preserving local notes", async () => {
    await using tmp = await tmpdir()
    const paths = makePaths(tmp.path)
    const agentsFile = path.join(paths.root, "AGENTS.md")

    await fs.mkdir(path.dirname(agentsFile), { recursive: true })
    await fs.writeFile(
      agentsFile,
      [
        "<!-- CODEPLANE_MANAGED_DOCS:BEGIN -->",
        "old content",
        "<!-- CODEPLANE_MANAGED_DOCS:END -->",
        "",
        "## Local Notes",
        "",
        "keep this line",
        "",
      ].join("\n"),
    )

    await HomeDocs.ensure(paths)

    const text = await fs.readFile(agentsFile, "utf8")
    expect(text).not.toContain("old content")
    expect(text).toContain("authoritative instance config root")
    expect(text).toContain("keep this line")
  })

  test("appends a managed block to existing user-authored files", async () => {
    await using tmp = await tmpdir()
    const paths = makePaths(tmp.path)
    const agentsFile = path.join(paths.plugins, "AGENTS.md")

    await fs.mkdir(path.dirname(agentsFile), { recursive: true })
    await fs.writeFile(agentsFile, "# Custom Plugin Notes\n\nKeep this preface.\n")

    await HomeDocs.ensure(paths)

    const text = await fs.readFile(agentsFile, "utf8")
    expect(text.startsWith("# Custom Plugin Notes")).toBe(true)
    expect(text).toContain("CODEPLANE_MANAGED_DOCS:BEGIN")
    expect(text).toContain("auto-discovers")
  })

  test("is idempotent and does not duplicate managed blocks on rerun", async () => {
    await using tmp = await tmpdir()
    const paths = makePaths(tmp.path)

    await HomeDocs.ensure(paths)
    const firstRoot = await fs.readFile(path.join(paths.root, "AGENTS.md"), "utf8")
    const firstPlugin = await fs.readFile(path.join(paths.plugins, "AGENTS.md"), "utf8")

    await HomeDocs.ensure(paths)
    const secondRoot = await fs.readFile(path.join(paths.root, "AGENTS.md"), "utf8")
    const secondPlugin = await fs.readFile(path.join(paths.plugins, "AGENTS.md"), "utf8")

    expect(secondRoot).toBe(firstRoot)
    expect(secondPlugin).toBe(firstPlugin)
    expect(count(secondRoot, "CODEPLANE_MANAGED_DOCS:BEGIN")).toBe(1)
    expect(count(secondRoot, "CODEPLANE_MANAGED_DOCS:END")).toBe(1)
    expect(count(secondPlugin, "CODEPLANE_MANAGED_DOCS:BEGIN")).toBe(1)
    expect(count(secondPlugin, "CODEPLANE_MANAGED_DOCS:END")).toBe(1)
  })

  test("supports installs where the instance root and shared root are the same directory", async () => {
    await using tmp = await tmpdir()
    const paths = makeSingleRootPaths(tmp.path)

    await HomeDocs.ensure(paths)

    await expectFilesExist([
      path.join(paths.root, "AGENTS.md"),
      path.join(paths.root, "README.md"),
      path.join(paths.root, "docs", "shared-runtime.md"),
      path.join(paths.local_server, "AGENTS.md"),
      path.join(paths.local_server_binaries, "AGENTS.md"),
    ])

    const rootAgents = await fs.readFile(path.join(paths.root, "AGENTS.md"), "utf8")
    expect(rootAgents).toContain("host-level shared runtime files")
    expect(count(rootAgents, "CODEPLANE_MANAGED_DOCS:BEGIN")).toBe(1)
  })

  test("supports managed local-server instance layouts with sibling runtime directories", async () => {
    await using tmp = await tmpdir()
    const paths = makeManagedLocalPaths(tmp.path)

    await HomeDocs.ensure(paths)

    await expectFilesExist([
      path.join(paths.root, "AGENTS.md"),
      path.join(paths.root, "docs", "storage.md"),
      path.join(paths.data, "AGENTS.md"),
      path.join(paths.cache, "AGENTS.md"),
      path.join(paths.state, "AGENTS.md"),
      path.join(paths.log, "AGENTS.md"),
      path.join(paths.bin, "AGENTS.md"),
    ])

    const rootAgents = await fs.readFile(path.join(paths.root, "AGENTS.md"), "utf8")
    const storageGuide = await fs.readFile(path.join(paths.root, "docs", "storage.md"), "utf8")
    expect(rootAgents).toContain("authoritative instance config root")
    expect(rootAgents).toContain("secrets.jsonc")
    expect(rootAgents).toContain("shared host-level resources")
    expect(storageGuide).toContain("auth.json")
    expect(storageGuide).toContain("process.log")
  })

  test("ignores generated docs while still loading real agent, mode, and command definitions", async () => {
    await using tmp = await tmpdir()
    const paths = makePaths(tmp.path)

    await HomeDocs.ensure(paths)
    await fs.mkdir(path.join(paths.root, "modes"), { recursive: true })

    await fs.writeFile(
      path.join(paths.agents, "release.md"),
      ["---", "description: Release helper", "model: test/model", "---", "", "Ship carefully."].join("\n"),
    )
    await fs.writeFile(path.join(paths.agents, "README.md"), "# user readme\n")
    await fs.writeFile(path.join(paths.agents, "AGENTS.md"), "# local instructions\n")

    await fs.writeFile(
      path.join(paths.commands, "ship.md"),
      ["---", "description: Ship command", "---", "", "Run the release."].join("\n"),
    )
    await fs.writeFile(path.join(paths.commands, "README.md"), "# command notes\n")
    await fs.writeFile(path.join(paths.commands, "AGENTS.md"), "# command instructions\n")

    await fs.writeFile(
      path.join(paths.root, "modes", "plan.md"),
      ["---", "description: Planning mode", "---", "", "Plan before editing."].join("\n"),
    )
    await fs.writeFile(path.join(paths.root, "modes", "README.md"), "# mode notes\n")

    const agents = await ConfigAgent.load(paths.root)
    const modes = await ConfigAgent.loadMode(paths.root)
    const commands = await ConfigCommand.load(paths.root)

    expect(Object.keys(agents)).toEqual(["release"])
    expect(agents["release"]).toEqual(
      expect.objectContaining({
        name: "release",
        description: "Release helper",
        model: "test/model",
        prompt: "Ship carefully.",
      }),
    )
    expect(Object.keys(modes)).toEqual(["plan"])
    expect(modes["plan"]).toEqual(
      expect.objectContaining({
        name: "plan",
        description: "Planning mode",
        prompt: "Plan before editing.",
        mode: "primary",
      }),
    )
    expect(Object.keys(commands)).toEqual(["ship"])
    expect(commands["ship"]).toEqual({
      description: "Ship command",
      template: "Run the release.",
    })
  })
})
