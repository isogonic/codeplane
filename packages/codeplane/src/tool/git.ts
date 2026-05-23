import path from "path"
import { Effect, Schema } from "effect"
import { Auth } from "@/auth"
import { Config, ConfigGit } from "@/config"
import { InstanceState } from "@/effect"
import { Git } from "@/git"
import { Question } from "@/question"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./git.txt"
import * as Tool from "./tool"

const operations = [
  "info",
  "status",
  "diff",
  "log",
  "show",
  "branch",
  "remote",
  "fetch",
  "pull",
  "push",
  "add",
  "restore",
  "commit",
  "merge",
  "rebase",
  "tag",
  "stash",
  "config_set",
  "config_list",
  "credential_set",
  "credential_list",
  "credential_remove",
  "run",
] as const

const providers = ["github", "gitlab", "bitbucket", "azure-devops", "generic"] as const

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "Git operation to perform" }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory for the Git command. Defaults to the current project directory.",
  }),
  instance: Schema.optional(Schema.String).annotate({
    description: "Named Git instance from git config, for example github or company-gitlab.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Name for config_set, credential_set, or credential_remove.",
  }),
  provider: Schema.optional(Schema.Literals(providers)).annotate({
    description: "Git host provider for config_set or credential_set.",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "Git host base URL or remote URL, for example https://github.com.",
  }),
  host: Schema.optional(Schema.String).annotate({
    description: "Git host name, for example github.com or gitlab.company.test.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Username for HTTPS credentials. Defaults by provider when omitted.",
  }),
  token: Schema.optional(Schema.String).annotate({
    description: "Token/password to save for credential_set. Prefer tokenEnv or interactive prompt when possible.",
  }),
  tokenEnv: Schema.optional(Schema.String).annotate({
    description: "Environment variable containing the Git token/password.",
  }),
  sshCommand: Schema.optional(Schema.String).annotate({
    description: "GIT_SSH_COMMAND to use for SSH remotes, for example ssh -i ~/.ssh/id_ed25519.",
  }),
  remote: Schema.optional(Schema.String).annotate({ description: "Remote name, usually origin." }),
  branch: Schema.optional(Schema.String).annotate({ description: "Branch name for branch, fetch, pull, push, etc." }),
  ref: Schema.optional(Schema.String).annotate({ description: "Git revision or range." }),
  message: Schema.optional(Schema.String).annotate({ description: "Commit message for commit operations." }),
  files: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Optional file pathspecs for operations such as status, diff, add, restore, or commit.",
  }),
  args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: 'Raw Git arguments for operation="run", or extra arguments appended to supported operations.',
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum number of log entries. Defaults to 30." }),
  all: Schema.optional(Schema.Boolean).annotate({ description: "Include all branches or all tracked files." }),
  setUpstream: Schema.optional(Schema.Boolean).annotate({ description: "Use -u/--set-upstream for push." }),
})

type Params = Schema.Schema.Type<typeof Parameters>
type Provider = (typeof providers)[number]

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

function defaultUsername(provider: Provider, username?: string) {
  if (username) return username
  if (provider === "gitlab") return "oauth2"
  if (provider === "azure-devops") return "azdo"
  return "x-access-token"
}

function credentialKey(name: string) {
  return `git:${name}`
}

function redactConfig(input: ConfigGit.Info | undefined) {
  return Object.fromEntries(
    Object.entries(input ?? {}).map(([name, item]) => [
      name,
      {
        ...item,
        credential: item.credential
          ? {
              ...item.credential,
              key: item.credential.key ? "<stored>" : undefined,
              env: item.credential.env ? item.credential.env : undefined,
            }
          : undefined,
      },
    ]),
  )
}

function pathspec(files: string[] | undefined) {
  if (!files?.length) return []
  return ["--", ...files]
}

function commandMetadata(args: string[]) {
  return [
    "git",
    ...args.map((arg) => (/(authorization|credential|password|token|extraheader)/i.test(arg) ? "<redacted>" : arg)),
  ]
}

const CODEPLANE_COAUTHOR_TRAILER =
  "Co-Authored-By: codeplane-agent[bot] <287208015+codeplane-agent[bot]@users.noreply.github.com>"
const CODEPLANE_COAUTHOR_PATTERN =
  /^Co-authored-by:\s*(?:Codeplane|codeplaneai\[bot\]|codeplane-agent\[bot\])\s*<[^>]+>\s*$/im

function withCodeplaneCoauthor(message: string) {
  if (CODEPLANE_COAUTHOR_PATTERN.test(message)) return message
  return `${message.trimEnd()}\n\n${CODEPLANE_COAUTHOR_TRAILER}`
}

function withCodeplaneCoauthorArgs(args: string[]) {
  if (args[0] !== "commit") return args
  if (args.some((arg) => CODEPLANE_COAUTHOR_PATTERN.test(arg))) return args
  return [...args, "--trailer", CODEPLANE_COAUTHOR_TRAILER]
}

export const GitTool = Tool.define<
  typeof Parameters,
  Record<string, unknown>,
  Auth.Service | Config.Service | Git.Service | Question.Service
>(
  "git",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const git = yield* Git.Service
    const question = yield* Question.Service

    const cwd = Effect.fn("GitTool.cwd")(function* (params: Params, ctx: Tool.Context) {
      const ins = yield* InstanceState.context
      const result = AppFileSystem.resolve(
        path.isAbsolute(params.cwd ?? ins.directory)
          ? (params.cwd ?? ins.directory)
          : path.join(ins.directory, params.cwd ?? "."),
      )
      yield* assertExternalDirectoryEffect(ctx, result, { kind: "directory" })
      return result
    })

    const remoteUrl = Effect.fn("GitTool.remoteUrl")(function* (dir: string, remote = "origin") {
      const result = yield* git.run(["remote", "get-url", remote], { cwd: dir })
      if (result.exitCode !== 0) return
      return result.text().trim() || undefined
    })

    const configuredInstance = Effect.fn("GitTool.configuredInstance")(function* (params: Params, dir: string) {
      const cfg = (yield* config.get()).git ?? {}
      if (params.instance && cfg[params.instance]) {
        return [params.instance, cfg[params.instance]] as [string, ConfigGit.Instance]
      }

      const host =
        params.host?.toLowerCase() ??
        hostFromRemote(params.url) ??
        hostFromRemote(yield* remoteUrl(dir, params.remote ?? "origin"))
      if (!host) return

      return Object.entries(cfg).find(([, item]) => {
        const hosts = [hostFromRemote(item.url), ...(item.hosts ?? []).map((entry) => entry.toLowerCase())].filter(
          (entry): entry is string => Boolean(entry),
        )
        return hosts.includes(host)
      }) as [string, ConfigGit.Instance] | undefined
    })

    const authContext = Effect.fn("GitTool.authContext")(function* (params: Params, dir: string) {
      const found = yield* configuredInstance(params, dir)
      if (!found)
        return { args: [] as string[], env: {} as Record<string, string>, instance: undefined as string | undefined }

      const [name, item] = found
      const provider = item.provider ?? providerFromHost(hostFromRemote(item.url))
      const credential = item.credential
      if (credential?.type === "ssh" && credential.sshCommand) {
        return { args: [] as string[], env: { GIT_SSH_COMMAND: credential.sshCommand }, instance: name }
      }

      const token =
        credential?.type === "env" && credential.env
          ? process.env[credential.env]
          : credential?.type === "stored" && credential.key
            ? yield* auth.get(credential.key).pipe(Effect.map((item) => (item?.type === "api" ? item.key : undefined)))
            : undefined
      if (!token) return { args: [] as string[], env: {} as Record<string, string>, instance: name }

      return {
        args: [
          "-c",
          `http.${normalizeBaseUrl(item.url)}/.extraheader=AUTHORIZATION: basic ${Buffer.from(
            `${defaultUsername(provider, credential?.username)}:${token}`,
          ).toString("base64")}`,
        ],
        env: {} as Record<string, string>,
        instance: name,
      }
    })

    const runGit = Effect.fn("GitTool.runGit")(function* (
      params: Params,
      ctx: Tool.Context,
      args: string[],
      title: string,
    ) {
      const dir = yield* cwd(params, ctx)
      yield* ctx.ask({
        permission: "git",
        patterns: [params.operation],
        always: [params.operation],
        metadata: {
          operation: params.operation,
          command: commandMetadata(args),
          cwd: dir,
          remote: params.remote,
          branch: params.branch,
          ref: params.ref,
        },
      })

      const authInfo = yield* authContext(params, dir)
      const result = yield* git.run([...authInfo.args, ...args], { cwd: dir, env: authInfo.env })
      const output = [result.text(), result.stderr.toString()].filter(Boolean).join("\n").trim()
      const display = commandMetadata(args).join(" ")
      if (result.exitCode !== 0) {
        return yield* Effect.fail(new Error(output || `${display} failed with exit ${result.exitCode}`))
      }

      return {
        title,
        output: output || `${display} completed`,
        metadata: {
          operation: params.operation,
          command: commandMetadata(args),
          exitCode: result.exitCode,
          instance: authInfo.instance,
        },
      }
    })

    const askToken = Effect.fn("GitTool.askToken")(function* (params: Params, ctx: Tool.Context, name: string) {
      if (params.token) return params.token
      if (params.tokenEnv) return

      const answers = yield* question.ask({
        sessionID: ctx.sessionID,
        questions: [
          {
            header: "Git token",
            question: `Enter the Git token/password for ${name}. It will be saved in the local codeplane auth store with filesystem permissions restricted to the current user.`,
            options: [],
            custom: true,
          },
        ],
        tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
      })
      return answers[0]?.[0]?.trim() || undefined
    })

    const saveConfig = Effect.fn("GitTool.saveConfig")(function* (
      params: Params,
      ctx: Tool.Context,
      options?: { credential?: ConfigGit.Credential },
    ) {
      yield* ctx.ask({
        permission: "git",
        patterns: [params.operation],
        always: [params.operation],
        metadata: {
          operation: params.operation,
          name: params.name,
          host: params.host,
          url: params.url,
          provider: params.provider,
          credential: options?.credential?.type ?? (params.sshCommand ? "ssh" : undefined),
        },
      })

      const host = params.host?.toLowerCase() ?? hostFromRemote(params.url)
      const name = params.name ?? host
      if (!name) return yield* Effect.fail(new Error("name, host, or url is required"))
      const url = normalizeBaseUrl(params.url ?? `https://${host ?? name}`)
      const provider = params.provider ?? providerFromHost(hostFromRemote(url))

      const instance: ConfigGit.Instance = {
        url,
        provider,
        hosts: [...new Set([hostFromRemote(url), host].filter((entry): entry is string => Boolean(entry)))],
        defaultRemote: params.remote,
        credential:
          options?.credential ?? (params.sshCommand ? { type: "ssh", sshCommand: params.sshCommand } : undefined),
      }
      yield* config.updateGlobal({ git: { [name]: instance } } as Config.Info)
      return { name, instance }
    })

    const saveCredential = Effect.fn("GitTool.saveCredential")(function* (params: Params, ctx: Tool.Context) {
      const host = params.host?.toLowerCase() ?? hostFromRemote(params.url)
      const name = params.name ?? host
      if (!name) return yield* Effect.fail(new Error("name, host, or url is required"))
      const token = params.sshCommand ? undefined : yield* askToken(params, ctx, name)

      const credential: ConfigGit.Credential = params.sshCommand
        ? { type: "ssh", sshCommand: params.sshCommand, username: params.username }
        : params.tokenEnv
          ? { type: "env", env: params.tokenEnv, username: params.username }
          : token
            ? { type: "stored", key: credentialKey(name), username: params.username }
            : { type: "none" }

      if (token) {
        yield* auth.set(
          credentialKey(name),
          new Auth.Api({
            type: "api",
            key: token,
            metadata: {
              kind: "git",
              name,
              host: host ?? "",
              provider: params.provider ?? providerFromHost(host),
              username: params.username ?? "",
            },
          }),
        )
      }

      const saved = yield* saveConfig(params, ctx, { credential })
      return {
        title: `git credential ${saved.name}`,
        output:
          credential.type === "stored"
            ? `Saved Git credential for ${saved.name} in the local auth store.`
            : credential.type === "env"
              ? `Saved Git credential reference for ${saved.name}; token will be read from ${credential.env}.`
              : credential.type === "ssh"
                ? `Saved Git SSH command for ${saved.name}.`
                : `Saved Git host ${saved.name} without a credential.`,
        metadata: { operation: params.operation, name: saved.name, credential: credential.type },
      }
    })

    const execute = Effect.fn("GitTool.execute")(function* (params: Params, ctx: Tool.Context) {
      switch (params.operation) {
        case "info": {
          const dir = yield* cwd(params, ctx)
          yield* ctx.ask({
            permission: "git",
            patterns: [params.operation],
            always: [params.operation],
            metadata: { operation: params.operation, cwd: dir },
          })
          const [branch, base, status, remotes] = yield* Effect.all(
            [
              git.branch(dir),
              git.defaultBranch(dir),
              git.run(["status", "--short", "--branch", "--untracked-files=all", ...pathspec(params.files)], {
                cwd: dir,
              }),
              git.run(["remote", "-v"], { cwd: dir }),
            ],
            { concurrency: "unbounded" },
          )
          return {
            title: "git info",
            output: [
              `branch: ${branch ?? "(detached)"}`,
              `default: ${base?.ref ?? "(unknown)"}`,
              "",
              "<status>",
              status.text().trim() || "clean",
              "</status>",
              "",
              "<remotes>",
              remotes.text().trim() || "(none)",
              "</remotes>",
            ].join("\n"),
            metadata: { operation: params.operation, branch, defaultBranch: base?.ref },
          }
        }
        case "status":
          return yield* runGit(
            params,
            ctx,
            [
              "status",
              "--short",
              "--branch",
              "--untracked-files=all",
              ...pathspec(params.files),
              ...(params.args ?? []),
            ],
            "git status",
          )
        case "diff":
          return yield* runGit(
            params,
            ctx,
            [
              "diff",
              "--no-ext-diff",
              ...(params.ref ? [params.ref] : []),
              ...pathspec(params.files),
              ...(params.args ?? []),
            ],
            "git diff",
          )
        case "log":
          return yield* runGit(
            params,
            ctx,
            [
              "log",
              "--decorate",
              "--oneline",
              `-${Math.max(1, Math.min(200, params.limit ?? 30))}`,
              ...(params.all ? ["--all"] : []),
              ...(params.ref ? [params.ref] : []),
              ...(params.args ?? []),
            ],
            "git log",
          )
        case "show":
          return yield* runGit(
            params,
            ctx,
            ["show", "--stat", "--patch", "--no-ext-diff", ...(params.ref ? [params.ref] : []), ...(params.args ?? [])],
            "git show",
          )
        case "branch":
          return yield* runGit(
            params,
            ctx,
            params.args?.length
              ? ["branch", ...params.args]
              : [
                  "branch",
                  "--all",
                  "--verbose",
                  "--no-abbrev",
                  ...(params.branch ? ["--contains", params.branch] : []),
                ],
            "git branch",
          )
        case "remote":
          return yield* runGit(
            params,
            ctx,
            params.args?.length ? ["remote", ...params.args] : ["remote", "-v"],
            "git remote",
          )
        case "fetch":
          return yield* runGit(
            params,
            ctx,
            [
              "fetch",
              params.branch ? (params.remote ?? "origin") : (params.remote ?? "--all"),
              ...(params.branch ? [params.branch] : []),
              ...(params.args ?? []),
            ],
            "git fetch",
          )
        case "pull":
          return yield* runGit(
            params,
            ctx,
            [
              "pull",
              ...(params.remote ? [params.remote] : []),
              ...(params.branch ? [params.branch] : []),
              ...(params.args ?? []),
            ],
            "git pull",
          )
        case "push":
          return yield* runGit(
            params,
            ctx,
            [
              "push",
              ...(params.setUpstream ? ["-u"] : []),
              ...(params.remote ? [params.remote] : []),
              ...(params.branch ? [params.branch] : []),
              ...(params.args ?? []),
            ],
            "git push",
          )
        case "add":
          return yield* runGit(
            params,
            ctx,
            ["add", ...(params.files?.length ? params.files : ["."]), ...(params.args ?? [])],
            "git add",
          )
        case "restore":
          return yield* runGit(
            params,
            ctx,
            ["restore", ...pathspec(params.files), ...(params.args ?? [])],
            "git restore",
          )
        case "commit":
          if (!params.message) return yield* Effect.fail(new Error("message is required for git commit"))
          const message = (yield* config.get()).commit?.coauthor ? withCodeplaneCoauthor(params.message) : params.message
          return yield* runGit(
            params,
            ctx,
            [
              "commit",
              ...(params.all ? ["-a"] : []),
              "-m",
              message,
              ...pathspec(params.files),
              ...(params.args ?? []),
            ],
            "git commit",
          )
        case "merge":
          if (!params.ref) return yield* Effect.fail(new Error("ref is required for git merge"))
          return yield* runGit(params, ctx, ["merge", params.ref, ...(params.args ?? [])], "git merge")
        case "rebase":
          if (!params.ref) return yield* Effect.fail(new Error("ref is required for git rebase"))
          return yield* runGit(params, ctx, ["rebase", params.ref, ...(params.args ?? [])], "git rebase")
        case "tag":
          return yield* runGit(params, ctx, ["tag", ...(params.args ?? [])], "git tag")
        case "stash":
          return yield* runGit(params, ctx, ["stash", ...(params.args ?? ["list"])], "git stash")
        case "config_set": {
          const saved = yield* saveConfig(params, ctx)
          return {
            title: `git config ${saved.name}`,
            output: `Saved Git instance ${saved.name} for ${saved.instance.url}.`,
            metadata: { operation: params.operation, name: saved.name },
          }
        }
        case "config_list": {
          const cfg = (yield* config.get()).git ?? {}
          return {
            title: "git config",
            output: JSON.stringify(redactConfig(cfg), null, 2),
            metadata: { operation: params.operation, count: Object.keys(cfg).length },
          }
        }
        case "credential_set":
          return yield* saveCredential(params, ctx)
        case "credential_list": {
          const entries = Object.entries(yield* auth.all()).flatMap(([key, item]) => {
            if (!key.startsWith("git:") || item.type !== "api") return []
            return [{ key, metadata: item.metadata ?? {} }]
          })
          return {
            title: "git credentials",
            output: JSON.stringify(entries, null, 2),
            metadata: { operation: params.operation, count: entries.length },
          }
        }
        case "credential_remove": {
          const name = params.name ?? params.host
          if (!name) return yield* Effect.fail(new Error("name or host is required for credential_remove"))
          yield* ctx.ask({
            permission: "git",
            patterns: [params.operation],
            always: [params.operation],
            metadata: { operation: params.operation, name },
          })
          yield* auth.remove(credentialKey(name))
          const cfg = (yield* config.get()).git?.[name]
          if (cfg)
            yield* config.updateGlobal({ git: { [name]: { ...cfg, credential: { type: "none" } } } } as Config.Info)
          return {
            title: `git credential ${name}`,
            output: `Removed Git credential for ${name}.`,
            metadata: { operation: params.operation, name },
          }
        }
        case "run":
          if (!params.args?.length) return yield* Effect.fail(new Error('args is required for operation="run"'))
          return yield* runGit(
            params,
            ctx,
            (yield* config.get()).commit?.coauthor ? withCodeplaneCoauthorArgs(params.args) : params.args,
            `git ${params.args[0]}`,
          )
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) => execute(params, ctx).pipe(Effect.orDie),
    }
  }),
)
