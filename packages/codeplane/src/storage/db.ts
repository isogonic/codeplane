import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "../util"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util"
import { NamedError } from "@codeplane-ai/shared/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "../flag/flag"
import { InstallationChannel } from "../installation/version"
import { InstanceState } from "@/effect"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const CODEPLANE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.CODEPLANE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "codeplane.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `codeplane-${safe}.db`)
}

export const Path = iife(() => {
  if (Flag.CODEPLANE_DB) {
    if (Flag.CODEPLANE_DB === ":memory:" || path.isAbsolute(Flag.CODEPLANE_DB)) return Flag.CODEPLANE_DB
    return path.join(Global.Path.data, Flag.CODEPLANE_DB)
  }
  return getChannelPath()
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

// Periodic WAL truncation. With `journal_mode = WAL` + `synchronous = NORMAL`
// the WAL file grows on every commit and is only checkpointed (folded back
// into the main DB and truncated) automatically on a passive schedule that
// can fall arbitrarily far behind under long-running write activity. A long
// session that streams reasoning deltas + part updates can grow the WAL into
// the hundreds of MB before the next reader triggers a checkpoint.
//
// We run a TRUNCATE checkpoint every CHECKPOINT_INTERVAL_MS to keep the WAL
// bounded. TRUNCATE is the strongest mode — it folds all committed pages
// into the main DB AND shrinks the WAL file back to zero — but it can be
// blocked by readers holding a snapshot. That's fine: we ignore the result
// and try again next tick. Worst case we miss a few cycles during heavy load
// and the WAL grows; we'll catch up when the readers go away.
const CHECKPOINT_INTERVAL_MS = 60_000
let checkpointTimer: ReturnType<typeof setInterval> | undefined

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  // `wal_autocheckpoint` is the per-commit threshold (default 1000 pages =
  // ~4 MB). Lower it modestly so steady-state stays small without thrashing
  // the disk. Independent of the periodic TRUNCATE below.
  db.run("PRAGMA wal_autocheckpoint = 1000")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply schema migrations
  const entries =
    typeof CODEPLANE_MIGRATIONS !== "undefined"
      ? CODEPLANE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0 && !Flag.CODEPLANE_SKIP_MIGRATIONS) {
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof CODEPLANE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    migrate(db, entries)
  }

  // Best-effort periodic TRUNCATE. We do NOT log on the success path — at
  // 60s cadence over a long-running server that's a lot of noise — but a
  // failure that isn't SQLITE_BUSY-style contention is worth surfacing.
  if (!checkpointTimer && Path !== ":memory:") {
    checkpointTimer = setInterval(() => {
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE)")
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // SQLITE_BUSY/SQLITE_LOCKED are expected under read load; everything
        // else (corruption, IO error) we want to know about.
        if (!/busy|locked/i.test(msg)) log.warn("wal_checkpoint failed", { error: msg })
      }
    }, CHECKPOINT_INTERVAL_MS)
    // Don't keep the event loop alive just for the checkpoint timer.
    checkpointTimer.unref?.()
  }

  return db
})

export function close() {
  if (checkpointTimer) {
    clearInterval(checkpointTimer)
    checkpointTimer = undefined
  }
  // Final synchronous TRUNCATE before close so the next process opens a
  // tidy WAL. Errors here are non-fatal — close() must succeed.
  try {
    Client().$client.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } catch {
    // ignore
  }
  Client().$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}
