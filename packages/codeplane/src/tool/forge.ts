import path from "path"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "@/auth"
import { Config, ConfigGit } from "@/config"
import { InstanceState } from "@/effect"
import { Git } from "@/git"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./forge.txt"
import * as Tool from "./tool"

const operations = [
  "info",
  "pull_request_list",
  "pull_request_get",
  "pull_request_create",
  "pull_request_update",
  "pull_request_merge",
  "pull_request_comment",
  "pull_request_files",
  "pull_request_reviews",
  "pull_request_checks",
  "issue_list",
  "issue_get",
  "issue_create",
  "issue_update",
  "issue_comment",
  "ci_list",
  "ci_get",
  "ci_jobs",
  "ci_log",
  "ci_rerun",
  "workflow_dispatch",
  "release_list",
  "release_get",
  "release_create",
  "raw",
] as const

const providers = ["github", "gitlab", "bitbucket", "azure-devops", "generic"] as const
const methods = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const

const QueryValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "Forge API operation to perform" }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory used to infer the git remote. Defaults to the current project directory.",
  }),
  instance: Schema.optional(Schema.String).annotate({
    description: "Named Git host instance from git config, for example github or company-gitlab.",
  }),
  provider: Schema.optional(Schema.Literals(providers)).annotate({
    description: "Forge provider. Inferred from git config or remote host when omitted.",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "Forge base URL or git remote URL. Used to infer host, provider, owner, repo, or project.",
  }),
  host: Schema.optional(Schema.String).annotate({ description: "Forge host name, for example github.com." }),
  remote: Schema.optional(Schema.String).annotate({
    description: "Git remote name used for inference. Defaults to origin.",
  }),
  owner: Schema.optional(Schema.String).annotate({
    description: "Repository owner or organization for GitHub/Bitbucket.",
  }),
  repo: Schema.optional(Schema.String).annotate({ description: "Repository name for GitHub/Bitbucket." }),
  project: Schema.optional(Schema.String).annotate({
    description: "Project path for GitLab, for example group/subgroup/repo.",
  }),
  number: Schema.optional(Schema.Number).annotate({ description: "Pull request, merge request, or issue number/IID." }),
  id: Schema.optional(Schema.String).annotate({
    description: "Provider-specific id such as a workflow run, job, or pipeline id.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Title for create/update operations." }),
  body: Schema.optional(Schema.String).annotate({ description: "Body, description, comment, or release notes." }),
  state: Schema.optional(Schema.String).annotate({
    description: "State filter or update value, such as open, closed, all.",
  }),
  base: Schema.optional(Schema.String).annotate({ description: "Base/target branch." }),
  head: Schema.optional(Schema.String).annotate({ description: "Head/source branch." }),
  ref: Schema.optional(Schema.String).annotate({ description: "Branch, tag, commit SHA, or workflow dispatch ref." }),
  sha: Schema.optional(Schema.String).annotate({ description: "Commit SHA for check/status operations." }),
  labels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Labels for issue filters or writes.",
  }),
  assignees: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Assignees for issue create/update operations.",
  }),
  draft: Schema.optional(Schema.Boolean).annotate({
    description: "Create a draft pull request/release when supported.",
  }),
  deleteBranch: Schema.optional(Schema.Boolean).annotate({
    description: "Delete/remove source branch when merging if provider supports it.",
  }),
  squash: Schema.optional(Schema.Boolean).annotate({ description: "Squash when merging if provider supports it." }),
  mergeMethod: Schema.optional(Schema.Literals(["merge", "squash", "rebase"])).annotate({
    description: "GitHub merge method for pull_request_merge.",
  }),
  workflow: Schema.optional(Schema.String).annotate({ description: "Workflow file name or id for workflow_dispatch." }),
  tagName: Schema.optional(Schema.String).annotate({ description: "Release tag name." }),
  name: Schema.optional(Schema.String).annotate({ description: "Release name or generic provider-specific name." }),
  path: Schema.optional(Schema.String).annotate({ description: "Provider API path for operation=raw." }),
  method: Schema.optional(Schema.Literals(methods)).annotate({
    description: "HTTP method for operation=raw. Defaults to GET.",
  }),
  query: Schema.optional(Schema.Record(Schema.String, QueryValue)).annotate({
    description: "Query string parameters.",
  }),
  data: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "JSON request body for create/update/raw operations.",
  }),
  page: Schema.optional(Schema.Number).annotate({ description: "Page number for list operations." }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum items per page. Defaults to 30, max 100." }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type Provider = (typeof providers)[number]
type Method = (typeof methods)[number]

type RemoteInfo = {
  host?: string
  path?: string
}

type ForgeContext = {
  provider: Provider
  baseUrl: string
  apiBase: string
  repoBase: string
  host?: string
  owner?: string
  repo?: string
  project?: string
  token?: string
  credential?: ConfigGit.Credential
  instance?: string
}

function normalizeBaseUrl(input: string) {
  return input.replace(/\/+$/, "")
}

function parseRemote(input: string | undefined): RemoteInfo {
  if (!input) return {}
  const url = input.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?(?:\/(.+))?$/i)
  if (url) return { host: url[1].toLowerCase(), path: cleanRepoPath(url[2]) }
  const scp = input.match(/^(?:[^@]+@)?([^:/]+):(.+)$/)
  if (scp) return { host: scp[1].toLowerCase(), path: cleanRepoPath(scp[2]) }
  return {}
}

function cleanRepoPath(input: string | undefined) {
  return input
    ?.replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
}

function providerFromHost(host: string | undefined): Provider {
  if (!host) return "generic"
  if (host === "github.com" || host.endsWith(".github.com")) return "github"
  if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab"
  if (host === "bitbucket.org" || host.endsWith(".bitbucket.org")) return "bitbucket"
  if (host.includes("dev.azure.com") || host.includes("visualstudio.com")) return "azure-devops"
  return "generic"
}

function providerBaseUrl(provider: Provider, host: string | undefined, configured?: string) {
  if (configured) return normalizeBaseUrl(configured)
  if (host) return `https://${host}`
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

function splitOwnerRepo(repoPath: string | undefined) {
  const parts = (repoPath ?? "").split("/").filter(Boolean)
  if (parts.length < 2) return {}
  return { owner: parts[0], repo: parts.slice(1).join("/") }
}

function encodePath(input: string) {
  return input.split("/").map(encodeURIComponent).join("/")
}

function appendQuery(url: string, query: Record<string, string | number | boolean | undefined>) {
  const result = new URL(url)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) result.searchParams.set(key, String(value))
  })
  return result.toString()
}

function listQuery(params: Params, extra: Record<string, string | number | boolean | undefined> = {}) {
  return {
    per_page: Math.max(1, Math.min(100, params.limit ?? 30)),
    page: params.page,
    ...params.query,
    ...extra,
  }
}

function gitlabState(state: string | undefined) {
  if (state === "open") return "opened"
  if (state === "closed") return "closed"
  if (state === "merged") return "merged"
  if (state === "all") return "all"
  return state
}

function githubState(state: string | undefined) {
  if (state === "opened") return "open"
  return state
}

function methodRequest(method: Method, url: string) {
  if (method === "POST") return HttpClientRequest.post(url)
  if (method === "PATCH") return HttpClientRequest.patch(url)
  if (method === "PUT") return HttpClientRequest.put(url)
  if (method === "DELETE") return HttpClientRequest.delete(url)
  return HttpClientRequest.get(url)
}

function redactHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|private-token/i.test(key) ? "<redacted>" : value,
    ]),
  )
}

function requestHeaders(ctx: ForgeContext) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "codeplane",
  }
  if (!ctx.token) return headers
  if (ctx.provider === "gitlab") return { ...headers, "PRIVATE-TOKEN": ctx.token }
  if (ctx.provider === "bitbucket" && ctx.credential?.username) {
    return {
      ...headers,
      Authorization: `Basic ${Buffer.from(`${ctx.credential.username}:${ctx.token}`).toString("base64")}`,
    }
  }
  if (ctx.provider === "azure-devops") {
    return { ...headers, Authorization: `Basic ${Buffer.from(`:${ctx.token}`).toString("base64")}` }
  }
  return { ...headers, Authorization: `Bearer ${ctx.token}` }
}

function endpoint(ctx: ForgeContext, suffix = "") {
  return `${ctx.repoBase}${suffix}`
}

function titleFor(params: Params, ctx: ForgeContext, url: string) {
  return `${ctx.provider} ${params.operation} ${new URL(url).pathname}`
}

export const ForgeTool = Tool.define<
  typeof Parameters,
  Record<string, unknown>,
  Auth.Service | Config.Service | Git.Service | HttpClient.HttpClient
>(
  "forge",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const git = yield* Git.Service
    const http = yield* HttpClient.HttpClient

    const cwd = Effect.fn("ForgeTool.cwd")(function* (params: Params, ctx: Tool.Context) {
      const ins = yield* InstanceState.context
      const result = AppFileSystem.resolve(
        path.isAbsolute(params.cwd ?? ins.directory)
          ? (params.cwd ?? ins.directory)
          : path.join(ins.directory, params.cwd ?? "."),
      )
      yield* assertExternalDirectoryEffect(ctx, result, { kind: "directory" })
      return result
    })

    const remoteUrl = Effect.fn("ForgeTool.remoteUrl")(function* (dir: string, remote = "origin") {
      const result = yield* git.run(["remote", "get-url", remote], { cwd: dir })
      if (result.exitCode !== 0) return
      return result.text().trim() || undefined
    })

    const configuredInstance = Effect.fn("ForgeTool.configuredInstance")(function* (params: Params, dir: string) {
      const cfg = (yield* config.get()).git ?? {}
      if (params.instance && cfg[params.instance]) {
        return [params.instance, cfg[params.instance]] as [string, ConfigGit.Instance]
      }

      const remote = params.url ?? (yield* remoteUrl(dir, params.remote ?? "origin"))
      const parsed = parseRemote(remote)
      const host = params.host?.toLowerCase() ?? parsed.host
      if (!host) return

      return Object.entries(cfg).find(([, item]) => {
        const hosts = [parseRemote(item.url).host, ...(item.hosts ?? []).map((entry) => entry.toLowerCase())].filter(
          (entry): entry is string => Boolean(entry),
        )
        return hosts.includes(host)
      }) as [string, ConfigGit.Instance] | undefined
    })

    const token = Effect.fn("ForgeTool.token")(function* (credential: ConfigGit.Credential | undefined) {
      if (credential?.type === "env" && credential.env) return process.env[credential.env]
      if (credential?.type === "stored" && credential.key) {
        return yield* auth.get(credential.key).pipe(Effect.map((item) => (item?.type === "api" ? item.key : undefined)))
      }
    })

    const context = Effect.fn("ForgeTool.context")(function* (params: Params, toolCtx: Tool.Context) {
      const dir = yield* cwd(params, toolCtx)
      const remote = params.url ?? (yield* remoteUrl(dir, params.remote ?? "origin"))
      const parsed = parseRemote(remote)
      const found = yield* configuredInstance(params, dir)
      const item = found?.[1]
      const host = params.host?.toLowerCase() ?? parsed.host ?? parseRemote(item?.url).host
      const provider = params.provider ?? item?.provider ?? providerFromHost(host)
      const repoPath = cleanRepoPath(params.project ?? parsed.path)
      const ownerRepo = splitOwnerRepo(repoPath)
      const baseUrl = providerBaseUrl(provider, host, item?.url)
      const baseHost = host ?? parseRemote(baseUrl).host
      const api = apiBase(provider, baseUrl, baseHost)
      const owner = params.owner ?? ownerRepo.owner
      const repo = params.repo ?? ownerRepo.repo
      const project = params.project ?? repoPath
      const repoBase =
        provider === "github" && owner && repo
          ? `${api}/repos/${encodeURIComponent(owner)}/${encodePath(repo)}`
          : provider === "gitlab" && project
            ? `${api}/projects/${encodeURIComponent(project)}`
            : provider === "bitbucket" && owner && repo
              ? `${api}/repositories/${encodeURIComponent(owner)}/${encodePath(repo)}`
              : api

      return {
        provider,
        baseUrl,
        apiBase: api,
        repoBase,
        host,
        owner,
        repo,
        project,
        credential: item?.credential,
        token: yield* token(item?.credential),
        instance: found?.[0],
      } satisfies ForgeContext
    })

    const requireRepo = Effect.fn("ForgeTool.requireRepo")(function* (ctx: ForgeContext) {
      if (ctx.provider === "github" || ctx.provider === "bitbucket") {
        if (!ctx.owner || !ctx.repo) {
          return yield* Effect.fail(new Error("owner and repo are required; set them or configure a git remote"))
        }
      }
      if (ctx.provider === "gitlab" && !ctx.project) {
        return yield* Effect.fail(new Error("project is required for GitLab; set it or configure a git remote"))
      }
      return ctx
    })

    const requireCredential = Effect.fn("ForgeTool.requireCredential")(function* (ctx: ForgeContext) {
      if (!ctx.instance) {
        return yield* Effect.fail(
          new Error("forge requires a configured Git host; run git config_set and git credential_set first"),
        )
      }
      if (!ctx.token) {
        return yield* Effect.fail(
          new Error("forge requires a configured API credential; run git credential_set with a token or tokenEnv"),
        )
      }
      return ctx
    })

    const request = Effect.fn("ForgeTool.request")(function* (
      params: Params,
      toolCtx: Tool.Context,
      method: Method,
      url: string,
      data?: Record<string, unknown>,
      query: Record<string, string | number | boolean | undefined> = {},
      requireRepository = true,
    ) {
      const ctx = yield* requireCredential(
        requireRepository ? yield* requireRepo(yield* context(params, toolCtx)) : yield* context(params, toolCtx),
      )
      const target = appendQuery(url, query)
      const headers = requestHeaders(ctx)
      yield* toolCtx.ask({
        permission: "forge",
        patterns: [ctx.host ?? ctx.baseUrl, params.operation],
        always: [params.operation],
        metadata: {
          operation: params.operation,
          provider: ctx.provider,
          instance: ctx.instance,
          method,
          url: target,
          headers: redactHeaders(headers),
        },
      })

      const base = methodRequest(method, target).pipe(HttpClientRequest.setHeaders(headers))
      const req = data === undefined ? base : yield* base.pipe(HttpClientRequest.bodyJson(data))
      const response = yield* http.execute(req)
      const raw = new TextDecoder().decode(yield* response.arrayBuffer)
      const body = raw
        ? yield* Effect.sync(() => JSON.parse(raw) as unknown).pipe(Effect.catch(() => Effect.succeed(raw as unknown)))
        : undefined
      if (response.status >= 400) {
        return yield* Effect.fail(new Error(`${method} ${target} failed with status ${response.status}: ${raw}`))
      }
      return {
        title: titleFor(params, ctx, target),
        output: typeof body === "string" ? body : JSON.stringify(body ?? { status: response.status }, null, 2),
        metadata: {
          operation: params.operation,
          provider: ctx.provider,
          instance: ctx.instance,
          method,
          url: target,
          status: response.status,
        },
      }
    })

    const commitShaForChecks = Effect.fn("ForgeTool.commitShaForChecks")(function* (
      params: Params,
      toolCtx: Tool.Context,
    ) {
      if (params.sha) return params.sha
      const ctx = yield* context(params, toolCtx)
      if (ctx.provider !== "github" || !params.number) return params.ref
      const result = yield* request(params, toolCtx, "GET", endpoint(ctx, `/pulls/${params.number}`))
      const data = JSON.parse(result.output) as { head?: { sha?: string } }
      return data.head?.sha
    })

    const execute = Effect.fn("ForgeTool.execute")(function* (params: Params, toolCtx: Tool.Context) {
      const ctx = yield* context(params, toolCtx)
      if (!["github", "gitlab"].includes(ctx.provider) && !["info", "raw"].includes(params.operation)) {
        return yield* Effect.fail(
          new Error(`structured forge operations are implemented for GitHub and GitLab; use raw for ${ctx.provider}`),
        )
      }

      switch (params.operation) {
        case "info": {
          const dir = yield* cwd(params, toolCtx)
          const [branch, remote] = yield* Effect.all([git.branch(dir), remoteUrl(dir, params.remote ?? "origin")], {
            concurrency: "unbounded",
          })
          return yield* request(params, toolCtx, "GET", ctx.repoBase, undefined, {
            branch,
            remote: remote ?? undefined,
            ...params.query,
          })
        }
        case "pull_request_list":
          if (ctx.provider === "gitlab") {
            return yield* request(params, toolCtx, "GET", endpoint(ctx, "/merge_requests"), undefined, {
              ...listQuery(params, {
                state: gitlabState(params.state),
                source_branch: params.head,
                target_branch: params.base,
              }),
            })
          }
          return yield* request(params, toolCtx, "GET", endpoint(ctx, "/pulls"), undefined, {
            ...listQuery(params, { state: githubState(params.state), head: params.head, base: params.base }),
          })
        case "pull_request_get":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(ctx, ctx.provider === "gitlab" ? `/merge_requests/${params.number}` : `/pulls/${params.number}`),
          )
        case "pull_request_create":
          if (!params.title || !params.head || !params.base) {
            return yield* Effect.fail(new Error("title, head, and base are required"))
          }
          if (ctx.provider === "gitlab") {
            return yield* request(params, toolCtx, "POST", endpoint(ctx, "/merge_requests"), {
              title: params.title,
              description: params.body,
              source_branch: params.head,
              target_branch: params.base,
              remove_source_branch: params.deleteBranch,
              squash: params.squash,
            })
          }
          return yield* request(params, toolCtx, "POST", endpoint(ctx, "/pulls"), {
            title: params.title,
            body: params.body,
            head: params.head,
            base: params.base,
            draft: params.draft,
          })
        case "pull_request_update":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          if (ctx.provider === "gitlab") {
            return yield* request(params, toolCtx, "PUT", endpoint(ctx, `/merge_requests/${params.number}`), {
              title: params.title,
              description: params.body,
              state_event: params.state === "closed" ? "close" : params.state === "open" ? "reopen" : undefined,
              target_branch: params.base,
            })
          }
          return yield* request(params, toolCtx, "PATCH", endpoint(ctx, `/pulls/${params.number}`), {
            title: params.title,
            body: params.body,
            state: githubState(params.state),
            base: params.base,
          })
        case "pull_request_merge":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          if (ctx.provider === "gitlab") {
            return yield* request(params, toolCtx, "PUT", endpoint(ctx, `/merge_requests/${params.number}/merge`), {
              should_remove_source_branch: params.deleteBranch,
              squash: params.squash,
              merge_commit_message: params.body,
            })
          }
          return yield* request(params, toolCtx, "PUT", endpoint(ctx, `/pulls/${params.number}/merge`), {
            commit_title: params.title,
            commit_message: params.body,
            merge_method: params.mergeMethod,
          })
        case "pull_request_comment":
          if (!params.number || !params.body) return yield* Effect.fail(new Error("number and body are required"))
          return yield* request(
            params,
            toolCtx,
            "POST",
            endpoint(
              ctx,
              ctx.provider === "gitlab"
                ? `/merge_requests/${params.number}/notes`
                : `/issues/${params.number}/comments`,
            ),
            { body: params.body },
          )
        case "pull_request_files":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(
              ctx,
              ctx.provider === "gitlab" ? `/merge_requests/${params.number}/changes` : `/pulls/${params.number}/files`,
            ),
            undefined,
            listQuery(params),
          )
        case "pull_request_reviews":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(
              ctx,
              ctx.provider === "gitlab"
                ? `/merge_requests/${params.number}/discussions`
                : `/pulls/${params.number}/reviews`,
            ),
            undefined,
            listQuery(params),
          )
        case "pull_request_checks": {
          const sha = yield* commitShaForChecks(params, toolCtx)
          if (ctx.provider === "gitlab") {
            return yield* request(
              params,
              toolCtx,
              "GET",
              params.number
                ? endpoint(ctx, `/merge_requests/${params.number}/pipelines`)
                : endpoint(ctx, `/repository/commits/${encodeURIComponent(sha ?? params.ref ?? "HEAD")}/statuses`),
              undefined,
              listQuery(params),
            )
          }
          if (!sha) return yield* Effect.fail(new Error("sha, ref, or pull request number is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(ctx, `/commits/${sha}/check-runs`),
            undefined,
            listQuery(params),
          )
        }
        case "issue_list":
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(ctx, "/issues"),
            undefined,
            listQuery(params, {
              state: ctx.provider === "gitlab" ? gitlabState(params.state) : githubState(params.state),
              labels: params.labels?.join(","),
            }),
          )
        case "issue_get":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          return yield* request(params, toolCtx, "GET", endpoint(ctx, `/issues/${params.number}`))
        case "issue_create":
          if (!params.title) return yield* Effect.fail(new Error("title is required"))
          return yield* request(params, toolCtx, "POST", endpoint(ctx, "/issues"), {
            title: params.title,
            body: ctx.provider === "gitlab" ? undefined : params.body,
            description: ctx.provider === "gitlab" ? params.body : undefined,
            labels: ctx.provider === "gitlab" ? params.labels?.join(",") : params.labels,
            assignees: params.assignees,
          })
        case "issue_update":
          if (!params.number) return yield* Effect.fail(new Error("number is required"))
          return yield* request(
            params,
            toolCtx,
            ctx.provider === "gitlab" ? "PUT" : "PATCH",
            endpoint(ctx, `/issues/${params.number}`),
            {
              title: params.title,
              body: ctx.provider === "gitlab" ? undefined : params.body,
              description: ctx.provider === "gitlab" ? params.body : undefined,
              state: ctx.provider === "gitlab" ? undefined : githubState(params.state),
              state_event: ctx.provider === "gitlab" && params.state === "closed" ? "close" : undefined,
              labels: ctx.provider === "gitlab" ? params.labels?.join(",") : params.labels,
              assignees: params.assignees,
            },
          )
        case "issue_comment":
          if (!params.number || !params.body) return yield* Effect.fail(new Error("number and body are required"))
          return yield* request(
            params,
            toolCtx,
            "POST",
            endpoint(ctx, `/issues/${params.number}/${ctx.provider === "gitlab" ? "notes" : "comments"}`),
            {
              body: params.body,
            },
          )
        case "ci_list":
          if (ctx.provider === "gitlab") {
            return yield* request(
              params,
              toolCtx,
              "GET",
              endpoint(ctx, "/pipelines"),
              undefined,
              listQuery(params, { ref: params.ref }),
            )
          }
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(ctx, "/actions/runs"),
            undefined,
            listQuery(params, { branch: params.ref }),
          )
        case "ci_get":
          if (!params.id) return yield* Effect.fail(new Error("id is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(ctx, ctx.provider === "gitlab" ? `/pipelines/${params.id}` : `/actions/runs/${params.id}`),
          )
        case "ci_jobs":
          if (!params.id) return yield* Effect.fail(new Error("id is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(
              ctx,
              ctx.provider === "gitlab" ? `/pipelines/${params.id}/jobs` : `/actions/runs/${params.id}/jobs`,
            ),
            undefined,
            listQuery(params),
          )
        case "ci_log":
          if (!params.id) return yield* Effect.fail(new Error("id is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(ctx, ctx.provider === "gitlab" ? `/jobs/${params.id}/trace` : `/actions/jobs/${params.id}/logs`),
          )
        case "ci_rerun":
          if (!params.id) return yield* Effect.fail(new Error("id is required"))
          return yield* request(
            params,
            toolCtx,
            "POST",
            endpoint(ctx, ctx.provider === "gitlab" ? `/jobs/${params.id}/retry` : `/actions/runs/${params.id}/rerun`),
          )
        case "workflow_dispatch":
          if (ctx.provider !== "github")
            return yield* Effect.fail(new Error("workflow_dispatch is only implemented for GitHub"))
          if (!params.workflow || !params.ref) return yield* Effect.fail(new Error("workflow and ref are required"))
          return yield* request(
            params,
            toolCtx,
            "POST",
            endpoint(ctx, `/actions/workflows/${params.workflow}/dispatches`),
            {
              ref: params.ref,
              inputs: params.data,
            },
          )
        case "release_list":
          return yield* request(params, toolCtx, "GET", endpoint(ctx, "/releases"), undefined, listQuery(params))
        case "release_get":
          if (!params.tagName) return yield* Effect.fail(new Error("tagName is required"))
          return yield* request(
            params,
            toolCtx,
            "GET",
            endpoint(
              ctx,
              ctx.provider === "gitlab"
                ? `/releases/${encodeURIComponent(params.tagName)}`
                : `/releases/tags/${params.tagName}`,
            ),
          )
        case "release_create":
          if (!params.tagName) return yield* Effect.fail(new Error("tagName is required"))
          return yield* request(params, toolCtx, "POST", endpoint(ctx, "/releases"), {
            tag_name: params.tagName,
            ref: ctx.provider === "gitlab" ? (params.ref ?? "HEAD") : undefined,
            target_commitish: ctx.provider === "gitlab" ? undefined : params.ref,
            name: params.name,
            body: ctx.provider === "gitlab" ? undefined : params.body,
            description: ctx.provider === "gitlab" ? params.body : undefined,
            draft: params.draft,
          })
        case "raw": {
          const method = params.method ?? "GET"
          if (!params.path) return yield* Effect.fail(new Error("path is required for raw"))
          const rawPath = params.path.startsWith("http")
            ? params.path
            : `${ctx.apiBase}/${params.path.replace(/^\/+/, "")}`
          return yield* request(
            params,
            toolCtx,
            method,
            rawPath,
            method === "GET" ? undefined : params.data,
            params.query ?? {},
            false,
          )
        }
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) => execute(params, ctx).pipe(Effect.orDie),
    }
  }),
)
