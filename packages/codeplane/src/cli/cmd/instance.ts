import { localInstanceUrl, type LocalStatus, type SavedInstance } from "@codeplane-ai/shared/instance"
import type { State as InstanceState } from "@codeplane-ai/shared/instance-store"
import {
  fetchCodeplaneLatestVersion,
  fetchCodeplaneVersions,
  readPreferredLocalVersion,
  resolveLocalBinaryPath,
} from "@codeplane-ai/shared/local-runtime"
import type { LocalTarget } from "@codeplane-ai/shared/instance"
import { Global } from "@/global"
import path from "path"
import open from "open"
import { createInterface } from "node:readline"
import { createInstanceService } from "../../tui/instance-service"
import { normalizeInstanceUrl } from "../../tui/client"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { InstanceDaemonCommand } from "./instance-daemon"
import type { Argv } from "yargs"

type InstanceListArgs = {
  json?: boolean
  type?: "local" | "remote"
}

type InstanceAddArgs = {
  header?: string[]
  id?: string
  ignoreCertificateErrors?: boolean
  label?: string
  local?: boolean
  setDefault?: boolean
  target?: string
  "runtime-version"?: string
  username?: string
  password?: string
}

type InstanceIDArgs = {
  id: string
}

type InstanceProbeArgs = {
  json?: boolean
  target: string
}

type InstanceLocalVersionArgs = {
  pathOnly?: boolean
  version?: string
}

type InstanceLocalTargetArgs = {
  binaryName?: boolean
  nameOnly?: boolean
}

type InstanceLocalVersionsArgs = {
  limit?: number
  tag?: string
}

// Combine --header lines with the dedicated --username / --password fields.
// Username/password compose into an Authorization: Basic … header that
// overrides any Authorization line in --header (the explicit field wins),
// matching the desktop's saved-instance form behavior.
export function composeRemoteHeaders(input: InstanceAddArgs): Record<string, string> | undefined {
  const headers = parseInstanceHeaders(input.header)
  const user = (input.username ?? "").trim()
  const pass = input.password ?? ""
  if (user || pass) {
    const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization")
    if (authKey) delete headers[authKey]
    headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`
  }
  return Object.keys(headers).length ? headers : undefined
}

export function parseInstanceHeaders(input: string[] = []) {
  return input.reduce<Record<string, string>>((result, item) => {
    const divider = item.indexOf(":")
    if (divider <= 0) throw new Error(`Invalid header "${item}". Use name:value.`)
    const key = item.slice(0, divider).trim()
    const value = item.slice(divider + 1).trim()
    if (!key) throw new Error(`Invalid header "${item}". Use name:value.`)
    if (!value) throw new Error(`Invalid header "${item}". Header values cannot be empty.`)
    if (/[\r\n\0]/.test(key) || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid header "${item}". Header names and values cannot contain control characters.`)
    }
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) throw new Error(`Invalid header "${item}". Header name is not valid.`)
    return {
      ...result,
      [key]: value,
    }
  }, {})
}

export function applyLocalInstanceVersion(state: InstanceState, version: string): InstanceState {
  return {
    ...state,
    instances: state.instances.map((item) => (item.local ? { ...item, local: { binaryVersion: version } } : item)),
  }
}

export function formatInstanceSummary(instance: SavedInstance, lastInstanceID?: string) {
  return {
    id: instance.id,
    default: instance.id === lastInstanceID,
    type: instance.local ? ("local" as const) : ("remote" as const),
    label: instance.label,
    url: instance.url,
    version: instance.local?.binaryVersion,
    headers: Object.keys(instance.headers ?? {}).length,
    ignoreCertificateErrors: Boolean(instance.ignoreCertificateErrors),
  }
}

export function filterInstanceSummaries<T extends { type: "local" | "remote" }>(instances: T[], type?: "local" | "remote") {
  if (!type) return instances
  return instances.filter((item) => item.type === type)
}

function formatJson(input: unknown) {
  return JSON.stringify(input, null, 2)
}

export function formatLocalTarget(target: LocalTarget, nameOnly?: boolean, binaryName?: boolean) {
  if (binaryName) return target.binaryName
  if (nameOnly) return target.packageName ?? target.archiveName.replace(/\.(?:tgz|tar\.gz|zip)$/, "")
  return formatJson(target)
}

export function formatLocalVersions(
  input: { latest?: string; distTags: Record<string, string>; versions: string[] },
  limit = 10,
  tag?: string,
) {
  if (tag) return input.distTags[tag] ?? ""
  const count = Math.min(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10, 100)
  return formatJson({
    latest: input.latest,
    distTags: Object.fromEntries(Object.entries(input.distTags).sort(([left], [right]) => left.localeCompare(right))),
    total: input.versions.length,
    versions: input.versions.slice(0, count),
  })
}

export function formatLocalStatus(status: LocalStatus & { target?: LocalTarget }, pathOnly?: boolean) {
  if (pathOnly) return status.binaryPath
  return formatJson(status)
}

function autoInstanceID(label?: string, kind = "instance") {
  const base = (label || kind).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || kind
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

function instanceByID(instances: SavedInstance[], id: string) {
  const result = instances.find((item) => item.id === id)
  if (!result) throw new Error(`Instance not found: ${id}`)
  return result
}

function printProgress(message: string) {
  UI.println(UI.Style.TEXT_DIM + message + UI.Style.TEXT_NORMAL)
}

async function localVersion(version?: string) {
  return version || (await readPreferredLocalVersion())
}

async function localBinaryPath(version: string) {
  const target = await createInstanceService().localTarget()
  const versionRoot = path.join(Global.Path.local_server_binaries, version)
  return (
    (await resolveLocalBinaryPath(versionRoot, target.binaryName)) ?? path.join(versionRoot, "bin", target.binaryName)
  )
}

async function localStatus(version?: string) {
  const service = createInstanceService()
  const selectedVersion = await localVersion(version)
  const [status, target] = await Promise.all([service.localStatus(selectedVersion), service.localTarget()])
  return {
    ...status,
    target,
  }
}

function formatInstanceTable(instances: ReturnType<typeof formatInstanceSummary>[]) {
  if (instances.length === 0) return "No saved instances."
  const widths = {
    id: Math.max(2, ...instances.map((item) => item.id.length)),
    type: Math.max(4, ...instances.map((item) => item.type.length)),
    label: Math.max(5, ...instances.map((item) => (item.label || "-").length)),
    version: Math.max(7, ...instances.map((item) => (item.version || "-").length)),
  }
  const header = [
    "ID".padEnd(widths.id),
    "Type".padEnd(widths.type),
    "Label".padEnd(widths.label),
    "Version".padEnd(widths.version),
    "URL",
  ].join("  ")
  return [
    header,
    "─".repeat(header.length),
    ...instances.map((item) =>
      [
        `${item.default ? "*" : " "} ${item.id}`.padEnd(widths.id + 2),
        item.type.padEnd(widths.type),
        (item.label || "-").padEnd(widths.label),
        (item.version || "-").padEnd(widths.version),
        item.url,
      ].join("  "),
    ),
  ].join("\n")
}

export const InstanceCommand = cmd({
  command: "instance",
  aliases: ["instances"],
  describe: "manage saved Codeplane instances and the shared local runtime",
  builder: (yargs: Argv) =>
    yargs
      .command(InstanceListCommand)
      .command(InstanceAddCommand)
      .command(InstanceShowCommand)
      .command(InstanceUseCommand)
      .command(InstanceRemoveCommand)
      .command(InstanceProbeCommand)
      .command(InstanceOpenCommand)
      .command(InstanceSignInCommand)
      .command(InstanceDaemonCommand)
      .command(InstanceLocalCommand)
      .demandCommand(),
  async handler() {},
})

export const InstanceListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list saved instances",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON instead of a table",
      })
      .option("type", {
        choices: ["local", "remote"] as const,
        describe: "only list local or remote instances",
      }),
  async handler(args) {
    const input = args as InstanceListArgs
    const service = createInstanceService()
    const state = await service.store.getState()
    const output = filterInstanceSummaries(
      state.instances.map((item) => formatInstanceSummary(item, state.lastInstanceID)),
      input.type,
    )
    if (input.json) {
      console.log(formatJson(output))
      return
    }
    console.log(formatInstanceTable(output))
  },
})

export const InstanceAddCommand = cmd({
  command: "add [target]",
  describe: "save a remote or local instance",
  builder: (yargs: Argv) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "remote URL or host, omitted when --local is used",
      })
      .option("id", {
        type: "string",
        describe: "explicit instance id",
      })
      .option("label", {
        type: "string",
        describe: "display label",
      })
      .option("header", {
        type: "array",
        string: true,
        describe: "repeatable request header in name:value form",
      })
      .option("ignore-certificate-errors", {
        type: "boolean",
        default: false,
        describe: "skip TLS certificate validation for this saved instance",
      })
      .option("username", {
        type: "string",
        describe: "HTTP Basic Auth username for this remote (composes Authorization: Basic …)",
      })
      .option("password", {
        type: "string",
        describe: "HTTP Basic Auth password for this remote (composes Authorization: Basic …)",
      })
      .option("local", {
        type: "boolean",
        default: false,
        describe: "create a shared local runtime entry instead of a remote server",
      })
      .option("set-default", {
        type: "boolean",
        default: false,
        describe: "select the saved instance as the default after adding it",
      })
      .option("runtime-version", {
        type: "string",
        describe: "local runtime version to pin when --local is used",
      }),
  async handler(args) {
    const input = args as InstanceAddArgs
    const service = createInstanceService()
    const version = input.local ? await localVersion(input["runtime-version"]) : undefined
    const id = input.id || autoInstanceID(input.label || input.target, input.local ? "local" : "remote")
    const instance = input.local
      ? {
          id,
          label: input.label || `Local ${version}`,
          url: localInstanceUrl(id),
          local: {
            binaryVersion: version!,
          },
        }
      : {
          id,
          label: input.label,
          url: normalizeInstanceUrl(input.target || "") || "",
          headers: composeRemoteHeaders(input),
          ignoreCertificateErrors: Boolean(input.ignoreCertificateErrors),
        }
    if (!instance.url) throw new Error("A remote target is required unless --local is used.")
    await service.save(instance)
    if (input.setDefault) await service.setLast(id)
    console.log(formatJson(instance))
  },
})

export const InstanceShowCommand = cmd({
  command: "show <id>",
  describe: "show a saved instance record",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved instance id",
    }),
  async handler(args) {
    const service = createInstanceService()
    console.log(formatJson(instanceByID(await service.list(), (args as InstanceIDArgs).id)))
  },
})

export const InstanceUseCommand = cmd({
  command: "use <id>",
  describe: "mark an instance as the default selection",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved instance id",
    }),
  async handler(args) {
    const service = createInstanceService()
    const id = (args as InstanceIDArgs).id
    instanceByID(await service.list(), id)
    await service.setLast(id)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Selected ${id}` + UI.Style.TEXT_NORMAL)
  },
})

export const InstanceRemoveCommand = cmd({
  command: "remove <id>",
  aliases: ["rm", "delete"],
  describe: "remove a saved instance",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved instance id",
    }),
  async handler(args) {
    const service = createInstanceService()
    const id = (args as InstanceIDArgs).id
    instanceByID(await service.list(), id)
    await service.remove(id)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Removed ${id}` + UI.Style.TEXT_NORMAL)
  },
})

export const InstanceProbeCommand = cmd({
  command: "probe <target>",
  describe: "probe a saved instance id or raw URL via /global/version",
  builder: (yargs: Argv) =>
    yargs
      .positional("target", {
        type: "string",
        describe: "saved instance id or a raw URL",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON output",
      }),
  async handler(args) {
    const input = args as InstanceProbeArgs
    const service = createInstanceService()
    const saved = (await service.list()).find((item) => item.id === input.target)
    if (saved?.local) {
      throw new Error(`Local instance ${saved.id} is not directly probeable. Use "codeplane instance open ${saved.id}".`)
    }
    const result = await service.probe(saved ?? input.target)
    if (input.json) {
      console.log(formatJson({ target: saved?.id || input.target, ...result }))
      return
    }
    console.log(
      result.ok
        ? `ok ${saved?.id || input.target} ${result.version || "unknown"}${result.latest ? ` latest ${result.latest}` : ""}`
        : `error ${saved?.id || input.target} ${result.status ? `HTTP ${result.status}` : result.error}`,
    )
    if (!result.ok) process.exitCode = 1
  },
})

// Browser-assisted sign-in for instances behind an interactive auth proxy
// (Cloudflare Access, identity-aware proxy, custom SSO). The Desktop app
// already has a fully-automated equivalent that uses Electron's
// BrowserWindow + session.cookies to capture the auth token without the
// user copy-pasting anything. The TUI has no Electron, so we settle for
// browser-assisted: we open the auth URL in the user's default browser
// and wait on stdin for them to paste the cookie / Authorization header
// they captured from DevTools. The pasted value is saved as a header on
// the instance, replacing any previous auth header. Subsequent
// `codeplane instance open <id>` calls then use that header to satisfy
// the auth proxy.
//
// Why this isn't just `instance add --header "Cookie: ..."`:
//   - Discoverability: most users won't know they need a Cookie header
//     until they hit a 401 / get redirected to a login page in the
//     existing flow. This subcommand surfaces the flow explicitly.
//   - URL launch: `open <url>` is the right verb for "go authenticate"
//     and saves the user from copy-pasting the URL.
//   - Validation: after the user pastes, we re-probe the instance with
//     the new header. If it still fails we tell them what went wrong
//     (still 401? redirect? wrong header name?) instead of letting them
//     discover at next `tui` time.
export const InstanceSignInCommand = cmd({
  command: "sign-in <id>",
  describe: "open the saved instance URL in your browser and capture the auth header",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved instance id (must already exist; use `instance add <url>` first)",
    }),
  async handler(args) {
    const id = (args as InstanceIDArgs).id
    // Helper: clean stderr message + exit 1, used for every user-facing
    // validation error. Throwing from the yargs handler routes through
    // the global error-handler chain in src/index.ts which prepends
    // "Unexpected error, check log file …" — misleading for what are
    // actually self-explanatory user errors (no such instance, local
    // runtime, bad header form, etc.). Direct exit keeps the message
    // single-line and obvious.
    const fail = (message: string): never => {
      UI.println(UI.Style.TEXT_DANGER_BOLD + message)
      process.exit(1)
    }

    const service = createInstanceService()
    const list = await service.list()
    const saved = list.find((item) => item.id === id)
    if (!saved) {
      fail(
        `No saved instance with id "${id}". Use \`codeplane instance list\` to see what exists, or \`codeplane instance add <url>\` to create one.`,
      )
    }
    if (saved!.local) {
      fail(
        `Instance "${id}" is a local managed runtime — there's no auth proxy to sign into. ` +
          `Browser sign-in only applies to remote instances behind Cloudflare Access / SSO / similar.`,
      )
    }
    if (!saved!.url) {
      fail(`Saved instance "${id}" has no URL. Re-add it via \`codeplane instance add <url>\`.`)
    }

    UI.println(UI.Style.TEXT_INFO_BOLD + `\nOpening ${saved!.url} in your default browser…`)
    UI.println(UI.Style.TEXT_NORMAL + "After signing in, capture the auth value from your browser DevTools:")
    UI.println(UI.Style.TEXT_NORMAL + "  • Cloudflare Access:  Application → Cookies → CF_Authorization → copy value")
    UI.println(UI.Style.TEXT_NORMAL + "                        Paste as:  Cookie: CF_Authorization=<value>")
    UI.println(UI.Style.TEXT_NORMAL + "  • Bearer token (SSO): Network tab → Authorization request header → copy")
    UI.println(UI.Style.TEXT_NORMAL + "                        Paste as:  Authorization: Bearer <token>")
    UI.println(UI.Style.TEXT_NORMAL + "  • Service token:      Paste as:  Authorization: <provider-specific>")
    UI.println(UI.Style.TEXT_NORMAL + "")
    UI.println(UI.Style.TEXT_INFO_BOLD + "Paste the full header line (NAME: VALUE) below, then press Enter.")
    UI.println(UI.Style.TEXT_DIM + "(Empty line cancels.)")
    UI.println(UI.Style.TEXT_NORMAL + "")

    await open(saved!.url).catch(() => undefined)

    const headerLine = await new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question("> ", (answer) => {
        rl.close()
        resolve(answer.trim())
      })
    })
    if (!headerLine) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "Cancelled. Instance unchanged.")
      return
    }

    const colon = headerLine.indexOf(":")
    if (colon <= 0) {
      fail(`Invalid header "${headerLine}". Use the form  NAME: VALUE.`)
    }
    const headerName = headerLine.slice(0, colon).trim()
    const headerValue = headerLine.slice(colon + 1).trim()
    if (!headerName || !headerValue) {
      fail(`Invalid header "${headerLine}". Both NAME and VALUE must be non-empty.`)
    }

    // Replace any existing header with the same name (case-insensitive)
    // so re-running sign-in cleanly overwrites a stale cookie. Other
    // headers stay (e.g. an X-API-Key the user might have configured
    // alongside CF Access).
    const existing = saved!.headers ?? {}
    const filtered = Object.fromEntries(
      Object.entries(existing).filter(([k]) => k.toLowerCase() !== headerName.toLowerCase()),
    )
    const updated: SavedInstance = {
      ...saved!,
      headers: { ...filtered, [headerName]: headerValue },
    }
    await service.save(updated)

    UI.println(UI.Style.TEXT_INFO_BOLD + `\nProbing ${saved!.url} with the new header…`)
    const probed = await service.probe(updated)
    if (probed.ok && probed.version) {
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `✓ Authenticated. Server v${probed.version} is reachable. Saved on instance "${id}".`,
      )
      return
    }
    if (probed.ok && !probed.version) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD +
          `Header saved, but the response wasn't a version JSON — the auth proxy may still be redirecting to a login page.\n` +
          `Try a fresh sign-in: clear cookies, re-run \`codeplane instance sign-in ${id}\`, and capture the cookie immediately after the auth flow completes.`,
      )
      process.exitCode = 1
      return
    }
    const detail = !probed.ok
      ? probed.status
        ? `HTTP ${probed.status}`
        : probed.error
      : "(unknown)"
    UI.println(
      UI.Style.TEXT_DANGER_BOLD +
        `\n✗ Probe still failed: ${detail}\n` +
        `Header was saved on instance "${id}" anyway. To inspect: \`codeplane instance show ${id}\`.\n` +
        `If the value is correct, the auth proxy may require additional headers (Cookie + Authorization, or multiple cookies).`,
    )
    process.exitCode = 1
  },
})

export const InstanceOpenCommand = cmd({
  command: "open <id>",
  describe: "resolve and open a saved instance, starting a local runtime when needed",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved instance id",
    }),
  async handler(args) {
    const service = createInstanceService()
    const saved = instanceByID(await service.list(), (args as InstanceIDArgs).id)
    const result = await service.open(saved, (progress) => printProgress(`${progress.percent}% ${progress.message}`))
    console.log(
      formatJson({
        id: saved.id,
        label: saved.label,
        savedUrl: saved.url,
        liveUrl: result.live.url,
        version: result.version,
        path: result.path,
      }),
    )
  },
})

export const InstanceLocalCommand = cmd({
  command: "local",
  describe: "manage the npm-backed shared local Codeplane runtime",
  builder: (yargs: Argv) =>
    yargs
      .command(InstanceLocalTargetCommand)
      .command(InstanceLocalVersionsCommand)
      .command(InstanceLocalStatusCommand)
      .command(InstanceLocalInstallCommand)
      .command(InstanceLocalUpdateCommand)
      .demandCommand(),
  async handler() {},
})

export const InstanceLocalTargetCommand = cmd({
  command: "target",
  describe: "show the resolved npm package target for this machine",
  builder: (yargs: Argv) =>
    yargs.option("name-only", {
      type: "boolean",
      default: false,
      describe: "print only the npm package name",
    }).option("binary-name", {
      type: "boolean",
      default: false,
      describe: "print only the platform binary name",
    }),
  async handler(args) {
    const input = args as InstanceLocalTargetArgs
    console.log(formatLocalTarget(await createInstanceService().localTarget(), input.nameOnly, input.binaryName))
  },
})

export const InstanceLocalVersionsCommand = cmd({
  command: "versions",
  describe: "list npm-published local runtime versions",
  builder: (yargs: Argv) =>
    yargs.option("limit", {
      type: "number",
      default: 10,
      describe: "maximum number of versions to print",
    }).option("tag", {
      type: "string",
      describe: "print only one npm dist-tag version",
    }),
  async handler(args) {
    const input = args as InstanceLocalVersionsArgs
    console.log(formatLocalVersions(await fetchCodeplaneVersions(), input.limit, input.tag))
  },
})

export const InstanceLocalStatusCommand = cmd({
  command: "status [version]",
  describe: "show whether a local runtime version is installed",
  builder: (yargs: Argv) =>
    yargs
      .positional("version", {
        type: "string",
        describe: "runtime version, defaults to the shared preferred version",
      })
      .option("path-only", {
        type: "boolean",
        default: false,
        describe: "print only the resolved runtime binary path",
      }),
  async handler(args) {
    const input = args as InstanceLocalVersionArgs
    console.log(formatLocalStatus(await localStatus(input.version), input.pathOnly))
  },
})

export const InstanceLocalInstallCommand = cmd({
  command: "install [version]",
  describe: "install the shared local runtime from npm",
  builder: (yargs: Argv) =>
    yargs.positional("version", {
      type: "string",
      describe: "runtime version, defaults to the shared preferred version",
    }),
  async handler(args) {
    const service = createInstanceService()
    const version = await localVersion((args as InstanceLocalVersionArgs).version)
    const result = await service.installLocal(version, (progress) => printProgress(`${progress.percent}% ${progress.message}`))
    console.log(
      formatJson({
        ...result,
        binaryPath: await localBinaryPath(version),
      }),
    )
  },
})

export const InstanceLocalUpdateCommand = cmd({
  command: "update",
  describe: "install the latest npm runtime and repoint saved local instances to it",
  async handler() {
    const service = createInstanceService()
    const version = await fetchCodeplaneLatestVersion()
    const result = await service.installLocal(version, (progress) => printProgress(`${progress.percent}% ${progress.message}`))
    const next = applyLocalInstanceVersion(await service.store.getState(), version)
    await service.store.replace(next)
    console.log(
      formatJson({
        ...result,
        binaryPath: await localBinaryPath(version),
        updatedLocalInstances: next.instances.filter((item) => item.local).length,
      }),
    )
  },
})
