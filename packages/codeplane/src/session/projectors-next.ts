import { and, desc, eq } from "@/storage"
import type { Database } from "@/storage"
import { SessionEntry } from "@/v2/session-entry"
import { SessionEntryStepper } from "@/v2/session-entry-stepper"
import { SessionEvent } from "@/v2/session-event"
import * as DateTime from "effect/DateTime"
import { SyncEvent } from "@/sync"
import { SessionEntryTable } from "./session.sql"
import type { SessionID } from "./schema"

function sqlite(db: Database.TxOrDb, sessionID: SessionID): SessionEntryStepper.Adapter<void> {
  return {
    getCurrentAssistant() {
      // The in-flight assistant is always the newest assistant row, so fetch
      // only that one. The previous `.all().map().find()` deserialized EVERY
      // assistant entry of the session on every streaming sub-event — O(N) per
      // event, O(N^2) over a long session, on the hot streaming path.
      const row = db
        .select()
        .from(SessionEntryTable)
        .where(and(eq(SessionEntryTable.session_id, sessionID), eq(SessionEntryTable.type, "assistant")))
        .orderBy(desc(SessionEntryTable.id))
        .limit(1)
        .get()
      if (!row) return undefined
      const entry = { id: row.id, type: row.type, ...row.data } as SessionEntry.Entry
      return entry.type === "assistant" && !entry.time.completed ? entry : undefined
    },
    updateAssistant(assistant) {
      const { id, type, ...data } = assistant
      db.update(SessionEntryTable)
        .set({ data })
        .where(
          and(
            eq(SessionEntryTable.id, id),
            eq(SessionEntryTable.session_id, sessionID),
            eq(SessionEntryTable.type, type),
          ),
        )
        .run()
    },
    appendEntry(entry) {
      const { id, type, ...data } = entry
      db.insert(SessionEntryTable)
        .values({
          id,
          session_id: sessionID,
          type,
          time_created: DateTime.toEpochMillis(entry.time.created),
          data,
        })
        .run()
    },
    appendPending() {},
    finish() {},
  }
}

function step(db: Database.TxOrDb, event: SessionEvent.Event) {
  SessionEntryStepper.stepWith(sqlite(db, event.data.sessionID), event)
}

// Tool.Progress fires per chunk during tool execution, and each one rewrites the
// entire assistant entry blob to SessionEntryTable. Live UI progress flows
// through the separate SSE MessageV2.PartUpdated path; this DB blob is only read
// on cold load/reconnect, and the final tool state is always written on
// success/error. So coalesce the per-chunk progress writes to at most one per
// window per session — turning O(chunks) full-blob writes into a trickle.
// Progress is latest-wins, so a skipped intermediate write loses nothing durable.
const lastProgressWrite = new Map<string, number>()
const PROGRESS_WRITE_INTERVAL_MS = 200

export default [
  SyncEvent.project(SessionEvent.Prompted.Sync, (db, data) => {
    step(db, { type: "session.next.prompted", data })
  }),
  SyncEvent.project(SessionEvent.Synthetic.Sync, (db, data) => {
    step(db, { type: "session.next.synthetic", data })
  }),
  SyncEvent.project(SessionEvent.Step.Started.Sync, (db, data) => {
    step(db, { type: "session.next.step.started", data })
  }),
  SyncEvent.project(SessionEvent.Step.Ended.Sync, (db, data) => {
    step(db, { type: "session.next.step.ended", data })
  }),
  SyncEvent.project(SessionEvent.Text.Started.Sync, (db, data) => {
    step(db, { type: "session.next.text.started", data })
  }),
  SyncEvent.project(SessionEvent.Text.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Text.Ended.Sync, (db, data) => {
    step(db, { type: "session.next.text.ended", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Input.Started.Sync, (db, data) => {
    step(db, { type: "session.next.tool.input.started", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Input.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Tool.Input.Ended.Sync, (db, data) => {
    step(db, { type: "session.next.tool.input.ended", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Called.Sync, (db, data) => {
    step(db, { type: "session.next.tool.called", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Progress.Sync, (db, data) => {
    const now = Date.now()
    const last = lastProgressWrite.get(data.sessionID) ?? 0
    if (now - last < PROGRESS_WRITE_INTERVAL_MS) return // coalesce intermediate progress
    lastProgressWrite.set(data.sessionID, now)
    step(db, { type: "session.next.tool.progress", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Success.Sync, (db, data) => {
    lastProgressWrite.delete(data.sessionID)
    step(db, { type: "session.next.tool.success", data })
  }),
  SyncEvent.project(SessionEvent.Tool.Error.Sync, (db, data) => {
    lastProgressWrite.delete(data.sessionID)
    step(db, { type: "session.next.tool.error", data })
  }),
  SyncEvent.project(SessionEvent.Reasoning.Started.Sync, (db, data) => {
    step(db, { type: "session.next.reasoning.started", data })
  }),
  SyncEvent.project(SessionEvent.Reasoning.Delta.Sync, () => {}),
  SyncEvent.project(SessionEvent.Reasoning.Ended.Sync, (db, data) => {
    step(db, { type: "session.next.reasoning.ended", data })
  }),
  SyncEvent.project(SessionEvent.Retried.Sync, (db, data) => {
    step(db, { type: "session.next.retried", data })
  }),
  SyncEvent.project(SessionEvent.Compacted.Sync, (db, data) => {
    step(db, { type: "session.next.compacted", data })
  }),
]
