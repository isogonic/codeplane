import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, For, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@codeplane-ai/ui/button"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Select } from "@codeplane-ai/ui/select"
import { Tag } from "@codeplane-ai/ui/tag"
import { TextField } from "@codeplane-ai/ui/text-field"
import { Tooltip } from "@codeplane-ai/ui/tooltip"
import { showToast } from "@codeplane-ai/ui/toast"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useProviders } from "@/hooks/use-providers"
import {
  CronClient,
  type CronApiError,
  type CronCreateInput,
  type CronRunStatus,
  type CronStatus,
  type CronTask,
  type CronUpdateInput,
} from "@/utils/cron-client"
import { base64Encode } from "@codeplane-ai/shared/util/encode"
import { decode64 } from "@/utils/base64"
import { cronAgentOptions, type CronAgentOption } from "./cron-agents"
import { cronProjectForDirectory, cronProjectIDForRoute, cronTaskInScope, type CronProjectScope } from "./cron-scope"

const CRON_QUERY_KEY = ["cron", "tasks"] as const
const CRON_TASKS_STALE_MS = 5_000
const CRON_TASKS_GC_MS = 60_000

type CronProject = CronProjectScope & { name?: string }

function formatRelative(ms: number | undefined, intl: Intl.Locale | string, now = Date.now()) {
  if (!ms) return undefined
  const diff = ms - now
  const abs = Math.abs(diff)
  const formatter = new Intl.RelativeTimeFormat(intl.toString(), { numeric: "auto" })
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (abs < minute) return formatter.format(Math.round(diff / 1000), "second")
  if (abs < hour) return formatter.format(Math.round(diff / minute), "minute")
  if (abs < day) return formatter.format(Math.round(diff / hour), "hour")
  return formatter.format(Math.round(diff / day), "day")
}

function describeSchedule(task: CronTask, language: ReturnType<typeof useLanguage>) {
  if (task.schedule.kind === "cron") return `cron · ${task.schedule.expression}`
  const mins = Math.round(task.schedule.intervalMs / 60_000)
  return `${language.t("cron.field.schedule.interval")}: ${mins}`
}

function statusClass(status: CronStatus | CronRunStatus): string {
  switch (status) {
    case "active":
    case "success":
      return "bg-surface-success-base/20 text-text-success-base"
    case "running":
    case "queued":
      return "bg-surface-info-base/20 text-text-info-base"
    case "paused":
    case "cancelled":
    case "disabled":
      return "bg-surface-warning-base/20 text-text-warning-base"
    case "failed":
    case "timeout":
      return "bg-surface-critical-base/20 text-text-critical-base"
    default:
      return "bg-surface-raised-base text-text-base"
  }
}

export default function CronPage() {
  const params = useParams<{ projectID?: string; dir?: string }>()
  const location = useLocation()
  const server = useServer()
  const globalSync = useGlobalSync()

  const httpServer = createMemo(() => server.current?.http)

  const projects = createMemo(() =>
    (globalSync.data.project ?? []).filter((p) => p.id !== "global"),
  )
  const selectedDirectory = createMemo(() => decode64(params.dir))
  const queryProjectID = createMemo(() => new URLSearchParams(location.search).get("projectID") ?? undefined)
  const routeProjectID = createMemo(() => params.projectID ?? queryProjectID())
  const selectedProject = createMemo<CronProject | undefined>(() => {
    const dir = selectedDirectory()
    if (dir) return cronProjectForDirectory(dir, projects(), queryProjectID())
    return projects().find((p) => p.id === routeProjectID())
  })
  const selectedProjectID = createMemo(() => cronProjectIDForRoute(selectedProject(), routeProjectID()))
  const navigate = useNavigate()

  createEffect(() => {
    const project = selectedProject()
    if (!project) return
    if (params.dir) return
    navigate(`/cron/worktree/${base64Encode(project.worktree)}${project.id ? `?projectID=${encodeURIComponent(project.id)}` : ""}`, { replace: true })
  })

  const tasksQuery = useQuery(() => ({
    queryKey: [...CRON_QUERY_KEY, server.scope.key, selectedProjectID(), selectedDirectory()],
    queryFn: async () => {
      const conn = httpServer()
      const pid = selectedProjectID()
      const dir = selectedDirectory()
      if (!conn) return [] as CronTask[]
      if (pid) return CronClient.list(conn, { projectID: pid })
      if (dir) return CronClient.list(conn, { directory: dir })
      return [] as CronTask[]
    },
    enabled: !!httpServer() && (!!selectedProjectID() || !!selectedDirectory()),
    refetchInterval: 5_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: CRON_TASKS_STALE_MS,
    gcTime: CRON_TASKS_GC_MS,
    retry: 1,
  }))

  const tasksForSelected = createMemo(() =>
    (tasksQuery.data ?? []).filter((task) => {
      const pid = selectedProjectID()
      const dir = selectedDirectory()
      return cronTaskInScope(task, {
        projectID: pid,
        project: selectedProject(),
        directory: dir,
      })
    }),
  )

  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <CronPageHeader selectedProject={selectedProject} />
        <CronTasksSection
          server={httpServer}
          tasks={tasksForSelected}
          selectedProject={selectedProject}
        />
      </div>
    </div>
  )
}

function CronPageHeader(props: {
  selectedProject: Accessor<CronProject | undefined>
}) {
  const language = useLanguage()
  const dialog = useDialog()

  const openEditor = () => {
    const project = props.selectedProject()
    if (!project?.worktree) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("cron.create.noProject"),
      })
      return
    }
    dialog.show(() => (
      <CronEditorDialog project={project} />
    ))
  }

  return (
    <div class="flex flex-col gap-4 shrink-0">
      <div class="shrink-0 flex items-center gap-4 justify-between border-b border-border-weak-base pb-4">
        <div class="min-w-0">
          <div class="text-20-medium text-text-strong truncate">{language.t("cron.title")}</div>
          <div class="text-12-regular text-text-weak">{language.t("cron.subtitle")}</div>
        </div>
        <Button variant="primary" size="large" icon="plus-small" onClick={openEditor}>
          {language.t("cron.create")}
        </Button>
      </div>
    </div>
  )
}

function CronTasksSection(props: {
  server: Accessor<{ url: string; username?: string; password?: string } | undefined>
  tasks: Accessor<CronTask[]>
  selectedProject: Accessor<CronProject | undefined>
}) {
  const language = useLanguage()
  const dialog = useDialog()

  const openEditor = (task?: CronTask) => {
    const project = props.selectedProject()
    if (!project?.worktree) return
    dialog.show(() => (
      <CronEditorDialog
        project={project}
        existing={task}
      />
    ))
  }

  return (
    <Show
      when={props.tasks().length > 0}
      fallback={
        <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
          {props.selectedProject() ? language.t("cron.empty.project") : language.t("cron.empty")}
        </div>
      }
    >
      <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
        <For each={props.tasks()}>
          {(task) => (
            <CronTaskRow task={task} server={props.server} onEdit={() => openEditor(task)} />
          )}
        </For>
      </ul>
    </Show>
  )
}

function CronTaskRow(props: {
  task: CronTask
  server: Accessor<{ url: string; username?: string; password?: string } | undefined>
  onEdit: () => void
}) {
  const language = useLanguage()
  const queryClient = useQueryClient()
  const intl = useLanguage().intl

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cron"] })

  const setStatus = useMutation(() => ({
    mutationFn: async (next: CronStatus) => {
      const conn = props.server()
      if (!conn) throw new Error("No server connection")
      return CronClient.setStatus(conn, props.task.id, next)
    },
    onSuccess: () => invalidate(),
    onError: (err: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const trigger = useMutation(() => ({
    mutationFn: async () => {
      const conn = props.server()
      if (!conn) throw new Error("No server connection")
      return CronClient.trigger(conn, props.task.id)
    },
    onSuccess: () => invalidate(),
    onError: (err: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  const remove = useMutation(() => ({
    mutationFn: async () => {
      if (!confirm(language.t("cron.delete.confirm"))) return
      const conn = props.server()
      if (!conn) throw new Error("No server connection")
      return CronClient.remove(conn, props.task.id)
    },
    onSuccess: () => invalidate(),
    onError: (err: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      }),
  }))

  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="bell" size="small" class="icon-strong-base shrink-0" />
            <span class="truncate text-14-medium text-text-strong">{props.task.name}</span>
            <Tag>{language.t(`cron.status.${props.task.status}`)}</Tag>
            <Show when={props.task.lastRunStatus}>
              <Tag>{language.t(`cron.run.status.${props.task.lastRunStatus!}`)}</Tag>
            </Show>
          </div>
          <Show when={props.task.description}>
            <div class="mt-0.5 truncate text-12-regular text-text-weak">{props.task.description}</div>
          </Show>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-11-regular text-text-weak">
            <span class="truncate">{describeSchedule(props.task, language)}</span>
            <span>·</span>
            <span>
              {language.t("cron.next")}:{" "}
              {props.task.status === "active"
                ? (formatRelative(props.task.nextRunAt, intl()) ?? language.t("cron.never"))
                : "—"}
            </span>
            <Show when={props.task.lastRunAt}>
              <span>·</span>
              <span>
                {language.t("cron.last")}: {formatRelative(props.task.lastRunAt, intl())}
              </span>
            </Show>
          </div>
          <Show when={props.task.lastError && props.task.lastRunStatus !== "success"}>
            <div class="mt-1.5 text-12-regular text-text-critical-base whitespace-pre-wrap break-words line-clamp-3">
              {props.task.lastError}
            </div>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Tooltip value={language.t("cron.action.trigger")} placement="top">
            <IconButton
              icon="arrow-right"
              variant="ghost"
              size="normal"
              aria-label={language.t("cron.action.trigger")}
              disabled={trigger.isPending || props.task.status === "disabled"}
              onClick={() => trigger.mutate()}
            />
          </Tooltip>
          <Show
            when={props.task.status === "active"}
            fallback={
              <Tooltip value={language.t("cron.action.resume")} placement="top">
                <IconButton
                  icon="circle-check"
                  variant="ghost"
                  size="normal"
                  aria-label={language.t("cron.action.resume")}
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate("active")}
                />
              </Tooltip>
            }
          >
            <Tooltip value={language.t("cron.action.pause")} placement="top">
              <IconButton
                icon="circle-ban-sign"
                variant="ghost"
                size="normal"
                aria-label={language.t("cron.action.pause")}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate("paused")}
              />
            </Tooltip>
          </Show>
          <Tooltip value={language.t("cron.action.edit")} placement="top">
            <IconButton
              icon="edit"
              variant="ghost"
              size="normal"
              aria-label={language.t("cron.action.edit")}
              onClick={props.onEdit}
            />
          </Tooltip>
          <Tooltip value={language.t("cron.action.delete")} placement="top">
            <IconButton
              icon="trash"
              variant="ghost"
              size="normal"
              aria-label={language.t("cron.action.delete")}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            />
          </Tooltip>
        </div>
      </div>
    </li>
  )
}

type EditorState = {
  name: string
  description: string
  prompt: string
  scheduleKind: "cron" | "interval"
  cronExpression: string
  intervalMinutes: string
  timeoutMinutes: string
  agent: string
  model: string
  status: CronStatus
  errors: { name?: string; prompt?: string; schedule?: string; timeout?: string; form?: string }
}

function isCronApiError(err: unknown): err is CronApiError {
  return err instanceof Error && "status" in err
}

function isValidCronExpression(input: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: "Required" }
  if (/^@(?:hourly|daily|weekly|monthly|yearly|annually|midnight)$/i.test(trimmed)) return { ok: true }
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) return { ok: false, reason: `Expected 5 fields (got ${fields.length}). Example: 0 9 * * 1-5` }
  return { ok: true }
}

type ModelOption = { providerID: string; modelID: string; label: string; group: string }

function CronEditorDialog(props: {
  project: CronProject
  existing?: CronTask
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const queryClient = useQueryClient()
  const server = useServer()
  const providers = useProviders()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const httpServer = createMemo(() => server.current?.http)

  const agentsQuery = useQuery(() => ({
    queryKey: ["cron", "agents", server.scope.key, props.project.worktree],
    queryFn: async () => {
      const response = await globalSDK
        .createClient({ directory: props.project.worktree, throwOnError: true })
        .app.agents()
      return response.data ?? []
    },
    enabled: !!httpServer() && !!props.project.worktree,
    staleTime: 5_000,
  }))

  const agentOptions = createMemo<CronAgentOption[]>(() =>
    cronAgentOptions({
      agents: agentsQuery.data,
      config: globalSync.data.config,
      defaultLabel: language.t("common.default"),
    }),
  )

  const modelOptions = createMemo<ModelOption[]>(() => {
    const result: ModelOption[] = []
    for (const provider of providers.connected()) {
      for (const [id, model] of Object.entries(provider.models ?? {})) {
        result.push({
          providerID: provider.id,
          modelID: id,
          label: model.name ?? id,
          group: provider.name ?? provider.id,
        })
      }
    }
    return result.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
  })

  const initial = (): EditorState => {
    const e = props.existing
    if (!e)
      return {
        name: "",
        description: "",
        prompt: "",
        scheduleKind: "cron",
        cronExpression: "0 9 * * 1-5",
        intervalMinutes: "60",
        timeoutMinutes: "30",
        agent: "",
        model: "",
        status: "active",
        errors: {},
      }
    return {
      name: e.name,
      description: e.description ?? "",
      prompt: e.prompt,
      scheduleKind: e.schedule.kind,
      cronExpression: e.schedule.kind === "cron" ? e.schedule.expression : "0 9 * * 1-5",
      intervalMinutes:
        e.schedule.kind === "interval" ? String(Math.round(e.schedule.intervalMs / 60_000)) : "60",
      timeoutMinutes: e.timeoutMs ? String(Math.round(e.timeoutMs / 60_000)) : "30",
      agent: e.agent ?? "",
      model: e.model ?? "",
      status: e.status,
      errors: {},
    }
  }

  const [store, setStore] = createStore<EditorState>(initial())

  const validate = () => {
    const errors: EditorState["errors"] = {}
    if (!store.name.trim()) errors.name = language.t("cron.error.name.required")
    if (!store.prompt.trim()) errors.prompt = language.t("cron.error.prompt.required")
    if (store.scheduleKind === "cron") {
      const result = isValidCronExpression(store.cronExpression)
      if (!result.ok) errors.schedule = result.reason
    } else {
      const n = Number(store.intervalMinutes)
      if (!Number.isFinite(n) || n < 1) errors.schedule = language.t("cron.error.interval.min")
    }
    if (store.timeoutMinutes) {
      const n = Number(store.timeoutMinutes)
      if (!Number.isFinite(n) || n < 1) errors.timeout = language.t("cron.error.timeout.min")
    }
    setStore("errors", errors)
    return Object.keys(errors).length === 0
  }

  const applyServerError = (err: unknown) => {
    setStore("errors", {})
    if (!isCronApiError(err)) {
      setStore("errors", "form", err instanceof Error ? err.message : String(err))
      return
    }
    const next: EditorState["errors"] = {}
    if (err.fieldIssues && err.fieldIssues.length > 0) {
      for (const issue of err.fieldIssues) {
        const path = issue.path
        if (path === "name") next.name = issue.message
        else if (path === "prompt") next.prompt = issue.message
        else if (path === "schedule" || path.startsWith("schedule.")) next.schedule = issue.message
        else if (path === "timeoutMs" || path === "timeout") next.timeout = issue.message
        else next.form = (next.form ? `${next.form}; ` : "") + (path ? `${path}: ${issue.message}` : issue.message)
      }
    }
    if (Object.keys(next).length === 0) {
      next.form = err.message
    }
    setStore("errors", next)
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) {
        const e = new Error(language.t("cron.error.validation.fix"))
        ;(e as { _validation?: boolean })._validation = true
        throw e
      }
      const conn = httpServer()
      if (!conn) throw new Error("No server connection")
      const schedule =
        store.scheduleKind === "cron"
          ? { kind: "cron" as const, expression: store.cronExpression.trim() }
          : { kind: "interval" as const, intervalMs: Math.max(1, Number(store.intervalMinutes)) * 60_000 }
      const timeoutMs = store.timeoutMinutes
        ? Math.max(1, Number(store.timeoutMinutes)) * 60_000
        : undefined
      if (props.existing) {
        const body: CronUpdateInput = {
          name: store.name.trim(),
          description: store.description.trim() || null,
          prompt: store.prompt,
          schedule,
          timeoutMs: timeoutMs ?? null,
          agent: store.agent.trim() || null,
          model: store.model.trim() || null,
          status: store.status,
        }
        await CronClient.update(conn, props.existing.id, body)
      } else {
        const body: CronCreateInput = {
          ...(props.project.id ? { projectID: props.project.id } : {}),
          directory: props.project.worktree,
          name: store.name.trim(),
          description: store.description.trim() || undefined,
          prompt: store.prompt,
          schedule,
          timeoutMs,
          agent: store.agent.trim() || undefined,
          model: store.model.trim() || undefined,
          status: store.status,
        }
        await CronClient.create(conn, body)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cron"] })
      dialog.close()
    },
    onError: (err: unknown) => {
      if (err instanceof Error && (err as { _validation?: boolean })._validation) {
        return
      }
      applyServerError(err)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  return (
    <Dialog
      title={props.existing ? language.t("cron.action.edit") : language.t("cron.create")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <form
        novalidate
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
        class="flex flex-col gap-5 px-6 pt-0 pb-5"
      >
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            label={language.t("cron.field.name")}
            placeholder={language.t("cron.field.name.placeholder")}
            value={store.name}
            onChange={(v: string) => setStore("name", v)}
            error={store.errors.name}
          />
          <TextField
            label={language.t("cron.field.description")}
            placeholder={language.t("cron.field.description")}
            value={store.description}
            onChange={(v: string) => setStore("description", v)}
          />
          <TextField
            multiline
            label={language.t("cron.field.prompt")}
            placeholder={language.t("cron.field.prompt.placeholder")}
            value={store.prompt}
            onChange={(v: string) => setStore("prompt", v)}
            error={store.errors.prompt}
            class="max-h-40 w-full overflow-y-auto"
          />
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("cron.field.scheduleKind")}</label>
            <div class="inline-flex items-center gap-0.5 rounded-lg bg-surface-base p-1 self-start">
              <button
                type="button"
                class="px-3 h-7 rounded-md text-13-medium transition-colors"
                classList={{
                  "bg-surface-base-active text-text-strong": store.scheduleKind === "cron",
                  "text-text-weak hover:text-text-base": store.scheduleKind !== "cron",
                }}
                onClick={() => setStore("scheduleKind", "cron")}
              >
                Cron
              </button>
              <button
                type="button"
                class="px-3 h-7 rounded-md text-13-medium transition-colors"
                classList={{
                  "bg-surface-base-active text-text-strong": store.scheduleKind === "interval",
                  "text-text-weak hover:text-text-base": store.scheduleKind !== "interval",
                }}
                onClick={() => setStore("scheduleKind", "interval")}
              >
                Interval
              </button>
            </div>
          </div>
          <Show
            when={store.scheduleKind === "cron"}
            fallback={
              <TextField
                label={language.t("cron.field.schedule.interval")}
                placeholder="60"
                type="number"
                value={store.intervalMinutes}
                onChange={(v: string) => setStore("intervalMinutes", v)}
                error={store.errors.schedule}
                inputmode="numeric"
              />
            }
          >
            <TextField
              label={language.t("cron.field.schedule.cron")}
              placeholder={language.t("cron.field.schedule.cron.placeholder")}
              value={store.cronExpression}
              onChange={(v: string) => setStore("cronExpression", v)}
              error={store.errors.schedule}
              spellcheck={false}
              class="font-mono text-xs"
            />
          </Show>
          <div class="grid grid-cols-2 gap-3">
            <TextField
              label={language.t("cron.field.timeout")}
              placeholder="30"
              type="number"
              value={store.timeoutMinutes}
              onChange={(v: string) => setStore("timeoutMinutes", v)}
              error={store.errors.timeout}
              inputmode="numeric"
            />
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">{language.t("cron.field.agent")}</label>
              <Select<CronAgentOption>
                variant="ghost"
                size="large"
                triggerVariant="form"
                valueClass="truncate text-14-regular"
                options={agentOptions()}
                value={(o) => o.name}
                label={(o) => o.label}
                current={agentOptions().find((o) => o.name === store.agent) ?? agentOptions()[0]}
                placeholder={language.t("common.default")}
                onSelect={(o) => setStore("agent", o?.name ?? "")}
              />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("cron.field.model")}</label>
            <Select<ModelOption>
              variant="ghost"
              size="large"
              triggerVariant="form"
              valueClass="truncate text-14-regular"
              options={modelOptions()}
              value={(o) => `${o.providerID}/${o.modelID}`}
              label={(o) => o.label}
              groupBy={(o) => o.group}
              current={modelOptions().find((o) => `${o.providerID}/${o.modelID}` === store.model)}
              placeholder={language.t("common.default")}
              onSelect={(o) => setStore("model", o ? `${o.providerID}/${o.modelID}` : "")}
            />
          </div>
          <Show when={store.errors.form}>
            <div class="rounded-md border border-border-critical-base bg-surface-critical-base/10 px-3 py-2 text-12-regular text-text-critical-base whitespace-pre-wrap">
              {store.errors.form}
            </div>
          </Show>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={save.isPending}>
            {save.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
