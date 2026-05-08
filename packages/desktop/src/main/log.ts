import fs from "node:fs/promises"
import path from "node:path"

export type DesktopLogData = unknown
export type DesktopLogger = {
  log(scope: string, event: string, data?: DesktopLogData): void
  /** Like `log` but always tags the entry as an error so it's mirrored to
   * the persistent dedup file even when the heuristic wouldn't have
   * caught it. Useful for "expected but worth recording" failures whose
   * event/data shape doesn't include the literal string "error". */
  error(scope: string, event: string, data?: DesktopLogData): void
  /** Absolute path of the active (un-rotated) log file. */
  path(): string
  /** Absolute path of the directory all rotated logs live in. */
  dir(): string
  /** Absolute path of the persistent dedup error file. Lives next to the
   * rotating log but is append-only and never rotated — by design, so a
   * long-running install accumulates one row per *unique* failure mode. */
  errorsPath(): string
}

type Entry = {
  ts: string
  pid: number
  scope: string
  event: string
  data?: DesktopLogData
}

// Size cap per active file before rotation. ~5 MiB keeps a single tail
// readable in any editor and pairs with KEEP_FILES=5 for ~25 MiB total —
// enough to capture a multi-day repro without ballooning the disk.
const MAX_BYTES = 5 * 1024 * 1024
// How many rotated files to keep before deleting the oldest. desktop.log
// is the live tail, desktop.log.1 the previous slice, etc. up to .KEEP.
const KEEP_FILES = 5

// Filename of the persistent, deduplicated error catalog. Appended to but
// NEVER rotated, so the user keeps a forever-growing list of distinct
// failure modes the app has hit on this machine.
const ERRORS_FILENAME = "errors.log"

// When tens of thousands of unique errors accumulate over months, parsing
// them all on first error after launch would block the writes queue for
// long enough to be noticeable. Cap the in-memory dedup set; once it's
// full, fall back to "scan the file" via tail-grep on each new candidate
// (still correct, just slower per-write). 50k entries × ~150 bytes/key ≈
// a few MB of RAM, which is comfortably under any sane Electron budget.
const MAX_SEEN_KEYS = 50_000

function stringify(entry: Entry) {
  const seen = new WeakSet<object>()
  return `${JSON.stringify(entry, (_key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]"
      seen.add(value)
    }
    return value
  })}\n`
}

// Replace the volatile bits of a serialized payload with stable
// placeholders so two runs that hit the same bug — but at different
// times, with different PIDs, on different cookie hexes — collapse to
// the same dedup key. Conservative: any token that looks like a
// timestamp, a 4+-digit number, or an 8+-char hex run gets normalized.
function normalizeForDedup(value: string): string {
  return value
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.\-+Z]+/g, "<ts>") // ISO-8601 timestamps
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>") // session IDs, hashes, etc.
    .replace(/\b\d{4,}\b/g, "<num>") // ports, large counters, PIDs over 9999
}

function firstStackFrame(stack: string | undefined): string {
  if (!stack) return ""
  const lines = stack.split("\n")
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("at ")) return line
  }
  return ""
}

// Pull an Error-shaped object out of a payload, regardless of whether
// the caller passed `error`/`reason`/`err`/`exception`. Each value here
// can be a real Error (passed by reference inside main.ts) or a plain
// `{ name, message, stack }` (already serialized by an earlier hop, e.g.
// IPC from the renderer).
type ErrorLike = { name?: unknown; message?: unknown; stack?: unknown }
function findErrorLike(data: unknown): ErrorLike | undefined {
  if (data instanceof Error) return data
  if (!data || typeof data !== "object") return undefined
  const obj = data as Record<string, unknown>
  for (const key of ["error", "reason", "err", "exception"]) {
    const candidate = obj[key]
    if (candidate instanceof Error) return candidate
    if (candidate && typeof candidate === "object") {
      const c = candidate as ErrorLike
      if (typeof c.message === "string" || typeof c.name === "string") return c
    }
  }
  return undefined
}

// Pattern matches event names that historically describe an error
// condition somewhere in main.ts: `process.uncaught`, `updater.error`,
// `window.did-fail-load`, `window.render-process-gone`,
// `notifications.notify.throw`, `instance.unreachable.bounce-to-setup`,
// `renderer.unhandledrejection`, etc. New error events that fit this
// shape will auto-flow into errors.log without code changes.
const ERROR_EVENT_RE = /(^|\.)(error|uncaught|unhandled|fail|gone|throw|unreachable|crash|reject|denied|refused)\b/i

function looksLikeError(entry: Entry): boolean {
  if (ERROR_EVENT_RE.test(entry.event)) return true
  if (findErrorLike(entry.data)) return true
  // Electron's webContents.console-message lands as `window.console`
  // scope with a numeric `level`; 2 = warning, 3 = error in the Chromium
  // mapping. We promote both — the line between "warning" and "error"
  // in renderer code isn't worth bikeshedding when the goal is "log
  // anything the user might want to fix later".
  if (entry.scope === "window.console") {
    const level = (entry.data as { level?: unknown } | undefined)?.level
    if (level === 2 || level === 3 || level === "warning" || level === "error") return true
  }
  return false
}

// Build the dedup signature for an entry. Stable across runs: same bug
// reproduced tomorrow on the same machine should produce the same key.
// The key intentionally includes scope+event so two unrelated subsystems
// failing with literally the same Error.message still get separate rows.
function dedupKey(entry: Entry): string {
  const err = findErrorLike(entry.data)
  if (err) {
    const name = typeof err.name === "string" ? err.name : "Error"
    const message = typeof err.message === "string" ? err.message : ""
    const frame = firstStackFrame(typeof err.stack === "string" ? err.stack : undefined)
    return `${entry.scope}|${entry.event}|${name}|${normalizeForDedup(message)}|${normalizeForDedup(frame)}`
  }
  let serialized: string
  try {
    serialized = JSON.stringify(entry.data ?? null)
  } catch {
    serialized = String(entry.data)
  }
  return `${entry.scope}|${entry.event}|${normalizeForDedup(serialized)}`
}

export function createDesktopLogger(dir: string): DesktopLogger {
  const file = path.join(dir, "desktop.log")
  const errorsFile = path.join(dir, ERRORS_FILENAME)
  let writes = Promise.resolve()
  let approxSize = -1 // -1 = unknown, refreshed lazily after first append failure
  let warnedAboutDisk = false
  let warnedAboutErrorsDisk = false
  // Lazily populated from disk on first error after launch. Once loaded,
  // every subsequent write checks against this set in O(1). The loader
  // runs inside the `writes` chain so concurrent error writes can't race
  // and double-append the same key.
  const seen = new Set<string>()
  let seenLoaded = false
  // When the in-memory cap is exceeded, we stop adding to `seen` but keep
  // the existing entries authoritative. New keys then need a slow path
  // that scans errorsFile to confirm uniqueness (rare in practice — most
  // installs accumulate a handful of distinct errors).
  let seenSaturated = false

  const rotate = async () => {
    // Shift desktop.log.4 → .5, .3 → .4, …, desktop.log → desktop.log.1.
    // Older slices fall off the end. fs.rename is atomic on the same
    // filesystem so there's no truncation window where readers see an
    // empty file.
    for (let i = KEEP_FILES; i >= 1; i--) {
      const src = i === 1 ? file : `${file}.${i - 1}`
      const dst = `${file}.${i}`
      try {
        if (i === KEEP_FILES) {
          await fs.rm(dst, { force: true })
        }
        await fs.rename(src, dst)
      } catch (err: unknown) {
        // ENOENT means that slot was never written (e.g. fresh install
        // with only desktop.log present) — skip silently. Any other
        // error means the FS is in an unexpected state; bail out and
        // let the next append re-attempt.
        const code = (err as NodeJS.ErrnoException | undefined)?.code
        if (code !== "ENOENT") return false
      }
    }
    approxSize = 0
    return true
  }

  const ensureSeenLoaded = async () => {
    if (seenLoaded) return
    seenLoaded = true
    try {
      const raw = await fs.readFile(errorsFile, "utf8").catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return ""
        throw err
      })
      if (!raw) return
      for (const line of raw.split("\n")) {
        if (!line) continue
        let parsed: { key?: unknown }
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof parsed.key !== "string") continue
        if (seen.size >= MAX_SEEN_KEYS) {
          seenSaturated = true
          break
        }
        seen.add(parsed.key)
      }
    } catch (err) {
      if (!warnedAboutErrorsDisk) {
        warnedAboutErrorsDisk = true
        // eslint-disable-next-line no-console -- last-resort signal: errors-file disabled
        console.error("[desktop-logger] errors-file load failed", { errorsFile, err })
      }
    }
  }

  // Slow path used after the in-memory `seen` set saturates. Walks the
  // file once to confirm the candidate key isn't already present. Linear
  // in file size but still O(seek-once-per-error) — acceptable for an
  // overflowed catalog that's already > MAX_SEEN_KEYS unique entries.
  const keyExistsOnDisk = async (key: string): Promise<boolean> => {
    try {
      const raw = await fs.readFile(errorsFile, "utf8").catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return ""
        throw err
      })
      if (!raw) return false
      // Cheap pre-filter before per-line JSON parsing.
      if (!raw.includes(key)) return false
      for (const line of raw.split("\n")) {
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as { key?: unknown }
          if (parsed.key === key) return true
        } catch {}
      }
    } catch {}
    return false
  }

  const writeErrorEntry = async (entry: Entry) => {
    const key = dedupKey(entry)
    await ensureSeenLoaded()
    if (seen.has(key)) return
    if (seenSaturated && (await keyExistsOnDisk(key))) return
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.appendFile(
        errorsFile,
        `${JSON.stringify({
          ts: entry.ts,
          pid: entry.pid,
          scope: entry.scope,
          event: entry.event,
          key,
          data: entry.data instanceof Error
            ? { name: entry.data.name, message: entry.data.message, stack: entry.data.stack }
            : entry.data,
        }, (_k, v) => {
          if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack }
          if (typeof v === "bigint") return v.toString()
          return v
        })}\n`,
      )
      if (!seenSaturated) {
        seen.add(key)
        if (seen.size >= MAX_SEEN_KEYS) seenSaturated = true
      }
    } catch (err) {
      if (!warnedAboutErrorsDisk) {
        warnedAboutErrorsDisk = true
        // eslint-disable-next-line no-console -- last-resort signal: errors-file disabled
        console.error("[desktop-logger] errors-file append failed", { errorsFile, err })
      }
    }
  }

  // Both `log` and `error` go through this. `forceError=true` skips the
  // looksLikeError() heuristic for callers that already know their entry
  // is a failure.
  const enqueue = (entry: Entry, forceError: boolean) => {
    const text = stringify(entry)
    const isError = forceError || looksLikeError(entry)
    writes = writes
      .then(async () => {
        try {
          await fs.mkdir(dir, { recursive: true })
          if (approxSize < 0) {
            const stat = await fs.stat(file).catch(() => undefined)
            approxSize = stat?.size ?? 0
          }
          if (approxSize + text.length > MAX_BYTES) {
            await rotate()
          }
          await fs.appendFile(file, text)
          approxSize += text.length
        } catch (err) {
          // We've lost the line, but at least surface the failure on the
          // process console so a watchful operator knows the log won't
          // contain the answer they're looking for.
          if (!warnedAboutDisk) {
            warnedAboutDisk = true
            // eslint-disable-next-line no-console -- last-resort signal: the logger itself is down
            console.error("[desktop-logger] append failed", { dir, file, err })
          }
          // Force a fresh stat next time so a rename/space-recovery is picked up.
          approxSize = -1
        }
        // The errors-file write runs after the rotating-log write so a
        // disk failure on the rotating log doesn't prevent the dedup
        // catalog from updating, and vice-versa.
        if (isError) await writeErrorEntry(entry)
      })
      .catch(() => undefined)
  }

  return {
    log(scope, event, data) {
      enqueue({ ts: new Date().toISOString(), pid: process.pid, scope, event, data }, false)
    },
    error(scope, event, data) {
      enqueue({ ts: new Date().toISOString(), pid: process.pid, scope, event, data }, true)
    },
    path() {
      return file
    },
    dir() {
      return dir
    },
    errorsPath() {
      return errorsFile
    },
  }
}
