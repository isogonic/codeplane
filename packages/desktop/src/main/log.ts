import fs from "node:fs/promises"
import path from "node:path"

export type DesktopLogData = unknown
export type DesktopLogger = {
  log(scope: string, event: string, data?: DesktopLogData): void
  /** Absolute path of the active (un-rotated) log file. */
  path(): string
  /** Absolute path of the directory all rotated logs live in. */
  dir(): string
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

export function createDesktopLogger(dir: string): DesktopLogger {
  const file = path.join(dir, "desktop.log")
  let writes = Promise.resolve()
  let approxSize = -1 // -1 = unknown, refreshed lazily after first append failure
  let warnedAboutDisk = false

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

  const append = (text: string) => {
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
      })
      .catch(() => undefined)
  }

  return {
    log(scope, event, data) {
      append(
        stringify({
          ts: new Date().toISOString(),
          pid: process.pid,
          scope,
          event,
          data,
        }),
      )
    },
    path() {
      return file
    },
    dir() {
      return dir
    },
  }
}
