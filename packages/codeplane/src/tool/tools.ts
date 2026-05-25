import path from "path"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "@/auth"
import { Config, ConfigGit } from "@/config"
import { InstanceState } from "@/effect"
import { Git } from "@/git"
import { Shell } from "@/shell/shell"
import { which } from "@/util/which"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./tools.txt"
import type { Availability } from "./registry"
import * as Tool from "./tool"

const operations = ["status", "check", "doctor"] as const
const providers = ["github", "gitlab", "bitbucket", "azure-devops", "generic"] as const

export const Parameters = Schema.Struct({
  operation: Schema.optional(Schema.Literals(operations)).annotate({
    description: "status is local only; check and doctor also test configured forge API credentials.",
  }),
  tool: Schema.optional(Schema.String).annotate({
    description: "Optional native tool id to focus on, for example forge, git, grep, or tools.",
  }),
  instance: Schema.optional(Schema.String).annotate({
    description: "Optional Git host config instance to focus credential diagnostics on.",
  }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory for local binary checks. Defaults to the current project directory.",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type Provider = (typeof providers)[number]
type Status = "ok" | "blocked" | "warning" | "missing" | "skipped"

type Diagnostic = {
  name: string
  status: Status
  detail: string
  fix?: string
}

type CredentialDiagnostic = Diagnostic & {
  provider: Provider
  token?: string
  credential?: ConfigGit.Credential
  apiBase?: string
}

function normalizeBaseUrl(input: string) {
  return input.replace(/\/+$/, "")
}

function hostFromRemote(input: string | undefined) {
  if (!input) return
  const url = input.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?(?:\/|$)/i)
  if (url) return url[1].toLowerCase()
  const scp = input.match(/^(?:[^@]+@)?([^:/]+):(.+)$/)
  return scp?.[1]?.toLowerCase()
}

function providerFromHost(host: string | undefined): Provider {
  if (!host) return "generic"
  if (host === "github.com" || host.endsWith(".github.com")) return "github"
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab"
  if (host === "bitbucket.org" || host.endsWith(".bitbucket.org")) return "bitbucket"
  if (host.includes("dev.azure.com") || host.includes("visualstudio.com")) return "azure-devops"
  return "generic"
}

function providerBaseUrl(provider: Provider, item: ConfigGit.Instance) {
  const url = normalizeBaseUrl(item.url)
  if (url) return url
  if (provider === "github") return "https://github.com"
  if (provider === "gitlab") return "https://gitlab.com"
  if (provider === "bitbucket") return "https://bitbucket.org"
  return "https://example.invalid"
}

function apiBase(provider: Provider, baseUrl: string, host: string | undefined) {
  if (provider === "github") return host === "github.com" ? "https://api.github.com" : `${baseUrl}/api/v3`
  if (provider === "gitlab") return `${baseUrl}/api/v4`
  if (provider === "bitbucket") return host === "bitbucket.org" ? "https://api.bitbucket.org/2.0" : baseUrl
  return baseUrl
}

function requestHeaders(provider: Provider, credential: ConfigGit.Credential | undefined, token: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "codeplane",
  }
  if (provider === "gitlab") return { ...headers, "PRIVATE-TOKEN": token }
  if (provider === "bitbucket" && credential?.username) {
    return {
      ...headers,
      Authorization: `Basic ${Buffer.from(`${credential.username}:${token}`).toString("base64")}`,
    }
  }
  if (provider === "azure-devops") {
    return { ...headers, Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}` }
  }
  return { ...headers, Authorization: `Bearer ${token}` }
}

function authEndpoint(provider: Provider, baseUrl: string, api: string) {
  if (provider === "github" || provider === "gitlab" || provider === "bitbucket") return `${api}/user`
  if (provider === "azure-devops") return `${baseUrl}/_apis/connectionData?api-version=7.1-preview.1`
}

function formatRows(items: Diagnostic[]) {
  if (items.length === 0) return "- none"
  return items
    .map((item) =>
      [`- ${item.name}: ${item.status} - ${item.detail}`, item.fix ? `  Fix: ${item.fix}` : undefined]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n")
}

function availabilityFromExtra(extra: Tool.Context["extra"]): Availability | undefined {
  const value = extra?.toolAvailability
  if (!value || typeof value !== "object") return
  const availability = value as Partial<Availability>
  if (!Array.isArray(availability.available) || !Array.isArray(availability.blocked)) return
  return {
    known: Array.isArray(availability.known)
      ? availability.known.filter((item): item is string => typeof item === "string")
      : undefined,
    available: availability.available.filter((item): item is string => typeof item === "string"),
    blocked: availability.blocked.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const blocked = item as Partial<Availability["blocked"][number]>
      if (typeof blocked.id !== "string" || typeof blocked.reason !== "string") return []
      return [{ id: blocked.id, reason: blocked.reason, setup: blocked.setup }]
    }),
  }
}

function toolDiagnostics(status: Availability | undefined, tool: string | undefined): Diagnostic[] {
  if (!status) {
    return [
      {
        name: tool ?? "native tools",
        status: "warning" as const,
        detail: "Live registry availability was not attached to this tool call.",
        fix: "Call this tool through a normal agent step so the session can attach live availability.",
      },
    ]
  }

  const available = new Set(status.available)
  const blocked = new Map(status.blocked.map((item) => [item.id, item]))
  const known = [
    ...(status.known?.length ? status.known : [...status.available, ...status.blocked.map((item) => item.id)]),
  ]
    .filter((item, index, items) => items.indexOf(item) === index)
    .filter((item) => !tool || item === tool)
    .toSorted((a, b) => a.localeCompare(b))

  if (known.length === 0 && tool) {
    return [
      {
        name: tool,
        status: "missing" as const,
        detail: "No native tool with this id is known in the current session.",
      },
    ]
  }

  return known.map((id) => {
    const item = blocked.get(id)
    if (item) {
      return {
        name: id,
        status: "blocked" as const,
        detail: item.reason,
        fix: item.setup,
      }
    }
    if (available.has(id)) return { name: id, status: "ok" as const, detail: "callable right now" }
    return {
      name: id,
      status: "warning" as const,
      detail: "known, but not exposed for the current provider, model, flags, or permission context",
    }
  })
}

export const ToolsTool = Tool.define<
  typeof Parameters,
  Record<string, unknown>,
  Auth.Service | Config.Service | Git.Service | HttpClient.HttpClient
>(
  "tools",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const git = yield* Git.Service
    const http = yield* HttpClient.HttpClient

    const cwd = Effect.fn("ToolsTool.cwd")(function* (params: Params, ctx: Tool.Context) {
      const ins = yield* InstanceState.context
      const result = AppFileSystem.resolve(
        path.isAbsolute(params.cwd ?? ins.directory)
          ? (params.cwd ?? ins.directory)
          : path.join(ins.directory, params.cwd ?? "."),
      )
      yield* assertExternalDirectoryEffect(ctx, result, { kind: "directory" })
      return result
    })

    const binaryDiagnostics = Effect.fn("ToolsTool.binaryDiagnostics")(function* (dir: string) {
      const env = Shell.environment()
      const gitPath = which("git", env)
      const gitVersion = gitPath ? yield* git.run(["--version"], { cwd: dir }) : undefined
      const rgPath = which(process.platform === "win32" ? "rg.exe" : "rg", env)
      const shell = Shell.acceptable()

      return [
        {
          name: "git binary",
          status: gitPath && gitVersion?.exitCode === 0 ? ("ok" as const) : ("missing" as const),
          detail:
            gitPath && gitVersion?.exitCode === 0
              ? `${gitPath} (${gitVersion.text().trim()})`
              : "git is not available on PATH or did not execute successfully",
          fix: gitPath ? undefined : "Install Git and ensure git is on PATH.",
        },
        {
          name: "shell",
          status: "ok" as const,
          detail: shell,
        },
        {
          name: "ripgrep",
          status: rgPath ? ("ok" as const) : ("warning" as const),
          detail: rgPath ?? "rg is not on PATH; bundled ripgrep will be prepared on demand if supported.",
        },
      ] satisfies Diagnostic[]
    })

    const credentialDiagnostics = Effect.fn("ToolsTool.credentialDiagnostics")(function* (instance?: string) {
      const env = Shell.environment()
      const entries = Object.entries((yield* config.get()).git ?? {}).filter(([name]) => !instance || name === instance)
      if (entries.length === 0) {
        return [
          {
            name: instance ?? "git config",
            status: "missing" as const,
            provider: "generic" as const,
            detail: instance ? "No Git host config with this name exists." : "No Git host config exists.",
            fix: 'Use git operation="config_set", then git operation="credential_set".',
          },
        ] satisfies CredentialDiagnostic[]
      }

      return yield* Effect.forEach(
        entries,
        Effect.fnUntraced(function* ([name, item]) {
          const provider = item.provider ?? providerFromHost(hostFromRemote(item.url))
          const baseUrl = providerBaseUrl(provider, item)
          const credential = item.credential
          const token =
            credential?.type === "env" && credential.env
              ? env[credential.env]
              : credential?.type === "stored" && credential.key
                ? yield* auth
                    .get(credential.key)
                    .pipe(Effect.map((item) => (item?.type === "api" ? item.key : undefined)))
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
          const api = apiBase(provider, baseUrl, hostFromRemote(baseUrl))

          if (credential?.type === "env" && credential.env) {
            if (token) {
              return {
                name,
                status: "ok" as const,
                provider,
                token,
                credential,
                apiBase: api,
                detail: `${credential.env} is set; forge API credentials are available.`,
              }
            }
            return {
              name,
              status: "blocked" as const,
              provider,
              credential,
              apiBase: api,
              detail: `${credential.env} is referenced but not set.`,
              fix: `Set ${credential.env}, or run git operation="credential_set" with a stored token.`,
            }
          }

          if (credential?.type === "stored" && credential.key) {
            if (token) {
              return {
                name,
                status: "ok" as const,
                provider,
                token,
                credential,
                apiBase: api,
                detail: `stored API credential ${credential.key} exists; forge API credentials are available.`,
              }
            }
            return {
              name,
              status: "blocked" as const,
              provider,
              credential,
              apiBase: api,
              detail: `stored credential ${credential.key} is referenced but missing or not an API credential.`,
              fix: 'Run git operation="credential_set" with a token for this instance.',
            }
          }

          if (credential?.type === "ssh") {
            return {
              name,
              status: "warning" as const,
              provider,
              credential,
              apiBase: api,
              detail: "SSH credentials can run git transport, but cannot authenticate forge HTTP APIs.",
              fix: 'Add an API token with git operation="credential_set" if forge should be callable.',
            }
          }

          return {
            name,
            status: "blocked" as const,
            provider,
            credential,
            apiBase: api,
            detail: "No credential is configured for this Git host.",
            fix: 'Run git operation="credential_set" with token, tokenEnv, or sshCommand.',
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const authChecks = Effect.fn("ToolsTool.authChecks")(function* (items: CredentialDiagnostic[]) {
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (!item.token || !item.apiBase) {
            return {
              name: `forge auth ${item.name}`,
              status: "skipped" as const,
              detail: "No API token is available to test.",
              fix: item.fix,
            } satisfies Diagnostic
          }

          const token = item.token
          const endpoint = authEndpoint(
            item.provider,
            normalizeBaseUrl(item.apiBase.replace(/\/api\/v[34]$/, "")),
            item.apiBase,
          )
          if (!endpoint) {
            return {
              name: `forge auth ${item.name}`,
              status: "skipped" as const,
              detail: `No standard auth test endpoint is known for ${item.provider}.`,
            } satisfies Diagnostic
          }

          return yield* Effect.gen(function* () {
            const response = yield* http.execute(
              HttpClientRequest.get(endpoint).pipe(
                HttpClientRequest.setHeaders(requestHeaders(item.provider, item.credential, token)),
              ),
            )
            return {
              name: `forge auth ${item.name}`,
              status: response.status < 400 ? ("ok" as const) : ("blocked" as const),
              detail:
                response.status < 400
                  ? `${endpoint} returned ${response.status}.`
                  : `${endpoint} returned ${response.status}; token may be invalid or missing scopes.`,
              fix:
                response.status < 400
                  ? undefined
                  : "Replace the token or add the provider scopes required for PRs, issues, CI, and releases.",
            } satisfies Diagnostic
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                name: `forge auth ${item.name}`,
                status: "warning" as const,
                detail: `Auth check could not reach ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
              } satisfies Diagnostic),
            ),
          )
        }),
        { concurrency: "unbounded" },
      )
    })

    const execute = Effect.fn("ToolsTool.execute")(function* (params: Params, ctx: Tool.Context) {
      const operation = params.operation ?? "status"
      yield* ctx.ask({
        permission: "tools",
        patterns: [operation, params.tool ?? "*"],
        always: [operation],
        metadata: {
          operation,
          tool: params.tool,
          instance: params.instance,
        },
      })

      const dir = yield* cwd(params, ctx)
      const [toolRows, binaryRows, credentialRows] = yield* Effect.all(
        [
          Effect.sync(() => toolDiagnostics(availabilityFromExtra(ctx.extra), params.tool)),
          binaryDiagnostics(dir),
          credentialDiagnostics(params.instance),
        ],
        { concurrency: "unbounded" },
      )
      const checkRows = operation === "status" ? [] : yield* authChecks(credentialRows)
      const recommendations =
        operation === "doctor"
          ? [...toolRows, ...binaryRows, ...credentialRows, ...checkRows]
              .flatMap((item: Diagnostic) => (item.fix ? [item.fix] : []))
              .filter((item, index, items) => items.indexOf(item) === index)
          : []

      return {
        title: operation === "status" ? "tools status" : `tools ${operation}`,
        output: [
          `# Tools ${operation}`,
          [params.tool ? `tool=${params.tool}` : undefined, params.instance ? `instance=${params.instance}` : undefined]
            .filter(Boolean)
            .join(" · ") || undefined,
          "",
          "## Native tools",
          formatRows(toolRows),
          "",
          "## Local requirements",
          formatRows(binaryRows),
          "",
          "## Git host credentials",
          formatRows(credentialRows),
          "",
          operation === "status" ? "Forge auth checks: skipped; run operation=check or operation=doctor." : undefined,
          checkRows.length ? ["## Forge auth checks", formatRows(checkRows)].join("\n") : undefined,
          recommendations.length
            ? ["", "## Recommendations", ...recommendations.map((item) => `- ${item}`)].join("\n")
            : undefined,
        ]
          .filter((item): item is string => Boolean(item))
          .join("\n"),
        metadata: {
          operation,
          tool: params.tool,
          instance: params.instance,
          toolCount: toolRows.length,
          blockedToolCount: toolRows.filter((item) => item.status === "blocked").length,
          credentialCount: credentialRows.length,
          checkCount: checkRows.length,
        },
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) => execute(params, ctx).pipe(Effect.orDie),
    }
  }),
)
