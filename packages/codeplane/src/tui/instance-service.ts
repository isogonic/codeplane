import fs from "node:fs/promises"
import path from "node:path"
import semver from "semver"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import type {
  LocalInstallProgress,
  LocalStatus,
  LocalTarget,
  OpenProgress,
  SavedInstance,
} from "@codeplane-ai/shared/instance"
import { createInstanceStore } from "@codeplane-ai/shared/instance-store"
import {
  fetchCodeplaneLatestVersion,
  readPreferredLocalVersion,
  writePreferredLocalVersion,
} from "@codeplane-ai/shared/local-runtime"
import { createInstanceClient, headersForInstance, normalizeInstanceUrl } from "./client"
import { createLocalInstanceManager } from "./local-instance"

// Per-instance update flow used by the TUI boot wizard and the Desktop
// instance selector. Two cases:
//
// - Local managed instance: the binary lives under
//   `local_server/binaries/<version>/`. We probe npm for the newest
//   `codeplane-ai` release, install it via the local manager (with progress)
//   if newer, then rewrite the saved instance's `binaryVersion`. The next
//   open uses the new binary.
//
// - Remote instance: we don't own the upgrade lifecycle (the server admin
//   does), so the action only probes `/global/version` and reports the
//   delta. Triggering `/global/upgrade` requires an authenticated client
//   inside the instance shell, not the boot wizard — the renderer should
//   point the user at the in-instance Update flow.
export type UpdateProgress =
  | { phase: "checking"; message: string }
  | { phase: "downloading"; message: string; percent?: number }
  | { phase: "saving"; message: string }
  | { phase: "done"; message: string }

export type UpdateResult =
  | { kind: "already-latest"; version: string; label?: string }
  | { kind: "updated-local"; from: string; to: string; label?: string }
  | { kind: "remote-current"; version?: string; label?: string }
  | { kind: "remote-update-available"; current?: string; latest: string; label?: string }
  | { kind: "remote-unreachable"; message: string; label?: string }
  | { kind: "error"; message: string; label?: string }

type ProbeResult =
  | {
      ok: true
      version?: string | null
      latest?: string | null
      status: number
    }
  | {
      ok: false
      status?: number
      error: string
    }

// Thrown by `open()` when the remote instance sits behind an interactive
// auth proxy (CF Access, identity-aware proxy, custom SSO). The TUI catches
// this and switches into a sign-in screen that lets the user open the URL
// in their default browser, capture an auth header (cookie, bearer, service
// token), and persist it on the instance before retrying.
export class TUIAuthRequiredError extends Error {
  authUrl: string
  instanceUrl: string

  constructor(input: { authUrl: string; instanceUrl: string }) {
    super(`Interactive sign-in is required for ${input.instanceUrl}`)
    this.name = "TUIAuthRequiredError"
    this.authUrl = input.authUrl
    this.instanceUrl = input.instanceUrl
  }
}

const encodeBasicAuth = (value: string) => Buffer.from(value).toString("base64")

function mapLocalProgress(instanceID: string, input: LocalInstallProgress): OpenProgress {
  const phase: OpenProgress["phase"] =
    input.phase === "detect" || input.phase === "download"
      ? "download"
      : input.phase === "extract"
        ? "finalize"
        : input.phase === "start"
          ? "probe"
          : input.phase === "ready"
            ? "done"
            : "download"
  return {
    instanceID,
    phase,
    message: input.message,
    percent: input.percent,
    version: input.binaryVersion,
    completed: input.transferred,
    total: input.total,
  }
}

export function createInstanceService() {
  const home = CodeplaneHome.paths()
  const store = createInstanceStore(home.instances)
  const local = createLocalInstanceManager({
    binariesDir: home.local_server_binaries,
    configDir: home.root,
    dataDir: home.local_server,
    // The TUI is not the desktop. Don't tell the spawned server it's
    // desktop-managed — that would short-circuit /global/upgrade to
    // "use the desktop's Updates panel" even though there's no desktop
    // here. The TUI's in-app "Update Available" flow then sees a real
    // method (or "managed-local") and can handle it appropriately.
    desktopManaged: false,
  })
  let migrated = false

  async function ensureMigrated() {
    if (migrated) return
    migrated = true
    await store.migrate(path.join(CodeplaneHome.legacyPaths().state, "tui-instances.json"))
    await mergeOrphanedPerInstanceRegistry()
  }

  // One-shot rescue for users who added instances via TUI between v27.4.29
  // (per-instance default landed) and v27.4.51 (this fix). During that
  // window, the CLI was writing instances.json into
  // <root>/instances/<id>/instances.json instead of <root>/instances.json,
  // so any TUI-added remotes were invisible from the desktop's saved-
  // instance picker (and vice versa). On first run after this fix, scan
  // the per-instance subdirs for stranded instances.json files, merge any
  // entries the global registry doesn't already have (matched by id), and
  // delete the orphans. The global file remains the source of truth.
  async function mergeOrphanedPerInstanceRegistry(): Promise<void> {
    try {
      const perInstancesDir = path.join(home.globalRoot, "instances")
      const entries = await fs.readdir(perInstancesDir, { withFileTypes: true }).catch(() => [])
      const orphanFiles: string[] = []
      const merged: SavedInstance[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const orphan = path.join(perInstancesDir, entry.name, "instances.json")
        const text = await fs.readFile(orphan, "utf8").catch(() => undefined)
        if (text === undefined) continue
        try {
          const parsed = JSON.parse(text) as { instances?: SavedInstance[] }
          if (Array.isArray(parsed.instances)) {
            for (const inst of parsed.instances) merged.push(inst)
            orphanFiles.push(orphan)
          }
        } catch {
          // ignore malformed orphan; leave it on disk for human inspection
        }
      }
      if (merged.length === 0) return
      const existing = await store.list()
      const existingIds = new Set(existing.map((i) => i.id))
      let saved = 0
      for (const inst of merged) {
        if (existingIds.has(inst.id)) continue
        await store.save({ ...inst, url: normalizeInstanceUrl(inst.url) ?? inst.url })
        existingIds.add(inst.id)
        saved += 1
      }
      // Always delete the orphans even if everything was already in the
      // global registry — leaving them around would re-create the
      // confusion the next time someone reads the disk by hand.
      for (const orphan of orphanFiles) await fs.unlink(orphan).catch(() => undefined)
      if (saved > 0) {
        // Stderr-only — TUI renderer captures stdout, but the boot wizard
        // hasn't started yet at this point; this still surfaces in the
        // log file via Log.Default if the caller wired it. Quiet on the
        // happy zero-orphan path.
        process.stderr.write(`[codeplane] Migrated ${saved} stranded instance(s) into the shared registry.\n`)
      }
    } catch {
      // Best-effort; never fail the TUI boot because of a registry merge
      // edge case. The global registry remains valid in any case.
    }
  }

  async function list() {
    await ensureMigrated()
    return store.list()
  }

  async function save(instance: SavedInstance) {
    await ensureMigrated()
    return store.save({
      ...instance,
      url: normalizeInstanceUrl(instance.url) ?? instance.url,
    })
  }

  async function remove(id: string) {
    await ensureMigrated()
    await local.stop(id).catch(() => undefined)
    return store.remove(id)
  }

  async function probe(input: string | SavedInstance): Promise<ProbeResult> {
    const instance =
      typeof input === "string"
        ? {
            id: `probe:${Date.now()}`,
            url: input,
          }
        : input
    const baseUrl = normalizeInstanceUrl(instance.url)
    if (!baseUrl) return { ok: false, error: `Invalid instance URL: ${instance.url}` }

    const headers = new Headers(headersForInstance(instance))
    if (baseUrl.includes("@")) {
      const url = new URL(baseUrl)
      if (url.username || url.password) {
        headers.set("Authorization", `Basic ${encodeBasicAuth(`${url.username}:${url.password}`)}`)
        url.username = ""
        url.password = ""
      }
    }

    return fetch(new URL("/global/version", `${baseUrl}/`), {
      headers,
      redirect: "follow",
    })
      .then(async (response) => {
        const payload = response.headers.get("content-type")?.includes("json") ? await response.json().catch(() => ({})) : {}
        if (!response.ok) {
          return {
            ok: false as const,
            status: response.status,
            error: `HTTP ${response.status}`,
          }
        }
        return {
          ok: true as const,
          status: response.status,
          version: typeof payload.current === "string" ? payload.current : undefined,
          latest: typeof payload.latest === "string" ? payload.latest : undefined,
        }
      })
      .catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }))
  }

  async function ensureLiveInstance(saved: SavedInstance, onProgress?: (progress: OpenProgress) => void): Promise<SavedInstance> {
    if (!saved.local) return saved
    const version = saved.local.binaryVersion || (await readPreferredLocalVersion())
    const forwardManagerProgress = (progress: LocalInstallProgress) =>
      onProgress?.(mapLocalProgress(saved.id, { ...progress, version }))
    // start() handles auto-download on first run; no need to pre-call download().
    const running = await local.start({ id: saved.id, binaryVersion: version }, forwardManagerProgress)
    return {
      ...saved,
      url: running.url,
      local: { binaryVersion: version },
    }
  }

  async function open(saved: SavedInstance, onProgress?: (progress: OpenProgress) => void) {
    await ensureMigrated()
    onProgress?.({
      instanceID: saved.id,
      phase: "probe",
      message: "Resolving instance…",
      percent: 8,
    })
    const live = await ensureLiveInstance(saved, onProgress)
    onProgress?.({
      instanceID: saved.id,
      phase: "probe",
      message: "Checking server version…",
      percent: 20,
    })
    // Probe `/global/version` directly first so we can give a precise message
    // when the instance is gated by an auth proxy (CF Access, IdP, etc).
    // Falling straight into the SDK client throws an opaque parse error in
    // that case — users couldn't tell whether the URL was wrong or they just
    // needed to authenticate.
    //
    // The probe uses `redirect: "follow"`, so a typical 302→login HTML page
    // comes back as `ok: true` with no `version` parsed (HTML, not JSON).
    // Treat that the same as 401/403: the instance is reachable, just not
    // letting us in yet.
    if (!live.local) {
      const probed = await probe(live)
      const authError = () =>
        new TUIAuthRequiredError({
          authUrl: live.url,
          instanceUrl: live.url,
        })
      if (!probed.ok) {
        const status = probed.status
        if (status === 401 || status === 403) {
          throw authError()
        }
        throw new Error(probed.error || `Could not reach ${live.url}`)
      }
      if (!probed.version) {
        // 200 OK but no `current` field — almost always means we landed on a
        // login HTML page after following the auth redirect chain.
        throw authError()
      }
      onProgress?.({
        instanceID: saved.id,
        phase: "finalize",
        message: `Opening Codeplane ${probed.version}…`,
        percent: 60,
        version: probed.version,
      })
    }
    const client = createInstanceClient({ instance: live, throwOnError: true })
    const version = (await client.global.version()).data?.current
    if (!version) throw new Error(`No version returned from ${live.url}`)
    onProgress?.({
      instanceID: saved.id,
      phase: "finalize",
      message: `Opening Codeplane ${version}…`,
      percent: 88,
      version,
    })
    const pathInfo = (await client.path.get()).data
    if (!pathInfo) throw new Error("No path info returned by server")
    const scoped = createInstanceClient({
      instance: live,
      directory: pathInfo.directory,
      throwOnError: true,
    })
    await store.setLast(saved.id)
    onProgress?.({
      instanceID: saved.id,
      phase: "done",
      message: `Connected to Codeplane ${version}.`,
      percent: 100,
      version,
    })
    return {
      client: scoped,
      instance: saved,
      live,
      path: pathInfo,
      version,
    }
  }

  // Re-scope an existing connection to a different working directory without
  // re-running the probe / auth flow. Returns the same shape as `open`.
  async function reopen(saved: SavedInstance, directory: string) {
    const live = await ensureLiveInstance(saved)
    const probeClient = createInstanceClient({ instance: live, throwOnError: true })
    const pathResp = await probeClient.path.get({ directory })
    const pathInfo = pathResp.data
    if (!pathInfo) throw new Error(`Server did not resolve directory: ${directory}`)
    const versionResp = await probeClient.global.version()
    const version = versionResp.data?.current ?? ""
    const scoped = createInstanceClient({
      instance: live,
      directory: pathInfo.directory,
      throwOnError: true,
    })
    return {
      client: scoped,
      instance: saved,
      live,
      path: pathInfo,
      version,
    }
  }

  async function localTarget(): Promise<LocalTarget> {
    return {
      ...(await local.resolveTarget()),
      defaultVersion: await readPreferredLocalVersion(),
    }
  }

  async function localStatus(version?: string): Promise<LocalStatus> {
    return local.status(version || (await readPreferredLocalVersion()))
  }

  async function installLocal(version?: string, progress?: (progress: LocalInstallProgress) => void) {
    const targetVersion = version || (await readPreferredLocalVersion())
    const result = await local.download(targetVersion, (next) =>
      progress?.({
        version: targetVersion,
        phase: next.phase,
        message: next.message,
        percent: next.percent,
        binaryVersion: next.binaryVersion,
        transferred: next.transferred,
        total: next.total,
      }),
    )
    await writePreferredLocalVersion(targetVersion)
    return result
  }

  // Per-instance "update" action. Single helper used by TUI wizard +
  // Desktop selector so the behavior matches across surfaces.
  //
  // - Local: fetches the newest npm `codeplane-ai` version, downloads the
  //   binary if newer, rewrites the saved instance's binaryVersion. Honors
  //   `targetVersion` so the caller can pin to a specific release.
  // - Remote: probes `/global/version`, reports current/latest. Does NOT
  //   trigger `/global/upgrade` — that requires an authenticated session
  //   inside the instance shell, not the boot wizard.
  async function updateInstance(
    saved: SavedInstance,
    onProgress?: (progress: UpdateProgress) => void,
    targetVersion?: string,
  ): Promise<UpdateResult> {
    const label = saved.label ?? saved.id
    if (saved.local) {
      onProgress?.({ phase: "checking", message: "Checking npm for newer Codeplane…" })
      const desired = targetVersion?.replace(/^v/, "")
      const latest =
        desired ??
        (await fetchCodeplaneLatestVersion().catch(() => undefined))
      if (!latest) {
        return { kind: "error", message: "Could not reach the npm registry. Check your network and try again.", label }
      }
      const current = saved.local.binaryVersion || ""
      if (current && !desired) {
        const cur = semver.coerce(current)?.version
        const lat = semver.coerce(latest)?.version
        if (cur && lat && !semver.gt(lat, cur)) {
          return { kind: "already-latest", version: current, label }
        }
      }
      onProgress?.({ phase: "downloading", message: `Downloading Codeplane v${latest}…` })
      try {
        await installLocal(latest, (p) =>
          onProgress?.({
            phase: "downloading",
            message: p.message ?? `Downloading v${latest}…`,
            percent: p.percent,
          }),
        )
      } catch (err) {
        return {
          kind: "error",
          message: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
          label,
        }
      }
      // Verify the binary actually landed on disk before declaring
      // success and rewriting the saved binaryVersion. Without this
      // check, a corrupt-tarball / disk-full / permissions edge case
      // could leave us with `installLocal` resolving cleanly but no
      // binary on disk — the next `open` would then fail with a
      // confusing missing-binary error and the user would never
      // connect it back to the Update press.
      const verified = await localStatus(latest)
      if (!verified.installed) {
        return {
          kind: "error",
          message: `Install of v${latest} reported success but binary is missing on disk (expected at ${verified.binaryPath || "unknown path"}). Saved binaryVersion was NOT updated. Re-try, or run \`codeplane upgrade ${latest}\` from a shell.`,
          label,
        }
      }
      onProgress?.({ phase: "saving", message: "Saving updated instance…" })
      await save({ ...saved, local: { binaryVersion: latest } })
      onProgress?.({ phase: "done", message: `Updated ${label} to v${latest}` })
      return { kind: "updated-local", from: current, to: latest, label }
    }

    // Remote: just probe and report. The wizard runs before we have an
    // authenticated SDK client, and the in-instance Update flow already
    // covers `/global/upgrade` once the user opens the instance.
    onProgress?.({ phase: "checking", message: "Probing remote server…" })
    const probed = await probe(saved)
    if (!probed.ok) {
      return {
        kind: "remote-unreachable",
        message: probed.error || "Server is unreachable. Check the URL and credentials.",
        label,
      }
    }
    const current = probed.version ?? undefined
    const latest = probed.latest ?? undefined
    if (current && latest) {
      const cur = semver.coerce(current)?.version
      const lat = semver.coerce(latest)?.version
      if (cur && lat && semver.gt(lat, cur)) {
        return { kind: "remote-update-available", current, latest, label }
      }
    }
    return { kind: "remote-current", version: current, label }
  }

  return {
    installLocal,
    list,
    localStatus,
    localTarget,
    open,
    reopen,
    probe,
    remove,
    save,
    setLast: store.setLast,
    updateInstance,
    // Tear down every local Codeplane child this manager spawned. Used by the
    // TUI on `/exit` (and SIGTERM/SIGINT) so the stdio pipes on those children
    // don't keep the parent's event loop alive — without this the TUI hangs
    // after the renderer has already restored the terminal.
    stopAll: () => local.stopAll(),
    store,
  }
}

export type InstanceService = ReturnType<typeof createInstanceService>
