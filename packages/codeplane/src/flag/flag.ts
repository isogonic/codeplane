import { Config } from "effect"

// Exported so flag.test.ts can exercise the parsing semantics without
// reloading the entire Flag module (which forks Flag across consumers — see
// the comment in flag.test.ts).
export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export function number(key: string) {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const CODEPLANE_EXPERIMENTAL = truthy("CODEPLANE_EXPERIMENTAL")
const CODEPLANE_DISABLE_CLAUDE_CODE = truthy("CODEPLANE_DISABLE_CLAUDE_CODE")
const CODEPLANE_DISABLE_CLAUDE_CODE_SKILLS =
  CODEPLANE_DISABLE_CLAUDE_CODE || truthy("CODEPLANE_DISABLE_CLAUDE_CODE_SKILLS")
const copy = process.env["CODEPLANE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  CODEPLANE_AUTO_SHARE: truthy("CODEPLANE_AUTO_SHARE"),
  CODEPLANE_AUTO_HEAP_SNAPSHOT: truthy("CODEPLANE_AUTO_HEAP_SNAPSHOT"),
  CODEPLANE_GIT_BASH_PATH: process.env["CODEPLANE_GIT_BASH_PATH"],
  CODEPLANE_CONFIG: process.env["CODEPLANE_CONFIG"],
  CODEPLANE_CONFIG_CONTENT: process.env["CODEPLANE_CONFIG_CONTENT"],
  CODEPLANE_DISABLE_AUTOUPDATE: truthy("CODEPLANE_DISABLE_AUTOUPDATE"),
  CODEPLANE_ALWAYS_NOTIFY_UPDATE: truthy("CODEPLANE_ALWAYS_NOTIFY_UPDATE"),
  CODEPLANE_DISABLE_PRUNE: truthy("CODEPLANE_DISABLE_PRUNE"),
  CODEPLANE_DISABLE_TERMINAL_TITLE: truthy("CODEPLANE_DISABLE_TERMINAL_TITLE"),
  CODEPLANE_SHOW_TTFD: truthy("CODEPLANE_SHOW_TTFD"),
  CODEPLANE_PERMISSION: process.env["CODEPLANE_PERMISSION"],
  CODEPLANE_DISABLE_DEFAULT_PLUGINS: truthy("CODEPLANE_DISABLE_DEFAULT_PLUGINS"),
  CODEPLANE_DISABLE_LSP_DOWNLOAD: truthy("CODEPLANE_DISABLE_LSP_DOWNLOAD"),
  CODEPLANE_ENABLE_EXPERIMENTAL_MODELS: truthy("CODEPLANE_ENABLE_EXPERIMENTAL_MODELS"),
  CODEPLANE_DISABLE_AUTOCOMPACT: truthy("CODEPLANE_DISABLE_AUTOCOMPACT"),
  CODEPLANE_DISABLE_MODELS_FETCH: truthy("CODEPLANE_DISABLE_MODELS_FETCH"),
  CODEPLANE_DISABLE_MOUSE: truthy("CODEPLANE_DISABLE_MOUSE"),
  CODEPLANE_DISABLE_CLAUDE_CODE,
  CODEPLANE_DISABLE_CLAUDE_CODE_PROMPT: CODEPLANE_DISABLE_CLAUDE_CODE || truthy("CODEPLANE_DISABLE_CLAUDE_CODE_PROMPT"),
  CODEPLANE_DISABLE_CLAUDE_CODE_SKILLS,
  CODEPLANE_DISABLE_EXTERNAL_SKILLS: CODEPLANE_DISABLE_CLAUDE_CODE_SKILLS || truthy("CODEPLANE_DISABLE_EXTERNAL_SKILLS"),
  CODEPLANE_FAKE_VCS: process.env["CODEPLANE_FAKE_VCS"],
  CODEPLANE_SERVER_PASSWORD: process.env["CODEPLANE_SERVER_PASSWORD"],
  CODEPLANE_SERVER_USERNAME: process.env["CODEPLANE_SERVER_USERNAME"],
  CODEPLANE_ENABLE_QUESTION_TOOL: truthy("CODEPLANE_ENABLE_QUESTION_TOOL"),

  // Experimental
  CODEPLANE_EXPERIMENTAL,
  CODEPLANE_EXPERIMENTAL_FILEWATCHER: Config.boolean("CODEPLANE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CODEPLANE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("CODEPLANE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CODEPLANE_EXPERIMENTAL_ICON_DISCOVERY: CODEPLANE_EXPERIMENTAL || truthy("CODEPLANE_EXPERIMENTAL_ICON_DISCOVERY"),
  CODEPLANE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("CODEPLANE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  CODEPLANE_ENABLE_EXA: truthy("CODEPLANE_ENABLE_EXA") || CODEPLANE_EXPERIMENTAL || truthy("CODEPLANE_EXPERIMENTAL_EXA"),
  CODEPLANE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("CODEPLANE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  // Hard ceiling on how long any individual tool may run before its execute()
  // is rejected with a timeout error. Catches MCP servers that hang on the
  // wire and tools that don't honor their abort signal. The model receives a
  // tool-error result and can choose to retry or move on, rather than the
  // whole stream stalling until LLM_STREAM_IDLE_TIMEOUT_MS fires and we lose
  // every other in-flight part of the turn. Default 5 min — generous, since
  // legit long-running work (compaction, big bash) should finish well under
  // it; tighten via env per deployment.
  CODEPLANE_TOOL_TIMEOUT_MS: number("CODEPLANE_TOOL_TIMEOUT_MS"),
  CODEPLANE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("CODEPLANE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  CODEPLANE_RETRY_MAX_ATTEMPTS: number("CODEPLANE_RETRY_MAX_ATTEMPTS"),
  CODEPLANE_LLM_STREAM_IDLE_TIMEOUT_MS: number("CODEPLANE_LLM_STREAM_IDLE_TIMEOUT_MS"),
  CODEPLANE_MAX_CONCURRENT_LLM_CALLS: number("CODEPLANE_MAX_CONCURRENT_LLM_CALLS"),
  CODEPLANE_BUS_BUFFER_SIZE: number("CODEPLANE_BUS_BUFFER_SIZE"),
  CODEPLANE_SSE_BUFFER_SIZE: number("CODEPLANE_SSE_BUFFER_SIZE"),
  CODEPLANE_EXPERIMENTAL_OXFMT: CODEPLANE_EXPERIMENTAL || truthy("CODEPLANE_EXPERIMENTAL_OXFMT"),
  CODEPLANE_EXPERIMENTAL_LSP_TY: truthy("CODEPLANE_EXPERIMENTAL_LSP_TY"),
  CODEPLANE_EXPERIMENTAL_LSP_TOOL: CODEPLANE_EXPERIMENTAL || truthy("CODEPLANE_EXPERIMENTAL_LSP_TOOL"),
  CODEPLANE_EXPERIMENTAL_PLAN_MODE: CODEPLANE_EXPERIMENTAL || truthy("CODEPLANE_EXPERIMENTAL_PLAN_MODE"),
  CODEPLANE_EXPERIMENTAL_MARKDOWN: !falsy("CODEPLANE_EXPERIMENTAL_MARKDOWN"),
  CODEPLANE_MODELS_URL: process.env["CODEPLANE_MODELS_URL"],
  CODEPLANE_MODELS_PATH: process.env["CODEPLANE_MODELS_PATH"],
  CODEPLANE_DISABLE_EMBEDDED_WEB_UI: truthy("CODEPLANE_DISABLE_EMBEDDED_WEB_UI"),
  /**
   * Dev-only escape hatch — when the embedded UI bundle hasn't been
   * built into the binary (i.e. `bun run dev:server` rather than a
   * release build), point the `/ui/*` proxy at a live UI dev server
   * (typically `http://localhost:5180`) instead of the placeholder
   * `https://example.invalid` that production hot-swaps at build
   * time. Lets a developer iterate on the @codeplane-ai/app dev
   * server while running a real Codeplane backend on its own port.
   */
  CODEPLANE_DEV_UI_URL: process.env["CODEPLANE_DEV_UI_URL"],
  CODEPLANE_DB: process.env["CODEPLANE_DB"],
  CODEPLANE_DISABLE_CHANNEL_DB: truthy("CODEPLANE_DISABLE_CHANNEL_DB"),
  CODEPLANE_SKIP_MIGRATIONS: truthy("CODEPLANE_SKIP_MIGRATIONS"),
  CODEPLANE_STRICT_CONFIG_DEPS: truthy("CODEPLANE_STRICT_CONFIG_DEPS"),

  CODEPLANE_WORKSPACE_ID: process.env["CODEPLANE_WORKSPACE_ID"],
  CODEPLANE_EXPERIMENTAL_HTTPAPI: truthy("CODEPLANE_EXPERIMENTAL_HTTPAPI"),
  CODEPLANE_EXPERIMENTAL_WORKSPACES: CODEPLANE_EXPERIMENTAL || truthy("CODEPLANE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get CODEPLANE_DISABLE_PROJECT_CONFIG() {
    return truthy("CODEPLANE_DISABLE_PROJECT_CONFIG")
  },
  get CODEPLANE_CONFIG_DIR() {
    return process.env["CODEPLANE_CONFIG_DIR"]
  },
  get CODEPLANE_PURE() {
    return truthy("CODEPLANE_PURE")
  },
  get CODEPLANE_PLUGIN_META_FILE() {
    return process.env["CODEPLANE_PLUGIN_META_FILE"]
  },
  get CODEPLANE_CLIENT() {
    return process.env["CODEPLANE_CLIENT"] ?? "cli"
  },
}
