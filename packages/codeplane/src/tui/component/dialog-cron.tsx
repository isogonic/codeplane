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

// TUI cron management. Scopes:
//   - List         : `client.cron.list()` — directory-scoped because the
//                    SDK client this dialog imports was already constructed
//                    with the current directory in `tui/context/sdk.tsx`.
//                    No need to pass `directory` ourselves.
//   - Toggle       : `space` — calls setStatus to flip between "active"
//                    and "paused". Reflects optimistically by re-fetching.
//   - Trigger now  : `r` — fires `cron.trigger`, runs the task immediately.
//   - Delete       : `d` — DialogConfirm gate, then `cron.delete`.
//   - Create new   : `n` — chained DialogPrompts (name → schedule → prompt
//                    text), then `cron.create` with the current directory
//                    so the task is scoped to this project.
// Schedule input format for creation:
//   - "every 30m" / "every 2h" → interval kind
//   - anything else            → cron kind, expression as-is

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

export function DialogCron() {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [busyTaskID, setBusyTaskID] = createSignal<string | null>(null)
  // bumping this signal triggers createResource to refetch
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
        onSelect: () => {},
      }
    })
  })

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
        await DialogAlert.show(
          dialog,
          "Couldn't change status",
          `Server rejected the status change for "${task.name}": ${typeof result.error === "object" && result.error && "error" in result.error ? String((result.error as { error: unknown }).error) : JSON.stringify(result.error)}`,
        )
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
        await DialogAlert.show(
          dialog,
          "Couldn't trigger task",
          `Server rejected the trigger for "${task.name}": ${typeof result.error === "object" && result.error && "error" in result.error ? String((result.error as { error: unknown }).error) : JSON.stringify(result.error)}`,
        )
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
        await DialogAlert.show(
          dialog,
          "Couldn't delete task",
          `Server rejected the delete for "${task.name}": ${typeof result.error === "object" && result.error && "error" in result.error ? String((result.error as { error: unknown }).error) : JSON.stringify(result.error)}`,
        )
        return
      }
      refresh()
    })
  }

  async function createTask() {
    const name = await DialogPrompt.show(dialog, "Name", { placeholder: "e.g. Nightly summary" })
    if (!name) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    const scheduleRaw = await DialogPrompt.show(dialog, "Schedule", {
      placeholder: "e.g. every 30m  ·  every 2h  ·  0 9 * * 1-5",
      description: () => (
        <text fg={theme.textMuted}>
          {`Use \`every Nm\` / \`every Nh\` for an interval, or a 5-field cron expression.`}
        </text>
      ),
    })
    if (!scheduleRaw) return
    const trimmedSchedule = scheduleRaw.trim()
    if (!trimmedSchedule) return
    const intervalMs = parseInterval(trimmedSchedule)
    const schedule: Schedule = intervalMs ? { kind: "interval", intervalMs } : { kind: "cron", expression: trimmedSchedule }
    const prompt = await DialogPrompt.show(dialog, "Prompt", {
      placeholder: "What should the agent do when this runs?",
    })
    if (!prompt) return
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return
    const result = await sdk.client.cron.create({
      name: trimmedName,
      prompt: trimmedPrompt,
      schedule,
    })
    if (result.error) {
      await DialogAlert.show(
        dialog,
        "Couldn't create task",
        `Server rejected the new task: ${typeof result.error === "object" && result.error && "error" in result.error ? String((result.error as { error: unknown }).error) : JSON.stringify(result.error)}`,
      )
      return
    }
    refresh()
    // Reopen the cron dialog so the user lands back on the list with
    // their new task visible (DialogPrompt swap left us elsewhere).
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
      placeholder="Search tasks..."
      options={options()}
      keybind={keybinds()}
      onSelect={() => {
        // Don't close on Enter — the actions are keybinds, the dialog
        // stays open until the user hits Esc.
      }}
    />
  )
}
