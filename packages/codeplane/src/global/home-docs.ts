import fs from "fs/promises"
import path from "path"

type HomePaths = {
  root: string
  globalRoot: string
  config: string
  data: string
  secrets: string
  cache: string
  state: string
  log: string
  bin: string
  plugins: string
  agents: string
  commands: string
  skills: string
  local_server: string
  local_server_binaries: string
  instances: string
}

const BEGIN = "<!-- CODEPLANE_MANAGED_DOCS:BEGIN -->"
const END = "<!-- CODEPLANE_MANAGED_DOCS:END -->"

function rel(fromFile: string, toFile: string) {
  const value = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/")
  return value || "."
}

function mdLink(fromFile: string, toFile: string, label: string) {
  return `[${label}](${rel(fromFile, toFile)})`
}

async function readText(filepath: string) {
  return fs.readFile(filepath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
}

async function writeManagedMarkdown(filepath: string, content: string) {
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  const managed = `${BEGIN}\n${content.trim()}\n${END}\n`
  const existing = await readText(filepath)

  if (!existing) {
    await Bun.write(
      filepath,
      `${managed}\n## Local Notes\n\nAdd machine-specific notes outside the managed block. Codeplane updates only the managed section.\n`,
    )
    return
  }

  const start = existing.indexOf(BEGIN)
  const end = existing.indexOf(END)
  if (start >= 0 && end > start) {
    const after = existing.slice(end + END.length).replace(/^\n/, "")
    const next = `${existing.slice(0, start)}${managed}${after}`
    await Bun.write(filepath, next)
    return
  }

  const suffix = existing.endsWith("\n") ? "\n" : "\n\n"
  await Bun.write(filepath, `${existing}${suffix}${managed}`)
}

type Docs = ReturnType<typeof docPaths>

function docPaths(paths: HomePaths) {
  const instanceDocs = path.join(paths.root, "docs")
  const sharedDocs = path.join(paths.globalRoot, "docs")
  return {
    instanceDocs,
    sharedDocs,
    rootAgents: path.join(paths.root, "AGENTS.md"),
    rootReadme: path.join(paths.root, "README.md"),
    docsAgents: path.join(instanceDocs, "AGENTS.md"),
    docsReadme: path.join(instanceDocs, "README.md"),
    architecture: path.join(instanceDocs, "instance-architecture.md"),
    configuration: path.join(instanceDocs, "configuration.md"),
    providers: path.join(instanceDocs, "providers.md"),
    mcp: path.join(instanceDocs, "mcp.md"),
    lsp: path.join(instanceDocs, "lsp.md"),
    storage: path.join(instanceDocs, "storage.md"),
    sharedRuntime: path.join(sharedDocs, "shared-runtime.md"),
    sharedRootAgents: path.join(paths.globalRoot, "AGENTS.md"),
    sharedRootReadme: path.join(paths.globalRoot, "README.md"),
  }
}

function managedHeader(title: string) {
  return `# ${title}

This file is managed by Codeplane and is meant for coding agents. Keep any local notes outside the managed block so runtime updates do not overwrite them.
`
}

function rootAgents(paths: HomePaths, docs: Docs) {
  const shared = paths.globalRoot === paths.root ? "This directory also contains the host-level shared runtime files." : ""
  return `${managedHeader("Codeplane Instance Root")}

This directory is the authoritative instance config root. Edit instance-wide configuration here, not in \`cache/\`, \`state/\`, or \`log/\`.

${shared}

When changing instance behavior:

- Providers and model overrides: edit \`codeplane.jsonc\`. See ${mdLink(docs.rootAgents, docs.providers, "providers.md")}.
- MCP servers: edit \`codeplane.jsonc\` \`mcp\` entries. See ${mdLink(docs.rootAgents, docs.mcp, "mcp.md")}.
- LSP servers: edit \`codeplane.jsonc\` \`lsp\` entries. See ${mdLink(docs.rootAgents, docs.lsp, "lsp.md")}.
- Plugins: prefer \`plugins/\` or \`plugin\` config entries. See ${mdLink(docs.rootAgents, paths.plugins, "plugins/")} and ${mdLink(docs.rootAgents, docs.configuration, "configuration.md")}.
- Agents: add markdown files under \`agents/\`.
- Commands: add markdown files under \`commands/\`.
- Skills: add \`SKILL.md\` trees under \`skills/\` or reference external skill paths in config.

Secret handling:

- Prefer \`{secret:name}\`, then \`{env:VAR_NAME}\` or \`{file:relative/path}\`, over copying raw secrets into config examples or docs.
- Persist instance-scoped secrets in \`secrets.jsonc\` (a \`{ "name": "value" }\` map in this directory). Reference them from \`codeplane.jsonc\` with \`{secret:name}\` placeholders, not plaintext tokens.
- If the user explicitly wants a persisted local secret, store it only in \`secrets.jsonc\` or Codeplane-managed auth files under ${mdLink(docs.rootAgents, paths.data, "data/")}.
- Never copy secrets into \`cache/\`, \`state/\`, \`log/\`, or these markdown files.

Instance boundaries:

- Treat \`${paths.root}\` and its subdirectories as this instance's writable surface.
- Project-local overrides belong in a workspace \`.codeplane/\` directory, not here, when the change should affect only one repository.
- The only shared host-level resources are the saved-instance registry at \`${rel(docs.rootAgents, paths.instances)}\` and the local runtime cache at \`${rel(docs.rootAgents, paths.local_server)}\`. Do not put provider, MCP, LSP, or plugin user config there.
`
}

function rootReadme(paths: HomePaths, docs: Docs) {
  return `# Codeplane Instance Home

This directory is one Codeplane instance home. The config root is this directory itself.

Start here:

- ${mdLink(docs.rootReadme, docs.architecture, "Instance architecture")}
- ${mdLink(docs.rootReadme, docs.configuration, "Configuration reference")}
- ${mdLink(docs.rootReadme, docs.providers, "Provider secrets and provider config")}
- ${mdLink(docs.rootReadme, docs.mcp, "MCP server config")}
- ${mdLink(docs.rootReadme, docs.lsp, "LSP server config")}
- ${mdLink(docs.rootReadme, docs.storage, "Data, storage, and generated files")}

Top-level directories:

- \`data/\`: persisted runtime data such as auth, MCP OAuth state, storage, plans, and the main database.
- \`cache/\`: disposable caches.
- \`state/\`: UI and process state that can be recreated.
- \`log/\`: runtime logs.
- \`bin/\`: helper executables downloaded for this instance.
- \`plugins/\`, \`agents/\`, \`commands/\`, \`skills/\`: instance-scoped extension content.

Use \`codeplane.jsonc\` as the preferred writable config file. \`codeplane.json\` and \`config.json\` are accepted for compatibility, but new writes should go to \`codeplane.jsonc\`.

Store instance secrets in \`secrets.jsonc\` (a \`{ "name": "value" }\` map) and reference them from config with \`{secret:name}\`.

If you need to touch the shared host-level runtime cache or the saved-instance registry, read ${mdLink(docs.rootReadme, docs.sharedRuntime, "shared-runtime.md")} first.
`
}

function docsAgents(docs: Docs) {
  return `${managedHeader("Codeplane Instance Docs")}

These files document the on-disk instance architecture and the expected edit points for agents.

When behavior changes in the repo, update the generator at \`packages/codeplane/src/global/home-docs.ts\` rather than editing only one generated file by hand.

Read the specific guide that matches the task:

- ${mdLink(docs.docsAgents, docs.architecture, "instance-architecture.md")}
- ${mdLink(docs.docsAgents, docs.configuration, "configuration.md")}
- ${mdLink(docs.docsAgents, docs.providers, "providers.md")}
- ${mdLink(docs.docsAgents, docs.mcp, "mcp.md")}
- ${mdLink(docs.docsAgents, docs.lsp, "lsp.md")}
- ${mdLink(docs.docsAgents, docs.storage, "storage.md")}
`
}

function docsReadme(docs: Docs) {
  return `# Codeplane Instance Docs

This folder explains the instance filesystem layout and the supported ways to change configuration and extensions.

- ${mdLink(docs.docsReadme, docs.architecture, "Instance architecture")}
- ${mdLink(docs.docsReadme, docs.configuration, "Configuration reference")}
- ${mdLink(docs.docsReadme, docs.providers, "Providers")}
- ${mdLink(docs.docsReadme, docs.mcp, "MCP")}
- ${mdLink(docs.docsReadme, docs.lsp, "LSP")}
- ${mdLink(docs.docsReadme, docs.storage, "Storage")}
`
}

function architectureDoc(paths: HomePaths, docs: Docs) {
  const sharedRootNote =
    paths.globalRoot === paths.root
      ? "This install uses one root for both the instance config and the shared runtime cache."
      : `This instance root is separate from the shared host root at \`${path.relative(paths.root, paths.globalRoot) || "."}\`.`

  return `# Codeplane Instance Architecture

Codeplane resolves the current instance from the active home paths, and this directory is that instance root.

${sharedRootNote}

Authoritative instance-scoped locations:

- \`codeplane.jsonc\`, \`codeplane.json\`, \`config.json\`: instance-wide config files
- \`plugins/\`: auto-discovered plugin files
- \`agents/\`: markdown agent definitions
- \`commands/\`: markdown command templates
- \`skills/\`: skill folders containing \`SKILL.md\`
- \`data/\`, \`cache/\`, \`state/\`, \`log/\`, \`bin/\`: runtime subtrees for this instance

Project-local overrides:

- Codeplane also reads \`.codeplane/codeplane.jsonc\` or \`.codeplane/codeplane.json\` from the active workspace tree.
- Project \`.codeplane/\` content overrides this instance root only for that project.

Shared host-level exceptions:

- \`${path.relative(paths.root, paths.instances)}\` is the saved-instance registry.
- \`${path.relative(paths.root, paths.local_server)}\` stores downloaded local runtime binaries and desktop/TUI managed local-instance runtime data.

Those shared resources are not the place for provider config, MCP config, LSP config, agent prompts, or user plugin settings.

Nearby \`AGENTS.md\` files matter:

- The root \`AGENTS.md\` is loaded as system instructions for the instance.
- When an agent reads or edits a file inside a subtree like \`data/\` or \`plugins/\`, Codeplane also loads the nearest parent \`AGENTS.md\` for that subtree.
- Put directory-specific rules in the nearest directory, not only at the root.

See ${mdLink(docs.architecture, docs.configuration, "configuration.md")} for the writable config shapes and ${mdLink(docs.architecture, docs.storage, "storage.md")} for generated data.
`
}

function configurationDoc(docs: Docs) {
  return `# Codeplane Configuration Reference

Preferred writable config file: \`codeplane.jsonc\` in the instance root.

Compatible instance-root filenames:

- \`codeplane.jsonc\`
- \`codeplane.json\`
- \`config.json\`

Project-local override filenames:

- \`.codeplane/codeplane.jsonc\`
- \`.codeplane/codeplane.json\`

Use the instance root for machine- or user-level settings, and use a project \`.codeplane/\` directory when the change should follow one repository.

Example:

\`\`\`jsonc
{
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "{secret:anthropic-api-key}"
      }
    }
  },
  "mcp": {
    "github": {
      "type": "remote",
      "url": "https://example.invalid/mcp",
      "headers": {
        "Authorization": "{secret:github-authorization}"
      }
    }
  },
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    }
  },
  "plugin": [
    "file:./plugins/example.ts",
    ["@scope/example-plugin", { "enabled": true }]
  ],
  "skills": {
    "paths": ["./skills"]
  }
}
\`\`\`

Secret substitution rules:

- \`{secret:name}\` reads \`name\` from \`secrets.jsonc\` in the instance root for this instance.
- \`{env:VAR_NAME}\` reads an environment variable at load time.
- \`{file:relative/or/absolute/path}\` inlines file content into the config.

Define instance secrets in \`secrets.jsonc\` as a \`{ "name": "value" }\` map. Config should keep \`{secret:name}\` placeholders, and Codeplane resolves the real values only at runtime.

Do not hand-edit generated runtime files under \`data/\` when a real config field exists. Use the config file first, then let Codeplane regenerate runtime state.

For focused guides, read ${mdLink(docs.configuration, docs.providers, "providers.md")}, ${mdLink(docs.configuration, docs.mcp, "mcp.md")}, and ${mdLink(docs.configuration, docs.lsp, "lsp.md")}.
`
}

function providersDoc(docs: Docs) {
  return `# Provider Config And Secrets

Provider configuration lives in the instance root \`codeplane.jsonc\` under the \`provider\` key.

Use this for:

- API keys
- base URLs
- enterprise URLs
- provider-specific options
- custom models and model metadata

Preferred secret pattern:

\`\`\`jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{secret:openai-api-key}",
        "baseURL": "{env:OPENAI_BASE_URL}"
      }
    }
  }
}
\`\`\`

Persisted auth files:

- Provider OAuth and API auth managed by Codeplane is stored in \`data/auth.json\`.
- That file is generated state. Prefer Codeplane flows or instance config changes over hand-editing it.

Rules for agents:

- Never copy provider secrets into markdown, logs, cache, or screenshots.
- Prefer \`{secret:name}\` in \`codeplane.jsonc\` and store the actual value in \`secrets.jsonc\`. Use environment injection only when the user explicitly wants environment-managed secrets.
- Only touch \`data/auth.json\` directly when the user explicitly asks for repair or migration and no higher-level route exists.

For the surrounding config shape, see ${mdLink(docs.providers, docs.configuration, "configuration.md")}.
`
}

function mcpDoc(docs: Docs) {
  return `# MCP Server Config

MCP server definitions live in \`codeplane.jsonc\` under the \`mcp\` key.

Local server example:

\`\`\`jsonc
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true
    }
  }
}
\`\`\`

Remote server example:

\`\`\`jsonc
{
  "mcp": {
    "remote-example": {
      "type": "remote",
      "url": "https://example.invalid/mcp",
      "headers": {
        "Authorization": "{secret:mcp-authorization}"
      },
      "oauth": {
        "scope": "read write"
      }
    }
  }
}
\`\`\`

Managed auth state:

- Remote MCP OAuth state and tokens are stored in \`data/mcp-auth.json\`.
- Treat that file as generated auth state, not as the primary configuration surface.

Rules for agents:

- Add or remove MCP servers by editing \`codeplane.jsonc\`.
- Store local MCP credentials in \`secrets.jsonc\` and reference them with \`{secret:name}\`. Use \`{env:...}\` only when the user explicitly wants external environment management.
- Do not store MCP server definitions in \`local_server/\`; that directory is only for shared runtime binaries and managed local-instance runtime data.

For the broader config file rules, see ${mdLink(docs.mcp, docs.configuration, "configuration.md")}.
`
}

function lspDoc(docs: Docs) {
  return `# LSP Server Config

LSP configuration lives in \`codeplane.jsonc\` under the \`lsp\` key.

Example:

\`\`\`jsonc
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    },
    "rust-analyzer": {
      "command": ["rust-analyzer"],
      "extensions": [".rs"],
      "env": {
        "RUST_LOG": "error"
      }
    }
  }
}
\`\`\`

Rules:

- Built-in servers can omit \`extensions\`, but custom servers need them.
- Set \`disabled: true\` to turn one server off without removing the rest of the map.
- Keep instance-wide LSP changes in the instance root config. Use project \`.codeplane/\` config when the server or settings are repository-specific.

LSP runtime state is not the source of truth. Edit the config first and let Codeplane rebuild the in-memory server set for the instance.

See ${mdLink(docs.lsp, docs.configuration, "configuration.md")} for the wider config file behavior.
`
}

function storageDoc(paths: HomePaths, docs: Docs) {
  return `# Data, Storage, And Generated Files

The \`data/\` directory contains persisted runtime state for this instance.

Common files and directories created on demand:

- \`auth.json\`: provider auth state
- \`mcp-auth.json\`: remote MCP OAuth state
- \`codeplane.db\`: main SQLite database for this instance
- \`storage/\`: JSON storage used by migration and compatibility paths
- \`plans/\`: generated plan and task state
- \`snapshot/\`: file snapshot history
- \`tool-output/\`: truncated tool output spillover
- \`worktree/\`: worktree-related data

Other runtime directories:

- ${mdLink(docs.storage, paths.cache, "cache/")} is disposable and should not be treated as the source of truth.
- ${mdLink(docs.storage, paths.state, "state/")} contains recreatable runtime state.
- ${mdLink(docs.storage, paths.log, "log/")} contains logs, including desktop-managed \`process.log\`.
- ${mdLink(docs.storage, paths.bin, "bin/")} contains helper executables for this instance.

Rules for agents:

- Prefer Codeplane APIs and config files over hand-editing runtime data.
- Back up or export before direct data surgery.
- Never infer current auth or config solely from logs.
- Do not place user-authored config into \`data/\`; use the instance root config or project \`.codeplane/\` config.
`
}

function sharedRuntimeDoc(paths: HomePaths) {
  return `# Codeplane Shared Runtime

This host-level area is shared across Codeplane instances on the same machine.

Shared resources here:

- \`${path.basename(paths.instances)}\`: saved-instance registry
- \`${path.basename(paths.local_server)}/\`: downloaded local runtime binaries and managed local-instance runtime data

Do not use this area for:

- provider config
- MCP server definitions
- LSP server definitions
- instance-scoped plugins, agents, commands, or skills

If you need to change one instance, edit that instance's own root \`codeplane.jsonc\` and extension directories instead.
`
}

function sharedRootAgents(paths: HomePaths, docs: Docs) {
  return `${managedHeader("Codeplane Shared Host Root")}

This directory is shared across instances on the same machine. It is not the right place for per-instance provider, MCP, LSP, or plugin user configuration.

Use this root only for host-wide runtime plumbing:

- saved-instance registry: \`${path.basename(paths.instances)}\`
- local runtime cache and local-instance runtime data: ${mdLink(docs.sharedRootAgents, paths.local_server, path.basename(paths.local_server))}
- shared runtime guide: ${mdLink(docs.sharedRootAgents, docs.sharedRuntime, "shared-runtime.md")}
`
}

function sharedRootReadme(paths: HomePaths, docs: Docs) {
  return `# Codeplane Shared Host Root

This directory holds the saved-instance registry and the shared local runtime cache for this machine.

- \`${path.basename(paths.instances)}\`: saved instances
- ${mdLink(docs.sharedRootReadme, paths.local_server, `${path.basename(paths.local_server)}/`)}: local runtime binaries and managed local-instance runtime data
- ${mdLink(docs.sharedRootReadme, docs.sharedRuntime, "shared-runtime.md")}: rules for agents

Per-instance configuration does not belong here.
`
}

function dirAgents(title: string, body: string) {
  return `${managedHeader(title)}

${body.trim()}
`
}

function dirReadme(title: string, body: string) {
  return `# ${title}

${body.trim()}
`
}

export async function ensure(paths: HomePaths) {
  const docs = docPaths(paths)
  const files = new Map<string, string>([
    [docs.rootAgents, rootAgents(paths, docs)],
    [docs.rootReadme, rootReadme(paths, docs)],
    [docs.docsAgents, docsAgents(docs)],
    [docs.docsReadme, docsReadme(docs)],
    [docs.architecture, architectureDoc(paths, docs)],
    [docs.configuration, configurationDoc(docs)],
    [docs.providers, providersDoc(docs)],
    [docs.mcp, mcpDoc(docs)],
    [docs.lsp, lspDoc(docs)],
    [docs.storage, storageDoc(paths, docs)],
    [docs.sharedRuntime, sharedRuntimeDoc(paths)],
    [
      path.join(paths.data, "AGENTS.md"),
      dirAgents(
        "Codeplane Data Directory",
        `This directory contains persisted runtime data for this instance.

Use ${mdLink(path.join(paths.data, "AGENTS.md"), docs.storage, "storage.md")} for the authoritative map of files such as \`auth.json\`, \`mcp-auth.json\`, \`codeplane.db\`, and generated subdirectories.

Do not treat files here as the preferred configuration surface when a setting exists in the instance root \`codeplane.jsonc\`.`,
      ),
    ],
    [
      path.join(paths.data, "README.md"),
      dirReadme(
        "Codeplane Data Directory",
        `Persisted runtime state for this instance lives here. Read ${mdLink(path.join(paths.data, "README.md"), docs.storage, "storage.md")} before changing files by hand.`,
      ),
    ],
    [
      path.join(paths.cache, "AGENTS.md"),
      dirAgents(
        "Codeplane Cache Directory",
        "This directory is disposable cache state. It can be cleared for troubleshooting, but it is not the source of truth for instance configuration or auth.",
      ),
    ],
    [
      path.join(paths.cache, "README.md"),
      dirReadme("Codeplane Cache Directory", "Disposable cache data for this instance. Do not store user config or secrets here."),
    ],
    [
      path.join(paths.state, "AGENTS.md"),
      dirAgents(
        "Codeplane State Directory",
        "This directory holds recreatable runtime and UI state. Keep canonical config in the instance root instead of writing it here.",
      ),
    ],
    [
      path.join(paths.state, "README.md"),
      dirReadme("Codeplane State Directory", "Recreatable instance state. Safe to inspect, but not the authoritative config surface."),
    ],
    [
      path.join(paths.log, "AGENTS.md"),
      dirAgents(
        "Codeplane Log Directory",
        "This directory contains runtime logs. Logs are evidence, not the source of truth. Never place secrets or manual config here.",
      ),
    ],
    [
      path.join(paths.log, "README.md"),
      dirReadme("Codeplane Log Directory", "Runtime logs for this instance. Use for diagnostics only."),
    ],
    [
      path.join(paths.bin, "AGENTS.md"),
      dirAgents(
        "Codeplane Bin Directory",
        "This directory contains helper executables downloaded or generated for this instance. Avoid manual edits unless repairing a broken runtime artifact.",
      ),
    ],
    [
      path.join(paths.bin, "README.md"),
      dirReadme("Codeplane Bin Directory", "Helper executables for this instance."),
    ],
    [
      path.join(paths.plugins, "AGENTS.md"),
      dirAgents(
        "Codeplane Plugins Directory",
        `Drop instance-scoped plugin entry files here as \`.ts\` or \`.js\`. Codeplane auto-discovers \`plugin/*.ts|js\` and \`plugins/*.ts|js\`.

If a plugin should be declared explicitly, use the instance root \`codeplane.jsonc\` \`plugin\` array instead of inventing a new registry.`,
      ),
    ],
    [
      path.join(paths.plugins, "README.md"),
      dirReadme("Codeplane Plugins Directory", "Instance-scoped plugin entry files. Prefer this directory or the root `plugin` config array."),
    ],
    [
      path.join(paths.agents, "AGENTS.md"),
      dirAgents(
        "Codeplane Agents Directory",
        "Add one markdown file per agent here. Frontmatter carries metadata such as model, description, color, permissions, and steps. The markdown body is the prompt.",
      ),
    ],
    [
      path.join(paths.agents, "README.md"),
      dirReadme("Codeplane Agents Directory", "Markdown agent definitions for this instance."),
    ],
    [
      path.join(paths.commands, "AGENTS.md"),
      dirAgents(
        "Codeplane Commands Directory",
        "Add one markdown file per command template here. Frontmatter carries metadata such as description, default agent, model, and subtask behavior. The markdown body is the template text.",
      ),
    ],
    [
      path.join(paths.commands, "README.md"),
      dirReadme("Codeplane Commands Directory", "Markdown command templates for this instance."),
    ],
    [
      path.join(paths.skills, "AGENTS.md"),
      dirAgents(
        "Codeplane Skills Directory",
        "Each skill lives in its own directory and must contain `SKILL.md`. Add instance-scoped skills here when they should be available across projects for this instance.",
      ),
    ],
    [
      path.join(paths.skills, "README.md"),
      dirReadme("Codeplane Skills Directory", "Instance-scoped skill folders containing `SKILL.md`."),
    ],
    [
      path.join(paths.local_server, "AGENTS.md"),
      dirAgents(
        "Codeplane Shared Local Runtime",
        `This directory is shared across instances on the same machine. It stores downloaded local runtime binaries and managed local-instance runtime data.

Read ${mdLink(path.join(paths.local_server, "AGENTS.md"), docs.sharedRuntime, "shared-runtime.md")} before editing anything here.`,
      ),
    ],
    [
      path.join(paths.local_server, "README.md"),
      dirReadme(
        "Codeplane Shared Local Runtime",
        `Shared runtime cache and managed local-instance data. See ${mdLink(path.join(paths.local_server, "README.md"), docs.sharedRuntime, "shared-runtime.md")}.`,
      ),
    ],
    [
      path.join(paths.local_server_binaries, "AGENTS.md"),
      dirAgents(
        "Codeplane Shared Local Runtime Binaries",
        "Downloaded Codeplane binaries are stored here by version. Treat this as runtime cache, not as a place for user config.",
      ),
    ],
    [
      path.join(paths.local_server_binaries, "README.md"),
      dirReadme("Codeplane Shared Local Runtime Binaries", "Downloaded local runtime binaries by version."),
    ],
  ])

  if (paths.globalRoot !== paths.root) {
    files.set(docs.sharedRootAgents, sharedRootAgents(paths, docs))
    files.set(docs.sharedRootReadme, sharedRootReadme(paths, docs))
  }

  await Promise.all(Array.from(files, ([filepath, content]) => writeManagedMarkdown(filepath, content)))
}

export * as HomeDocs from "./home-docs"
