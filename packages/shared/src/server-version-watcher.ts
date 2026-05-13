// Polls `/global/version` on a connected instance and fires `onChange` when
// the server's reported `current` version drifts from the version we
// originally connected with. Drives the auto-reconnect/auto-download UX for
// both the desktop shell (re-run `uiHost.prepare`) and the TUI (re-run
// `service.open`) so the client always matches the running server build.
//
// Polling is the load-bearing path. The SDK already pushes
// `installation.updated` through its event stream, but those events depend
// on the client staying subscribed across the server restart; in practice
// the socket usually drops while the new binary boots and we miss the
// event. The poll is cheap (one HEAD-equivalent JSON fetch) and recovers
// from any reconnect window.

export type ServerVersionWatcherOptions = {
  baseUrl: string
  headers?: Record<string, string>
  currentVersion: string
  intervalMs?: number
  onChange: (next: { version: string; previous: string }) => void
  onError?: (error: Error) => void
  fetchImpl?: typeof fetch
}

export type ServerVersionWatcher = {
  stop: () => void
  /** Force an immediate poll (e.g. after an SDK `installation.updated` event). */
  ping: () => void
  /** Last successfully observed `current` version, or the seed value before any poll. */
  currentVersion: () => string
}

const DEFAULT_INTERVAL_MS = 15_000
const MIN_INTERVAL_MS = 2_000

function normalizeBase(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "")
  if (!trimmed) throw new Error("ServerVersionWatcher: baseUrl is required")
  return trimmed
}

export function createServerVersionWatcher(options: ServerVersionWatcherOptions): ServerVersionWatcher {
  const interval = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS)
  const fetchImpl = options.fetchImpl ?? fetch
  const base = normalizeBase(options.baseUrl)
  let stopped = false
  let inflight = false
  let lastSeen = options.currentVersion
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: AbortController | undefined

  const schedule = (ms: number) => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void poll()
    }, ms)
    timer.unref?.()
  }

  const poll = async () => {
    if (stopped || inflight) return
    inflight = true
    abort = new AbortController()
    try {
      const response = await fetchImpl(`${base}/global/version`, {
        headers: options.headers,
        redirect: "follow",
        signal: abort.signal,
      })
      if (stopped) return
      if (!response.ok) {
        // Treat HTTP errors as transient; the next poll retries.
        options.onError?.(new Error(`Version probe HTTP ${response.status}`))
        return
      }
      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.includes("json")) {
        // Auth proxy slipped a login page in front of us — skip silently;
        // the connected client is the source of truth for auth state.
        return
      }
      const payload = (await response.json().catch(() => ({}))) as { current?: unknown }
      const current = typeof payload.current === "string" ? payload.current : undefined
      if (!current) return
      if (current === lastSeen) return
      const previous = lastSeen
      lastSeen = current
      try {
        options.onChange({ version: current, previous })
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    } catch (error) {
      if (stopped) return
      if ((error as { name?: string })?.name === "AbortError") return
      options.onError?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      inflight = false
      schedule(interval)
    }
  }

  schedule(interval)

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
      abort?.abort()
    },
    ping() {
      if (stopped) return
      if (timer) clearTimeout(timer)
      timer = undefined
      void poll()
    },
    currentVersion() {
      return lastSeen
    },
  }
}
