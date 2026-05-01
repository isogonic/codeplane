import fs from "node:fs/promises"
import path from "node:path"

export type DesktopLogData = unknown
export type DesktopLogger = {
  log(scope: string, event: string, data?: DesktopLogData): void
  path(): string
}

type Entry = {
  ts: string
  pid: number
  scope: string
  event: string
  data?: DesktopLogData
}

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

  const append = (text: string) => {
    writes = writes
      .then(async () => {
        await fs.mkdir(dir, { recursive: true })
        await fs.appendFile(file, text)
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
  }
}
