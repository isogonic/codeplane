import { Effect } from "effect"
import { GlobalBus } from "@/bus/global"
import { Log } from "@/util"
import { AppRuntime } from "@/effect/app-runtime"
import { Installation, type Method } from "."
import { InstallationVersion, InstallationLocal, hasUpdate } from "./version"

const log = Log.create({ service: "installation.update-checker" })

const POLL_INTERVAL_MS = 30 * 60 * 1000
const INITIAL_DELAY_MS = 30 * 1000
const CACHE_TTL_MS = 60 * 1000

type Snapshot = {
  current: string
  latest: string | null
  method: Method
  hasUpdate: boolean
  fetchedAt: number
}

let snapshot: Snapshot | undefined
let inflight: Promise<Snapshot> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false
let lastAnnounced: string | undefined

function shouldSkip(method: Method) {
  if (InstallationLocal) return true
  if (InstallationVersion === "local" || InstallationVersion === "dev") return true
  if (!Installation.canUpgradeInPlace(method)) return true
  return false
}

async function fetchSnapshot(): Promise<Snapshot> {
  const method = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.method())).catch(
    () => "unknown" as Method,
  )
  if (shouldSkip(method)) {
    return {
      current: InstallationVersion,
      latest: null,
      method,
      hasUpdate: false,
      fetchedAt: Date.now(),
    }
  }
  const latest = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.latest(method))).catch(
    () => null as string | null,
  )
  return {
    current: InstallationVersion,
    latest,
    method,
    hasUpdate: !!latest && hasUpdate(InstallationVersion, latest),
    fetchedAt: Date.now(),
  }
}

async function refresh(force = false): Promise<Snapshot> {
  if (!force && snapshot && Date.now() - snapshot.fetchedAt < CACHE_TTL_MS) {
    return snapshot
  }
  if (inflight) return inflight
  inflight = fetchSnapshot()
    .then((next) => {
      snapshot = next
      return next
    })
    .finally(() => {
      inflight = undefined
    })
  return inflight
}

function announce(next: Snapshot) {
  if (!next.hasUpdate || !next.latest) return
  if (lastAnnounced === next.latest) return
  lastAnnounced = next.latest
  log.info("update available", { current: next.current, latest: next.latest, method: next.method })
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Installation.Event.UpdateAvailable.type,
      properties: { version: next.latest },
    },
  })
}

async function tick() {
  try {
    announce(await refresh(true))
  } catch (err) {
    log.error("periodic update check failed", { error: err instanceof Error ? err.message : String(err) })
  }
}

export const UpdateChecker = {
  start() {
    if (timer) return
    stopped = false
    timer = setTimeout(function loop() {
      void tick().finally(() => {
        // Don't re-arm if stop() was called while this cycle was in flight —
        // otherwise the poll timer resurrects itself after shutdown.
        if (!stopped) timer = setTimeout(loop, POLL_INTERVAL_MS)
      })
    }, INITIAL_DELAY_MS)
  },
  stop() {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    inflight = undefined
  },
  current(): Promise<Snapshot> {
    return refresh(false)
  },
  invalidate() {
    snapshot = undefined
  },
  acknowledge(version: string) {
    lastAnnounced = version
  },
}
