import { createMemo, createResource, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { Keybind } from "@/tui/_compat/keybind"
import { useSDK } from "@/tui/context/sdk"
import { useTheme } from "@/tui/context/theme"
import { useDialog } from "@/tui/ui/dialog"
import { DialogPrompt } from "@/tui/ui/dialog-prompt"
import { DialogConfirm } from "@/tui/ui/dialog-confirm"
import { DialogAlert } from "@/tui/ui/dialog-alert"
import {
  DialogSelect,
  type DialogSelectOption,
  type DialogSelectRef,
} from "@/tui/ui/dialog-select"

// TUI cron management. Three views, all DialogSelect-based:
//
//   1. Task list (this file's default export `DialogCron`)
//      ── space  toggle active/paused
//      ── r      trigger now
//      ── d      delete (with confirm)
//      ── n      new task (3-step flow with schedule preset wizard)
//      ── enter  open run history for the selected task → view 2
//
//   2. Run history (`DialogCronRuns`)
//      ── enter  open run details → view 3
//      ── c      cancel the selected run (only valid for status=running)
//      ── back   esc returns to view 1
//
//   3. Run details (`DialogAlert` with formatted body)
//      ── ok     dismiss back to view 2
//
// SDK calls all hit endpoints declared on the generated SDK; the TUI's
// SDK client is already directory-scoped, so list calls automatically
// return only the current project's tasks.

type Schedule =
  | { kind: "cron"; expression: string }
  | { kind: "interval"; intervalMs: number }

type CronTaskShape = {
  id: string
  name: string
  description?: string
  schedule: Schedule
  status: "active" | "paused" | string
  lastRunStatus?: string | null
  lastRunAt?: number | null
  nextRunAt?: number | null
  lastError?: string | null
  prompt?: string
}

type CronRunShape = {
  id: string
  taskID: string
  sessionID?: string | null
  status: string
  attempt: number
  timeStarted?: number | null
  timeCompleted?: number | null
  errorMessage?: string | null
  logs?: string | null
  time?: { created?: number; updated?: number }
}

function describeSchedule(task: CronTaskShape): string {
  const s = task.schedule
  if (!s) return "?"
  if (s.kind === "cron") return `cron · ${s.expression}`
  const mins = Math.round(s.intervalMs / 60_000)
  if (mins < 60) return `every ${mins}m`
  const hours = Math.round(s.intervalMs / (60 * 60_000))
  return `every ${hours}h`
}

function formatRelative(ms: number | null | undefined, now = Date.now()): string | undefined {
  if (!ms) return undefined
  const diff = ms - now
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const sign = diff >= 0 ? "in " : ""
  const suffix = diff >= 0 ? "" : " ago"
  if (abs < minute) return `${sign}${Math.round(abs / 1000)}s${suffix}`
  if (abs < hour) return `${sign}${Math.round(abs / minute)}m${suffix}`
  if (abs < day) return `${sign}${Math.round(abs / hour)}h${suffix}`
  return `${sign}${Math.round(abs / day)}d${suffix}`
}

function formatAbsolute(ms: number | null | undefined): string {
  if (!ms) return "—"
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
}

function formatDuration(start: number | null | undefined, end: number | null | undefined): string | undefined {
  if (!start) return undefined
  const finish = end ?? Date.now()
  const ms = finish - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

// "every 30m" / "every 2h" → milliseconds; else null (caller treats as cron expr)
function parseInterval(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^every\s+(\d+)\s*([smhd])$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  switch (m[2]) {
    case "s":
      return n * 1000
    case "m":
      return n * 60_000
    case "h":
      return n * 60 * 60_000
    case "d":
      return n * 24 * 60 * 60_000
    default:
      return null
  }
}

// Schedule presets surfaced by the wizard. Order matches what's most
// useful for typical agent automation (daily summaries, CI-aligned
// schedules, frequent polling). "Custom..." falls through to the raw
// text prompt so power users can drop a 5-field cron expression.
type SchedulePreset = { label: string; hint: string; schedule: Schedule | "custom" }
const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: "Daily at 9 am", hint: "0 9 * * *", schedule: { kind: "cron", expression: "0 9 * * *" } },
  { label: "Weekdays at 9 am", hint: "0 9 * * 1-5", schedule: { kind: "cron", expression: "0 9 * * 1-5" } },
  { label: "Every hour, on the hour", hint: "0 * * * *", schedule: { kind: "cron", expression: "0 * * * *" } },
  { label: "Every 30 minutes", hint: "every 30m", schedule: { kind: "interval", intervalMs: 30 * 60_000 } },
  { label: "Every 5 minutes", hint: "every 5m", schedule: { kind: "interval", intervalMs: 5 * 60_000 } },
  { label: "Every minute", hint: "every 1m", schedule: { kind: "interval", intervalMs: 60_000 } },
  { label: "Custom expression…", hint: "cron syntax or `every Nm`", schedule: "custom" },
]

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    return String((error as { error: unknown }).error)
  }
  if (error instanceof Error) return error.message
  return JSON.stringify(error)
}

// ---------- Run-history view (sub-dialog) ----------

function DialogCronRuns(props: { task: CronTaskShape; onBack: () => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [revision, setRevision] = createSignal(0)

  const [runs] = createResource(
    () => revision(),
    async () => {
      const result = await sdk.client.cron.runs.list({ taskID: props.task.id, limit: 50 })
      return ((result.data ?? []) as CronRunShape[]).slice().sort((a, b) => {
        const ta = a.timeStarted ?? a.time?.created ?? 0
        const tb = b.timeStarted ?? b.time?.created ?? 0
        return tb - ta
      })
    },
  )

  function refresh() {
    setRevision((n) => n + 1)
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = runs() ?? []
    if (list.length === 0) {
      return [
        {
          value: "__empty__",
          title: "No runs yet",
          description: "Trigger the task with `r` from the task list, then come back here.",
          category: undefined,
          onSelect: () => props.onBack(),
        },
      ]
    }
    return list.map<DialogSelectOption<string>>((run) => {
      const started = run.timeStarted ?? run.time?.created
      const duration = formatDuration(started, run.timeCompleted)
      const when = formatRelative(started) ?? formatAbsolute(started)
      const desc = [
        `attempt ${run.attempt}`,
        duration ? `took ${duration}` : undefined,
        run.sessionID ? `session ${run.sessionID.slice(0, 12)}` : undefined,
      ]
        .filter(Boolean)
        .join("  ·  ")
      const status = run.status
      const statusColor =
        status === "succeeded"
          ? theme.success
          : status === "failed" || status === "cancelled"
            ? theme.warning
            : status === "running"
              ? theme.primary
              : theme.textMuted
      return {
        value: run.id,
        title: when,
        description: desc,
        footer: <span style={{ fg: statusColor, attributes: TextAttributes.BOLD }}>{status}</span>,
        category: undefined,
        onSelect: () => showRunDetails(run),
      }
    })
  })

  async function showRunDetails(run: CronRunShape) {
    const lines = [
      `Status      : ${run.status}`,
      `Attempt     : ${run.attempt}`,
      `Started     : ${formatAbsolute(run.timeStarted ?? run.time?.created)}`,
      `Completed   : ${formatAbsolute(run.timeCompleted)}`,
      `Duration    : ${formatDuration(run.timeStarted ?? run.time?.created, run.timeCompleted) ?? "—"}`,
      run.sessionID ? `Session     : ${run.sessionID}` : undefined,
      run.errorMessage ? `\nError:\n${run.errorMessage}` : undefined,
      run.logs ? `\nLogs (tail):\n${run.logs.split("\n").slice(-30).join("\n")}` : undefined,
    ].filter(Boolean) as string[]
    await DialogAlert.show(dialog, `Run ${run.id.slice(0, 12)}`, lines.join("\n"))
    refresh()
  }

  async function cancelRun(option: DialogSelectOption<string>) {
    if (option.value === "__empty__") return
    const list = runs() ?? []
    const run = list.find((r) => r.id === option.value)
    if (!run) return
    if (run.status !== "running") {
      await DialogAlert.show(
        dialog,
        "Can't cancel",
        `Run is in state "${run.status}". Only currently-running runs can be cancelled.`,
      )
      return
    }
    const confirmed = await DialogConfirm.show(
      dialog,
      "Cancel run",
      `Cancel run ${run.id.slice(0, 12)}? The agent will be stopped mid-execution.`,
      "cancel",
    )
    if (confirmed !== true) return
    const result = await sdk.client.cron.runs.cancel({ runID: run.id })
    if (result.error) {
      await DialogAlert.show(dialog, "Couldn't cancel run", errorMessage(result.error))
      return
    }
    refresh()
  }

  const keybinds = createMemo(() => [
    { keybind: Keybind.parse("c")[0], title: "cancel run", onTrigger: cancelRun },
    {
      keybind: Keybind.parse("escape")[0],
      title: "back to tasks",
      onTrigger: () => props.onBack(),
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title={`Runs · ${props.task.name}`}
      placeholder="Search runs..."
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        const list = runs() ?? []
        const run = list.find((r) => r.id === option.value)
        if (run) void showRunDetails(run)
      }}
    />
  )
}

// ---------- Schedule preset wizard ----------

async function pickSchedule(dialog: ReturnType<typeof useDialog>, theme: ReturnType<typeof useTheme>["theme"]): Promise<Schedule | null> {
  return new Promise<Schedule | null>((resolve) => {
    const options: DialogSelectOption<number>[] = SCHEDULE_PRESETS.map((preset, idx) => ({
      value: idx,
      title: preset.label,
      description: preset.hint,
      category: undefined,
      onSelect: async () => {
        if (preset.schedule === "custom") {
          dialog.replace(() => (
            <CustomScheduleStep
              theme={theme}
              onPicked={(schedule) => resolve(schedule)}
            />
          ))
          return
        }
        dialog.clear()
        resolve(preset.schedule)
      },
    }))
    dialog.replace(() => (
      <DialogSelect
        title="Schedule"
        placeholder="Pick a preset or Custom..."
        options={options}
        onSelect={() => {
          // handled in onSelect of each option via dialog.replace/clear
        }}
      />
    ))
  })
}

function CustomScheduleStep(props: { theme: ReturnType<typeof useTheme>["theme"]; onPicked: (s: Schedule) => void }) {
  const dialog = useDialog()
  return (
    <DialogPrompt
      title="Custom schedule"
      placeholder="e.g. every 30m  ·  every 2h  ·  0 9 * * 1-5"
      description={() => (
        <text fg={props.theme.textMuted}>
          {`Use \`every Nm\` / \`every Nh\` / \`every Nd\` for an interval, or a 5-field cron expression.`}
        </text>
      )}
      onConfirm={(value) => {
        const trimmed = value.trim()
        if (!trimmed) {
          dialog.clear()
          props.onPicked({ kind: "interval", intervalMs: 0 }) // resolved as no-op upstream
          return
        }
        const intervalMs = parseInterval(trimmed)
        const schedule: Schedule = intervalMs
          ? { kind: "interval", intervalMs }
          : { kind: "cron", expression: trimmed }
        dialog.clear()
        props.onPicked(schedule)
      }}
      onCancel={() => {
        dialog.clear()
      }}
    />
  )
}

// ---------- Main task list view ----------

export function DialogCron() {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [busyTaskID, setBusyTaskID] = createSignal<string | null>(null)
  const [revision, setRevision] = createSignal(0)

  const [tasks] = createResource(
    () => revision(),
    async () => {
      const result = await sdk.client.cron.list()
      return ((result.data ?? []) as CronTaskShape[]).slice().sort((a, b) => a.name.localeCompare(b.name))
    },
  )

  function refresh() {
    setRevision((n) => n + 1)
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = tasks() ?? []
    const busy = busyTaskID()
    if (list.length === 0) {
      return [
        {
          value: "__empty__",
          title: "No scheduled tasks yet",
          description: "Press n to create one. Press esc to dismiss.",
          category: undefined,
          onSelect: () => {},
        },
      ]
    }
    const maxName = Math.max(0, ...list.map((t) => t.name.length))
    return list.map<DialogSelectOption<string>>((task) => {
      const status = task.status === "active" ? "✓ active" : task.status === "paused" ? "○ paused" : task.status
      const next = formatRelative(task.nextRunAt)
      const last = formatRelative(task.lastRunAt)
      const lastStatus = task.lastRunStatus
      const isBusy = busy === task.id
      const desc = [
        describeSchedule(task),
        next ? `next ${next}` : undefined,
        last ? `last ${last}${lastStatus ? ` (${lastStatus})` : ""}` : undefined,
      ]
        .filter(Boolean)
        .join("  ·  ")
      return {
        value: task.id,
        title: task.name.padEnd(maxName),
        description: desc,
        footer: (
          <span
            style={{
              fg: isBusy
                ? theme.textMuted
                : task.status === "active"
                  ? theme.success
                  : theme.textMuted,
              attributes: task.status === "active" ? TextAttributes.BOLD : 0,
            }}
          >
            {isBusy ? "⋯ working" : status}
          </span>
        ),
        category: undefined,
        onSelect: () => openRuns(task),
      }
    })
  })

  function openRuns(task: CronTaskShape) {
    dialog.replace(() => (
      <DialogCronRuns
        task={task}
        onBack={() => {
          dialog.replace(() => <DialogCron />)
        }}
      />
    ))
  }

  async function withBusy<T>(taskID: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busyTaskID()) return undefined
    setBusyTaskID(taskID)
    try {
      return await fn()
    } finally {
      setBusyTaskID(null)
    }
  }

  async function toggle(option: DialogSelectOption<string>) {
    if (option.value === "__empty__") return
    const list = tasks() ?? []
    const task = list.find((t) => t.id === option.value)
    if (!task) return
    const next = task.status === "active" ? "paused" : "active"
    await withBusy(task.id, async () => {
      const result = await sdk.client.cron.setStatus({ taskID: task.id, status: next })
      if (result.error) {
        await DialogAlert.show(dialog, "Couldn't change status", errorMessage(result.error))
        return
      }
      refresh()
    })
  }

  async function triggerNow(option: DialogSelectOption<string>) {
    if (option.value === "__empty__") return
    const list = tasks() ?? []
    const task = list.find((t) => t.id === option.value)
    if (!task) return
    await withBusy(task.id, async () => {
      const result = await sdk.client.cron.trigger({ taskID: task.id })
      if (result.error) {
        await DialogAlert.show(dialog, "Couldn't trigger task", errorMessage(result.error))
        return
      }
      refresh()
    })
  }

  async function deleteTask(option: DialogSelectOption<string>) {
    if (option.value === "__empty__") return
    const list = tasks() ?? []
    const task = list.find((t) => t.id === option.value)
    if (!task) return
    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete task",
      `Delete the scheduled task "${task.name}"? This cannot be undone.`,
      "delete",
    )
    if (confirmed !== true) return
    await withBusy(task.id, async () => {
      const result = await sdk.client.cron.delete({ taskID: task.id })
      if (result.error) {
        await DialogAlert.show(dialog, "Couldn't delete task", errorMessage(result.error))
        return
      }
      refresh()
    })
  }

  async function createTask() {
    const name = await DialogPrompt.show(dialog, "Name", { placeholder: "e.g. Nightly summary" })
    if (!name) {
      dialog.replace(() => <DialogCron />)
      return
    }
    const trimmedName = name.trim()
    if (!trimmedName) {
      dialog.replace(() => <DialogCron />)
      return
    }
    const schedule = await pickSchedule(dialog, theme)
    if (!schedule || schedule.kind === "interval" && schedule.intervalMs === 0) {
      dialog.replace(() => <DialogCron />)
      return
    }
    const prompt = await DialogPrompt.show(dialog, "Prompt", {
      placeholder: "What should the agent do when this runs?",
    })
    if (!prompt) {
      dialog.replace(() => <DialogCron />)
      return
    }
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      dialog.replace(() => <DialogCron />)
      return
    }
    const result = await sdk.client.cron.create({
      name: trimmedName,
      prompt: trimmedPrompt,
      schedule,
    })
    if (result.error) {
      await DialogAlert.show(dialog, "Couldn't create task", errorMessage(result.error))
      dialog.replace(() => <DialogCron />)
      return
    }
    refresh()
    dialog.replace(() => <DialogCron />)
  }

  const keybinds = createMemo(() => [
    { keybind: Keybind.parse("space")[0], title: "toggle", onTrigger: toggle },
    { keybind: Keybind.parse("r")[0], title: "run now", onTrigger: triggerNow },
    { keybind: Keybind.parse("d")[0], title: "delete", onTrigger: deleteTask },
    {
      keybind: Keybind.parse("n")[0],
      title: "new task",
      onTrigger: () => {
        void createTask()
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="Scheduled tasks"
      placeholder="Search tasks (press enter for runs)..."
      options={options()}
      keybind={keybinds()}
      onSelect={(option) => {
        const list = tasks() ?? []
        const task = list.find((t) => t.id === option.value)
        if (task) openRuns(task)
      }}
    />
  )
}
