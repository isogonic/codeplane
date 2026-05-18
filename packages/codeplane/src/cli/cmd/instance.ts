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
import semver from "semver"
import { createInstanceService } from "../../tui/instance-service"
import { normalizeInstanceUrl } from "../../tui/client"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { InstanceDaemonCommand } from "./instance-daemon"
import type { Argv } from "yargs"

type InstanceListArgs = {
  countOnly?: boolean
  defaultOnly?: boolean
  idOnly?: boolean
  json?: boolean
  jsonLines?: boolean
  labelOnly?: boolean
  tlsSkippedOnly?: boolean
  tlsVerifyOnly?: boolean
  type?: "local" | "remote"
  urlOnly?: boolean
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
  countOnly?: boolean
  jsonLines?: boolean
  latestOnly?: boolean
  limit?: number
  major?: number
  newestOnly?: boolean
  oldestOnly?: boolean
  prereleaseOnly?: boolean
  stableOnly?: boolean
  tag?: string
  tagOnly?: boolean
  versionOnly?: boolean
}

const LOCAL_RUNTIME_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const LOCAL_RUNTIME_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const normalizeLocalRuntimeVersion = (version: string) => version.trim().replace(/^[vV](?=\d)/, "")

// Combine --header lines with the dedicated --username / --password fields.
// Username/password compose into an Authorization: Basic … header that
// overrides any Authorization line in --header (the explicit field wins),
// matching the desktop's saved-instance form behavior.
export function composeRemoteHeaders(input: InstanceAddArgs): Record<string, string> | undefined {
  const headers = parseInstanceHeaders(input.header)
  const user = (input.username ?? "").trim()
  const pass = input.password ?? ""
  if (!user && pass) throw new Error("Use --password with --username for HTTP Basic Auth.")
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
    if (/[\x00-\x1F\x7F]/.test(key) || /[\x00-\x1F\x7F]/.test(value)) {
      throw new Error(`Invalid header "${item}". Header names and values cannot contain control characters.`)
    }
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) throw new Error(`Invalid header "${item}". Header name is not valid.`)
    const existingKey = Object.keys(result).find((name) => name.toLowerCase() === key.toLowerCase())
    if (existingKey) delete result[existingKey]
    return {
      ...result,
      [key]: value,
    }
  }, {})
}

export function applyLocalInstanceVersion(state: InstanceState, version: string): InstanceState {
  return {
    ...state,
    instances: state.instances.map((item) => (item.local ? { ...item, local: { ...item.local, binaryVersion: version } } : item)),
  }
}

export function localInstanceVersions(state: InstanceState) {
  return Array.from(new Set(state.instances.flatMap((item) => (item.local ? [item.local.binaryVersion] : []))))
    .filter((version): version is string => typeof version === "string" && LOCAL_RUNTIME_VERSION_PATTERN.test(version) && Boolean(semver.valid(version)))
    .sort(semver.rcompare)
}

export function validateInstanceID(id: string) {
  const trimmed = id.trim()
  if (!trimmed) throw new Error("Instance id cannot be empty.")
  if (trimmed === "." || trimmed === "..") throw new Error("Instance id cannot be . or ...")
  if (trimmed.length > 80) throw new Error("Instance id cannot exceed 80 characters.")
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error("Instance id can only contain letters, numbers, dots, underscores, and dashes.")
  }
  return trimmed
}

export function validateLocalRuntimeVersion(version: string) {
  const trimmed = normalizeLocalRuntimeVersion(version)
  if (!LOCAL_RUNTIME_VERSION_PATTERN.test(trimmed) || !semver.valid(trimmed)) {
    throw new Error(`Invalid local runtime version "${version}". Expected semver like 28.2.1 or 28.2.1-rc.0.`)
  }
  return trimmed
}

export function mergeSignedInHeader(existing: Record<string, string> | undefined, headerLine: string) {
  const parsed = parseInstanceHeaders([headerLine])
  const [headerName, headerValue] = Object.entries(parsed)[0]
  const filtered = Object.fromEntries(
    Object.entries(existing ?? {}).filter(([key]) => key.toLowerCase() !== headerName.toLowerCase()),
  )
  return { ...filtered, [headerName]: headerValue }
}

export function formatInstanceSummary(instance: SavedInstance, lastInstanceID?: string) {
  return {
    id: instance.id,
    default: instance.id === lastInstanceID,
    type: instance.local ? ("local" as const) : ("remote" as const),
    label: instance.label,
    url: instance.url,
    version: instance.local?.binaryVersion,
    headers: Object.values(instance.headers ?? {}).filter((value) => value.trim()).length,
    ignoreCertificateErrors: Boolean(instance.ignoreCertificateErrors),
  }
}

export function filterInstanceSummaries<T extends { type: "local" | "remote" }>(instances: T[], type?: string) {
  if (!type) return instances
  if (type !== "local" && type !== "remote") throw new Error(`Invalid instance type "${type}". Use local or remote.`)
  return instances.filter((item) => item.type === type)
}

export function filterDefaultInstanceSummaries<T extends { default?: boolean }>(instances: T[], defaultOnly?: boolean) {
  if (!defaultOnly) return instances
  return instances.filter((item) => item.default)
}

export function filterTlsSkippedInstanceSummaries<T extends { ignoreCertificateErrors?: boolean }>(
  instances: T[],
  tlsSkippedOnly?: boolean,
) {
  if (!tlsSkippedOnly) return instances
  return instances.filter((item) => item.ignoreCertificateErrors)
}

export function filterTlsVerifyInstanceSummaries<T extends { ignoreCertificateErrors?: boolean }>(
  instances: T[],
  tlsVerifyOnly?: boolean,
) {
  if (!tlsVerifyOnly) return instances
  return instances.filter((item) => !item.ignoreCertificateErrors)
}

export function formatInstanceIDs(instances: { id: string }[]) {
  return instances.map((item) => item.id).join("\n")
}

export function formatInstanceURLs(instances: { url: string }[]) {
  return instances.map((item) => item.url.trim()).filter(Boolean).join("\n")
}

export function formatInstanceLabels(instances: { id: string; label?: string }[]) {
  return instances.map((item) => item.label?.trim() || item.id).join("\n")
}

export function formatInstanceCount(instances: unknown[]) {
  return String(instances.length)
}

export function formatInstanceJsonLines(instances: unknown[]) {
  return instances.map((item) => JSON.stringify(item)).join("\n")
}

export function validateInstanceListOutput(input: InstanceListArgs) {
  if (input.tlsSkippedOnly && input.tlsVerifyOnly) throw new Error("Use either --tls-skipped-only or --tls-verify-only, not both.")
  const modes = [
    input.json ? "--json" : undefined,
    input.jsonLines ? "--json-lines" : undefined,
    input.idOnly ? "--id-only" : undefined,
    input.labelOnly ? "--label-only" : undefined,
    input.urlOnly ? "--url-only" : undefined,
    input.countOnly ? "--count-only" : undefined,
  ].filter((mode): mode is string => Boolean(mode))
  if (modes.length > 1) throw new Error(`Use only one instance list output mode: ${modes.join(", ")}.`)
}

function formatJson(input: unknown) {
  return JSON.stringify(input, null, 2)
}

export function formatLocalTarget(target: LocalTarget, nameOnly?: boolean, binaryName?: boolean) {
  if (nameOnly && binaryName) throw new Error("Use either --name-only or --binary-name, not both.")
  const packageName = target.packageName ?? target.archiveName.replace(/\.(?:tgz|tar\.gz|zip)$/, "")
  const variants = packageName.split("-").slice(3)
  if (binaryName) return target.binaryName
  if (nameOnly) return packageName
  return formatJson({
    ...target,
    packageName,
    platform: [target.os, target.arch, ...variants].join("/"),
    variantCount: variants.length,
    variants,
  })
}

export function normalizeLocalVersionMajor(major?: number) {
  if (major === undefined) return undefined
  if (!Number.isSafeInteger(major) || major < 0) throw new Error(`Invalid major version "${major}". Use a non-negative safe integer.`)
  return major
}

export function formatLocalVersions(
  input: { latest?: string; distTags?: unknown; registry?: string; versions?: unknown },
  limit = 10,
  tag?: string,
  major?: number,
  latestOnly?: boolean,
  tagOnly?: boolean,
  stableOnly?: boolean,
  prereleaseOnly?: boolean,
  versionOnly?: boolean,
  countOnly?: boolean,
  jsonLines?: boolean,
  oldestOnly?: boolean,
  newestOnly?: boolean,
) {
  if (stableOnly && prereleaseOnly) throw new Error("Use either --stable-only or --prerelease-only, not both.")
  if (versionOnly && (tag || latestOnly || tagOnly)) throw new Error("Use --version-only without --tag, --latest-only, or --tag-only.")
  if (newestOnly && (tag || latestOnly || tagOnly || versionOnly || countOnly || jsonLines || oldestOnly)) {
    throw new Error("Use --newest-only without --tag, --latest-only, --tag-only, --version-only, --count-only, --json-lines, or --oldest-only.")
  }
  if (oldestOnly && (tag || latestOnly || tagOnly || versionOnly || countOnly || jsonLines)) {
    throw new Error("Use --oldest-only without --tag, --latest-only, --tag-only, --version-only, --count-only, or --json-lines.")
  }
  if (jsonLines && (tag || latestOnly || tagOnly || versionOnly || countOnly)) {
    throw new Error("Use --json-lines without --tag, --latest-only, --tag-only, --version-only, or --count-only.")
  }
  if (countOnly && (tag || latestOnly || tagOnly || versionOnly)) {
    throw new Error("Use --count-only without --tag, --latest-only, --tag-only, or --version-only.")
  }
  const rawDistTags = input.distTags && typeof input.distTags === "object" && !Array.isArray(input.distTags) ? input.distTags : {}
  const distTags = Object.fromEntries(
    Object.entries(rawDistTags)
      .filter(
        ([tagName, version]) =>
          LOCAL_RUNTIME_TAG_PATTERN.test(tagName) && LOCAL_RUNTIME_VERSION_PATTERN.test(version) && Boolean(semver.valid(version)),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const invalidDistTagCount = Object.keys(rawDistTags).length - Object.keys(distTags).length
  if (tagOnly) {
    if (tag || major !== undefined || latestOnly) throw new Error("Use --tag-only without --tag, --major, or --latest-only.")
    return Object.keys(distTags).join("\n")
  }
  if (latestOnly) {
    if (tag || major !== undefined) throw new Error("Use --latest-only without --tag or --major.")
    const latestVersion = typeof input.latest === "string" ? input.latest : distTags.latest
    if (!latestVersion || !LOCAL_RUNTIME_VERSION_PATTERN.test(latestVersion) || !semver.valid(latestVersion)) {
      throw new Error("Local runtime latest version was not found.")
    }
    return latestVersion
  }
  if (tag) {
    if (!LOCAL_RUNTIME_TAG_PATTERN.test(tag)) throw new Error(`Invalid local runtime dist-tag "${tag}".`)
    const version = distTags[tag]
    if (!version) throw new Error(`Local runtime dist-tag "${tag}" was not found.`)
    return version
  }
  const selectedMajor = normalizeLocalVersionMajor(major)
  const rawVersions = Array.isArray(input.versions) ? input.versions : []
  const invalidVersionInputCount = input.versions === undefined || Array.isArray(input.versions) ? 0 : 1
  const rawStringVersions = rawVersions.filter((version) => typeof version === "string")
  const stringVersions = rawStringVersions.map(normalizeLocalRuntimeVersion)
  const normalizedVersionCount = rawStringVersions.filter((version, index) => stringVersions[index] !== version).length
  const nonStringVersionCount = rawVersions.length - stringVersions.length
  const validVersions = stringVersions.filter((version) => LOCAL_RUNTIME_VERSION_PATTERN.test(version) && semver.valid(version))
  const uniqueVersions = Array.from(new Set(validVersions))
  const duplicateVersionCount = validVersions.length - uniqueVersions.length
  const versions = uniqueVersions
    .filter((version) => selectedMajor === undefined || version.startsWith(`${selectedMajor}.`))
    .filter((version) => !stableOnly || !semver.prerelease(version)?.length)
    .filter((version) => !prereleaseOnly || semver.prerelease(version)?.length)
    .sort(semver.rcompare)
  const prereleaseVersionCount = versions.filter((version) => semver.prerelease(version)?.length).length
  const stableVersionCount = versions.length - prereleaseVersionCount
  const newestStableVersion = versions.find((version) => !semver.prerelease(version)?.length)
  const newestPrereleaseVersion = versions.find((version) => semver.prerelease(version)?.length)
  const requestedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10
  const count = Math.min(requestedLimit, 100)
  const shownVersions = versions.slice(0, count)
  if (countOnly) return String(versions.length)
  if (newestOnly) return versions[0] ?? ""
  if (oldestOnly) return versions.at(-1) ?? ""
  if (versionOnly) return shownVersions.join("\n")
  if (jsonLines) return shownVersions.map((version) => JSON.stringify({ version })).join("\n")
  const stableShown = shownVersions.filter((version) => !semver.prerelease(version)?.length).length
  const prereleaseShown = shownVersions.length - stableShown
  const matchingDistTags = Object.fromEntries(
    Object.entries(distTags).filter(([, version]) => selectedMajor !== undefined && version.startsWith(`${selectedMajor}.`)),
  )
  return formatJson({
    latest: input.latest,
    distTags,
    distTagCount: Object.keys(distTags).length,
    duplicateVersionCount,
    invalidDistTagCount,
    invalidVersionCount: rawVersions.length - validVersions.length + invalidVersionInputCount,
    nonStringVersionCount,
    normalizedVersionCount,
    rawVersionCount: rawVersions.length,
    validVersionCount: validVersions.length,
    prereleaseVersionCount,
    selectedVersionCount: versions.length,
    stableVersionCount,
    total: versions.length,
    ...(versions[0] ? { newestVersion: versions[0] } : {}),
    ...(newestStableVersion ? { newestStableVersion } : {}),
    ...(newestPrereleaseVersion ? { newestPrereleaseVersion } : {}),
    ...(versions.at(-1) ? { oldestVersion: versions.at(-1) } : {}),
    ...(selectedMajor === undefined ? {} : { major: selectedMajor }),
    ...(stableOnly ? { stableOnly: true } : {}),
    ...(prereleaseOnly ? { prereleaseOnly: true } : {}),
    ...(selectedMajor === undefined ? {} : { matchingDistTags }),
    ...(input.registry ? { registry: input.registry } : {}),
    ...(selectedMajor === undefined ? {} : { selectedDistTags: Object.keys(matchingDistTags) }),
    ...(selectedMajor === undefined ? {} : { selectedDistTagCount: Object.keys(matchingDistTags).length }),
    effectiveLimit: count,
    limit: count,
    requestedLimit,
    shown: Math.min(versions.length, count),
    stableShown,
    prereleaseShown,
    stableOmitted: Math.max(stableVersionCount - stableShown, 0),
    prereleaseOmitted: Math.max(prereleaseVersionCount - prereleaseShown, 0),
    omitted: Math.max(versions.length - count, 0),
    hasMore: versions.length > count,
    versions: shownVersions,
  })
}

export function formatLocalStatus(status: LocalStatus & { target?: LocalTarget }, pathOnly?: boolean) {
  const normalized = status.binaryPath ? { ...status, binaryPath: status.binaryPath.trim() } : status
  if (pathOnly) {
    if (!normalized.installed) throw new Error(`Local runtime ${normalized.binaryVersion} is not installed.`)
    if (!normalized.binaryPath) throw new Error("Local runtime binary path is unavailable.")
    return normalized.binaryPath
  }
  return formatJson(normalized)
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
  return version ? validateLocalRuntimeVersion(version) : await readPreferredLocalVersion()
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

export function formatInstanceTable(instances: ReturnType<typeof formatInstanceSummary>[]) {
  if (instances.length === 0) return "No saved instances."
  const defaultCount = instances.filter((item) => item.default).length
  const tlsSkippedCount = instances.filter((item) => item.ignoreCertificateErrors).length
  const widths = {
    id: Math.max(2, ...instances.map((item) => item.id.length)),
    type: Math.max(4, ...instances.map((item) => item.type.length)),
    label: Math.max(5, ...instances.map((item) => (item.label || "-").length)),
    version: Math.max(7, ...instances.map((item) => (item.version || "-").length)),
    headers: Math.max(7, ...instances.map((item) => String(item.headers).length)),
  }
  const header = [
    "ID".padEnd(widths.id),
    "Type".padEnd(widths.type),
    "Label".padEnd(widths.label),
    "Version".padEnd(widths.version),
    "Headers".padEnd(widths.headers),
    "TLS",
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
        String(item.headers).padEnd(widths.headers),
        item.ignoreCertificateErrors ? "skip" : "verify",
        item.url,
      ].join("  "),
    ),
    "─".repeat(header.length),
    `${instances.length} saved ${instances.length === 1 ? "instance" : "instances"}; ${defaultCount} default; ${tlsSkippedCount} skip TLS.`,
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
      .option("json-lines", {
        type: "boolean",
        default: false,
        describe: "print saved instances as newline-delimited JSON",
      })
      .option("type", {
        choices: ["local", "remote"] as const,
        describe: "only list local or remote instances",
      })
      .option("default-only", {
        type: "boolean",
        default: false,
        describe: "only show the default selected instance",
      })
      .option("tls-skipped-only", {
        type: "boolean",
        default: false,
        describe: "only show instances that skip TLS certificate validation",
      })
      .option("tls-verify-only", {
        type: "boolean",
        default: false,
        describe: "only show instances that verify TLS certificates",
      })
      .option("id-only", {
        type: "boolean",
        default: false,
        describe: "print only saved instance ids, one per line",
      })
      .option("label-only", {
        type: "boolean",
        default: false,
        describe: "print only saved instance labels, one per line",
      })
      .option("url-only", {
        type: "boolean",
        default: false,
        describe: "print only saved instance URLs, one per line",
      })
      .option("count-only", {
        type: "boolean",
        default: false,
        describe: "print only the number of saved instances after filters",
      }),
  async handler(args) {
    const input = args as InstanceListArgs
    validateInstanceListOutput(input)
    const service = createInstanceService()
    const state = await service.store.getState()
    const output = filterTlsVerifyInstanceSummaries(
      filterTlsSkippedInstanceSummaries(
        filterDefaultInstanceSummaries(
          filterInstanceSummaries(
            state.instances.map((item) => formatInstanceSummary(item, state.lastInstanceID)),
            input.type,
          ),
          input.defaultOnly,
        ),
        input.tlsSkippedOnly,
      ),
      input.tlsVerifyOnly,
    )
    if (input.json) {
      console.log(formatJson(output))
      return
    }
    if (input.jsonLines) {
      console.log(formatInstanceJsonLines(output))
      return
    }
    if (input.idOnly) {
      console.log(formatInstanceIDs(output))
      return
    }
    if (input.labelOnly) {
      console.log(formatInstanceLabels(output))
      return
    }
    if (input.urlOnly) {
      console.log(formatInstanceURLs(output))
      return
    }
    if (input.countOnly) {
      console.log(formatInstanceCount(output))
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
    const id = input.id
      ? validateInstanceID(input.id)
      : autoInstanceID(input.label || input.target, input.local ? "local" : "remote")
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

    // Replace any existing header with the same name (case-insensitive)
    // so re-running sign-in cleanly overwrites a stale cookie. Other
    // headers stay (e.g. an X-API-Key the user might have configured
    // alongside CF Access).
    const headers = (() => {
      try {
        return mergeSignedInHeader(saved!.headers, headerLine)
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    })()
    const updated: SavedInstance = {
      ...saved!,
      headers,
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
    }).option("major", {
      type: "number",
      describe: "only include versions from one major release line",
    }).option("tag", {
      type: "string",
      describe: "print only one npm dist-tag version",
    }).option("latest-only", {
      type: "boolean",
      default: false,
      describe: "print only the latest stable runtime version",
    }).option("oldest-only", {
      type: "boolean",
      default: false,
      describe: "print only the oldest selected runtime version",
    }).option("newest-only", {
      type: "boolean",
      default: false,
      describe: "print only the newest selected runtime version",
    }).option("stable-only", {
      type: "boolean",
      default: false,
      describe: "only include stable runtime versions",
    }).option("prerelease-only", {
      type: "boolean",
      default: false,
      describe: "only include prerelease runtime versions",
    }).option("tag-only", {
      type: "boolean",
      default: false,
      describe: "print only npm dist-tag names, one per line",
    }).option("version-only", {
      type: "boolean",
      default: false,
      describe: "print only selected runtime versions, one per line",
    }).option("count-only", {
      type: "boolean",
      default: false,
      describe: "print only the number of selected runtime versions",
    }).option("json-lines", {
      type: "boolean",
      default: false,
      describe: "print selected runtime versions as newline-delimited JSON",
    }),
  async handler(args) {
    const input = args as InstanceLocalVersionsArgs
    console.log(
      formatLocalVersions(
        await fetchCodeplaneVersions(),
        input.limit,
        input.tag,
        input.major,
        input.latestOnly,
        input.tagOnly,
        input.stableOnly,
        input.prereleaseOnly,
        input.versionOnly,
        input.countOnly,
        input.jsonLines,
        input.oldestOnly,
        input.newestOnly,
      ),
    )
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
    const state = await service.store.getState()
    const next = applyLocalInstanceVersion(state, version)
    await service.store.replace(next)
    console.log(
      formatJson({
        ...result,
        binaryPath: await localBinaryPath(version),
        previousLocalVersions: localInstanceVersions(state),
        updatedLocalInstances: next.instances.filter((item) => item.local).length,
      }),
    )
  },
})
