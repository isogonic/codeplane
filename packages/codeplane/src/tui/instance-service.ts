import path from "node:path"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import type {
  LocalInstallProgress,
  LocalStatus,
  LocalTarget,
  OpenProgress,
  SavedInstance,
} from "@codeplane-ai/shared/instance"
import { createInstanceStore } from "@codeplane-ai/shared/instance-store"
import { readPreferredLocalVersion, writePreferredLocalVersion } from "@codeplane-ai/shared/local-runtime"
import { createInstanceClient, headersForInstance, normalizeInstanceUrl } from "./client"
import { createLocalInstanceManager } from "./local-instance"

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
  })
  let migrated = false

  async function ensureMigrated() {
    if (migrated) return
    migrated = true
    await store.migrate(path.join(CodeplaneHome.legacyPaths().state, "tui-instances.json"))
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
      const authMessage = `${live.url} requires sign-in. The TUI can't drive an interactive login — open the URL in a browser to capture an auth header (CF Access service token, bearer token, …) and add it under "Headers" when editing this instance, or use the desktop app for cookie-based sign-in.`
      if (!probed.ok) {
        const status = probed.status
        if (status === 401 || status === 403) {
          throw new Error(authMessage)
        }
        throw new Error(probed.error || `Could not reach ${live.url}`)
      }
      if (!probed.version) {
        // 200 OK but no `current` field — almost always means we landed on a
        // login HTML page after following the auth redirect chain.
        throw new Error(authMessage)
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

  return {
    installLocal,
    list,
    localStatus,
    localTarget,
    open,
    probe,
    remove,
    save,
    setLast: store.setLast,
    store,
  }
}

export type InstanceService = ReturnType<typeof createInstanceService>
