import React, { startTransition, useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import type {
  Agent,
  CronTask,
  FileContent,
  FileNode,
  Message,
  Part,
  Path,
  PermissionRequest,
  Provider,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@codeplane-ai/sdk/v2/client"
import type { LocalTarget, OpenProgress, SavedInstance } from "@codeplane-ai/shared/instance"
import { localInstanceUrl } from "@codeplane-ai/shared/instance"
import { formatHeaders as serializeHeaders, parseHeaders as parseHeaderInput } from "@codeplane-ai/shared/headers"
import { createServerVersionWatcher, type ServerVersionWatcher } from "@codeplane-ai/shared/server-version-watcher"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import { createInstanceService, type InstanceService, TUIAuthRequiredError } from "./instance-service"
import { headersForInstance, normalizeInstanceUrl, wsUrlForInstance } from "./client"
import { normalizeAuthInput, openSystemBrowser } from "./auth-helper"
import {
  Breadcrumb,
  CommandPalette,
  Composer,
  Conversation,
  DiffView,
  FileList,
  Header,
  MetricRow,
  NotificationList,
  Panel,
  PathInput,
  ProgressBar,
  RouteTabs,
  SessionList,
  StatusBar,
  TodoList,
} from "./view"
import { glyph, theme } from "./theme"
import {
  toConversationParts,
  toCronRows,
  toDiffLines,
  toNotificationItems,
  toSessionItems,
  toTodoItems,
} from "./presenter"

type SetupRoute = "setup.list" | "setup.remote-form" | "setup.local-form" | "setup.settings" | "setup.signin"
type WorkspaceRoute =
  | "app.directory"
  | "app.home"
  | "app.notifications"
  | "app.settings"
  | "app.cron"
  | "app.session"
type Route = SetupRoute | WorkspaceRoute
type Focus =
  | "instances"
  | "setupForm"
  | "signin"
  | "directory"
  | "sessions"
  | "files"
  | "messages"
  | "composer"
  | "notifications"
  | "cron"
  | "settings"
  | "terminals"
  | "palette"

type DirectoryBrowser = {
  cwd: string
  home?: string
  worktree?: string
  // What the user has typed into the path input. May lag behind cwd while
  // they're typing a path, so we keep them separate.
  pathInput: string
  // browse: arrow keys move through entries, ↵ enters dir.
  // input: typing edits the path input directly, ↵ resolves it.
  mode: "browse" | "input"
  entries: Array<{ path: string; type: "file" | "directory"; name: string }>
  selected: number
  loading: boolean
  history: string[]
  recents?: string[]
}
type Opened = Awaited<ReturnType<InstanceService["open"]>>

type SigninState = {
  instance: SavedInstance
  authUrl: string
  input: string
  status?: "idle" | "submitting"
}

type FormState = {
  kind: "remote" | "local"
  id?: string
  label: string
  url: string
  headers: string
  binaryVersion: string
  ignoreCertificateErrors: boolean
  field: "label" | "url" | "headers" | "binaryVersion"
}

type CommandAction = {
  id: string
  label: string
  hint?: string
  run: () => Promise<void> | void
}

type ModelSelection = {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
}

const VARIANT_LABELS = ["low", "medium", "high", "max"] as const

type NotificationSelection =
  | { kind: "permission"; id: string }
  | { kind: "question"; id: string }
  | undefined

type TerminalTab = {
  id: string
  title: string
  socket?: WebSocket
  terminal: HeadlessTerminal
  scrollOffset: number
  connected: boolean
}

type AppProps = {
  initialInstanceID?: string
  initialRoute?: string
}

function uid() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function relative(root: string, target: string) {
  if (!target.startsWith(root)) return target
  const sliced = target.slice(root.length).replace(/^\/+/, "")
  return sliced || "."
}

const formatHeaders = (headers: Record<string, string> | undefined) => serializeHeaders(headers, "semicolon")
const parseHeaders = parseHeaderInput

function formatTime(value?: number) {
  if (!value) return ""
  return new Date(value).toLocaleString()
}

function sessionLabel(session: Session, status?: SessionStatus) {
  const prefix =
    status?.type === "busy" ? "● " : status?.type === "retry" ? `↺${status.attempt} ` : session.time.archived ? "◌ " : ""
  return `${prefix}${session.title}`
}

function notificationOptions(permissions: PermissionRequest[], questions: QuestionRequest[]) {
  return [
    ...permissions.map((item) => ({
      label: `Permission: ${item.permission}`,
      value: `permission:${item.id}`,
    })),
    ...questions.map((item) => ({
      label: `Question: ${item.questions[0]?.header ?? item.id}`,
      value: `question:${item.id}`,
    })),
  ]
}

function terminalLines(tab: TerminalTab, rows: number) {
  const buffer = tab.terminal.buffer.active
  const end = Math.max(0, buffer.length - tab.scrollOffset)
  const start = Math.max(0, end - rows)
  return Array.from({ length: Math.max(0, end - start) }, (_, index) =>
    buffer.getLine(start + index)?.translateToString(false) ?? "",
  )
}

function useSpinnerFrame(active: boolean, intervalMs = 90): string {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setFrame((current) => (current + 1) % glyph.spinnerFrames.length), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return glyph.spinnerFrames[frame] ?? glyph.spinnerFrames[0]!
}

function InputField(props: { value: string; placeholder: string; active?: boolean }) {
  // Used only for the in-place setup form fields where Composer would be
  // overkill — keeps form layout compact.
  if (!props.value) {
    return (
      <Text color={theme.fgDim}>
        {props.active ? "› " : "  "}
        {props.placeholder}
        {props.active ? <Text color={theme.accent}>{glyph.cursor}</Text> : ""}
      </Text>
    )
  }
  return (
    <Text color={props.active ? theme.fg : theme.fgMuted}>
      {props.active ? <Text color={theme.accent}>{`${glyph.prompt} `}</Text> : "  "}
      {props.value}
      {props.active ? <Text color={theme.accent}>{glyph.cursor}</Text> : ""}
    </Text>
  )
}

function nextValue(options: Array<{ value: string }>, current: string | undefined, delta: number) {
  if (options.length === 0) return current
  const currentIndex = options.findIndex((item) => item.value === current)
  const index = currentIndex === -1 ? 0 : currentIndex
  return options[(index + delta + options.length) % options.length]?.value ?? current
}

function editableInput(input: string, key: { ctrl?: boolean; meta?: boolean; return?: boolean; tab?: boolean; escape?: boolean }) {
  if (!input) return false
  if (key.ctrl || key.meta || key.return || key.tab || key.escape) return false
  return input >= " "
}

export function App(props: AppProps) {
  const { exit } = useApp()
  const [service] = useState(() => createInstanceService())
  const [route, setRoute] = useState<Route>(props.initialRoute === "settings" ? "setup.settings" : "setup.list")
  const [focus, setFocus] = useState<Focus>("instances")
  const [instances, setInstances] = useState<SavedInstance[]>([])
  const [localTargetInfo, setLocalTargetInfo] = useState<LocalTarget>()
  const [selectedInstanceID, setSelectedInstanceID] = useState<string>()
  const [form, setForm] = useState<FormState>()
  const [signin, setSignin] = useState<SigninState>()
  const [opened, setOpened] = useState<Opened>()
  const [opening, setOpening] = useState<OpenProgress>()
  const [statusMessage, setStatusMessage] = useState<{ variant: "info" | "success" | "error" | "warning"; text: string }>()
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionStatus, setSessionStatus] = useState<Record<string, SessionStatus>>({})
  const [selectedSessionID, setSelectedSessionID] = useState<string>()
  const [sessionMessages, setSessionMessages] = useState<Record<string, Array<{ info: Message; parts: Part[] }>>>({})
  const [todos, setTodos] = useState<Record<string, Todo[]>>({})
  const [diffs, setDiffs] = useState<Record<string, SnapshotFileDiff[]>>({})
  const [files, setFiles] = useState<FileNode[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string>("")
  const [fileContent, setFileContent] = useState<FileContent>()
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [questions, setQuestions] = useState<QuestionRequest[]>([])
  const [selectedNotification, setSelectedNotification] = useState<NotificationSelection>()
  const [cronTasks, setCronTasks] = useState<CronTask[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteFilter, setPaletteFilter] = useState("")
  const [paletteSelection, setPaletteSelection] = useState<string>()
  const [agents, setAgents] = useState<Agent[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [activeAgent, setActiveAgent] = useState<string>()
  const [activeModel, setActiveModel] = useState<ModelSelection>()
  const [activeVariant, setActiveVariant] = useState<string>()
  const [directory, setDirectory] = useState<DirectoryBrowser>()
  const [composerValue, setComposerValue] = useState("")
  // Sidebar collapsed by default for a Claude Code / Codex-style focused
  // conversation view. Press `s` to surface sessions/tasks/diff, or use the
  // command palette.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [messageScroll, setMessageScroll] = useState(0)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [activeTerminalID, setActiveTerminalID] = useState<string>()
  const [versionInfo, setVersionInfo] = useState<{ current?: string; latest?: string | null; hasUpdate?: boolean; method?: string }>({})
  const refreshTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const eventAbort = useRef<AbortController | undefined>(undefined)
  const terminalClose = useRef<Map<string, VoidFunction>>(new Map())
  const versionWatcher = useRef<ServerVersionWatcher | undefined>(undefined)
  // Guards re-entry: a single server upgrade can fire both the SDK
  // `installation.updated` event AND a poll hit before we've torn the
  // session down. Without this, both paths race to call openInstance().
  const reconnecting = useRef(false)

  const selectedInstance = instances.find((item) => item.id === selectedInstanceID)
  const selectedSession = sessions.find((item) => item.id === selectedSessionID)
  const selectedMessages = selectedSessionID ? sessionMessages[selectedSessionID] ?? [] : []
  const selectedDiffs = selectedSessionID ? diffs[selectedSessionID] ?? [] : []
  const selectedTodos = selectedSessionID ? todos[selectedSessionID] ?? [] : []
  const selectedTerminal = terminals.find((item) => item.id === activeTerminalID)
  const notificationItems = notificationOptions(permissions, questions)
  const selectedPermission =
    selectedNotification?.kind === "permission"
      ? permissions.find((item) => item.id === selectedNotification.id)
      : undefined
  const selectedQuestion =
    selectedNotification?.kind === "question"
      ? questions.find((item) => item.id === selectedNotification.id)
      : undefined

  const createRemoteForm = (editing?: SavedInstance): FormState => ({
    kind: "remote",
    id: editing?.id,
    label: editing?.label ?? "",
    url: editing?.url ?? "",
    headers: formatHeaders(editing?.headers),
    binaryVersion: "",
    ignoreCertificateErrors: !!editing?.ignoreCertificateErrors,
    field: "label",
  })

  const createLocalForm = (editing?: SavedInstance): FormState => ({
    kind: "local",
    id: editing?.id,
    label: editing?.label ?? "",
    url: editing?.url ?? "http://127.0.0.1",
    headers: "",
    binaryVersion: editing?.local?.binaryVersion ?? localTargetInfo?.defaultVersion ?? CodeplaneVersion,
    ignoreCertificateErrors: false,
    field: "label",
  })

  const setMessage = (variant: "info" | "success" | "error" | "warning", text: string) =>
    setStatusMessage({
      variant,
      text,
    })

  async function loadInstances() {
    const list = await service.list()
    startTransition(() => {
      setInstances(list)
      setSelectedInstanceID((current) => current ?? props.initialInstanceID ?? list[0]?.id)
    })
  }

  async function refreshSessions() {
    if (!opened) return
    const [listResponse, statusResponse] = await Promise.all([opened.client.session.list(), opened.client.session.status()])
    startTransition(() => {
      setSessions(listResponse.data ?? [])
      setSessionStatus(statusResponse.data ?? {})
      setSelectedSessionID((current) => current ?? listResponse.data?.[0]?.id)
    })
  }

  async function refreshFiles(nextPath = ".") {
    if (!opened) return
    const response = await opened.client.file.list({ path: nextPath })
    startTransition(() => {
      setFiles(response.data ?? [])
      if (!selectedFilePath) {
        const firstFile = (response.data ?? []).find((item) => item.type === "file")
        setSelectedFilePath(firstFile?.path ?? nextPath)
      }
    })
  }

  async function loadDirectory(
    target: string,
    options: { keep?: boolean; mode?: "browse" | "input"; instance?: Opened } = {},
  ) {
    // `instance` lets callers pass a freshly-opened instance directly: when
    // openInstance() runs setOpened(next) and immediately calls this, the
    // closure's `opened` is still the previous (often undefined) value.
    const active = options.instance ?? opened
    if (!active) return
    const cwd = target === "" ? active.path.directory : target
    setDirectory((current) => ({
      cwd,
      home: active.path.home,
      worktree: active.path.worktree,
      pathInput: current?.pathInput ?? cwd,
      mode: options.mode ?? current?.mode ?? "browse",
      entries: current?.entries ?? [],
      selected: 0,
      loading: true,
      history: options.keep && current ? current.history : current?.history ?? [],
      recents: current?.recents,
    }))
    try {
      const pathResp = await active.client.path.get({ directory: cwd })
      const resolved = pathResp.data?.directory ?? cwd
      const fileResp = await active.client.file.list({ path: ".", directory: resolved })
      const entries = (fileResp.data ?? [])
        .map((node) => ({
          path: node.absolute ?? node.path,
          type: node.type as "file" | "directory",
          name: node.path.replace(/^\.\//, "") || node.path,
        }))
        .sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name)
          return a.type === "directory" ? -1 : 1
        })
      startTransition(() => {
        setDirectory((current) => ({
          cwd: resolved,
          home: pathResp.data?.home ?? current?.home ?? active.path.home,
          worktree: pathResp.data?.worktree ?? current?.worktree ?? active.path.worktree,
          pathInput: resolved,
          mode: options.mode ?? current?.mode ?? "browse",
          entries,
          selected: 0,
          loading: false,
          history: current?.history ?? [],
          recents: current?.recents,
        }))
      })
    } catch (error) {
      setDirectory((current) =>
        current ? { ...current, loading: false } : current,
      )
      throw error
    }
  }

  async function enterDirectory(targetPath: string) {
    if (!directory) return
    setDirectory({
      ...directory,
      history: [...directory.history, directory.cwd],
    })
    await loadDirectory(targetPath, { keep: true, mode: "browse" })
  }

  async function goUpDirectory() {
    if (!directory) return
    const parent = directory.cwd.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/"
    if (parent === directory.cwd) return
    await loadDirectory(parent, { keep: true, mode: "browse" })
  }

  async function resolvePathInput() {
    if (!directory || !opened) return
    const raw = directory.pathInput.trim()
    if (!raw) return
    // Expand ~ before sending to the server.
    const expanded = raw.startsWith("~")
      ? `${directory.home ?? opened.path.home}${raw.slice(1)}`
      : raw
    await loadDirectory(expanded, { keep: true, mode: "browse" })
  }

  async function confirmDirectory() {
    if (!directory || !opened) return
    if (directory.cwd === opened.path.directory) {
      setRoute("app.session")
      setFocus(selectedSession ? "composer" : "sessions")
      return
    }
    setMessage("info", `Switching to ${directory.cwd}…`)
    try {
      const next = await service.reopen(opened.instance, directory.cwd)
      startTransition(() => {
        setOpened(next)
        setSessionMessages({})
        setTodos({})
        setDiffs({})
        setRoute("app.session")
        setFocus("sessions")
      })
      await refreshWorkspace()
      setMessage("success", `Working in ${directory.cwd}`)
    } catch (error) {
      setMessage(
        "error",
        error instanceof Error ? error.message : `Could not open ${directory.cwd}`,
      )
    }
  }

  async function refreshNotifications() {
    if (!opened) return
    const [permissionResponse, questionResponse] = await Promise.all([opened.client.permission.list(), opened.client.question.list()])
    startTransition(() => {
      setPermissions(permissionResponse.data ?? [])
      setQuestions(questionResponse.data ?? [])
      const current = notificationItems[0]?.value
      if (!selectedNotification && current) {
        const [kind, id] = current.split(":")
        setSelectedNotification(id ? ({ kind: kind as "permission" | "question", id } as NotificationSelection) : undefined)
      }
    })
  }

  async function refreshCron() {
    if (!opened) return
    const response = await opened.client.cron.list()
    startTransition(() => {
      setCronTasks(response.data ?? [])
    })
  }

  async function refreshVersion() {
    if (!opened) return
    const response = await opened.client.global.version()
    startTransition(() => {
      setVersionInfo(response.data ?? {})
    })
  }

  async function refreshAgents() {
    if (!opened) return
    const response = await opened.client.app.agents()
    const list = (response.data ?? []).filter(
      (item) => !item.hidden && item.mode !== "subagent",
    )
    startTransition(() => {
      setAgents(list)
      setActiveAgent((current) => {
        if (current && list.some((item) => item.name === current)) return current
        return list.find((item) => item.mode === "primary")?.name ?? list[0]?.name
      })
    })
  }

  async function refreshProviders() {
    if (!opened) return
    const response = await opened.client.config.providers()
    const data = response.data
    if (!data) return
    startTransition(() => {
      setProviders(data.providers ?? [])
      setDefaultModels(data.default ?? {})
      setActiveModel((current) => {
        if (current) {
          const provider = data.providers.find((item) => item.id === current.providerID)
          if (provider && provider.models[current.modelID]) return current
        }
        const firstID = Object.keys(data.default ?? {})[0]
        if (!firstID) {
          const provider = data.providers[0]
          const modelID = provider ? Object.keys(provider.models)[0] : undefined
          if (!provider || !modelID) return current
          const model = provider.models[modelID]
          if (!model) return current
          return {
            providerID: provider.id,
            providerName: provider.name,
            modelID,
            modelName: model.name,
          }
        }
        const provider = data.providers.find((item) => item.id === firstID)
        const modelID = provider ? data.default[firstID] : undefined
        const model = provider && modelID ? provider.models[modelID] : undefined
        if (!provider || !modelID || !model) return current
        return {
          providerID: provider.id,
          providerName: provider.name,
          modelID,
          modelName: model.name,
        }
      })
    })
  }

  // Server reported a different `current` version than the one we connected
  // with — almost always means the operator (or auto-update) restarted the
  // backend on a new build. Tear the session down and re-run open(), which
  // re-probes /global/version, downloads the matching local binary if the
  // instance is local, and re-establishes SDK + event subscriptions.
  function handleServerUpgrade(saved: SavedInstance, next: { version: string; previous: string }) {
    if (reconnecting.current) return
    reconnecting.current = true
    eventAbort.current?.abort()
    eventAbort.current = undefined
    versionWatcher.current?.stop()
    versionWatcher.current = undefined
    for (const close of terminalClose.current.values()) close()
    terminalClose.current.clear()
    startTransition(() => {
      setOpened(undefined)
      setTerminals([])
      setTerminalOpen(false)
      setOpening({
        instanceID: saved.id,
        phase: "download",
        message: `Server upgraded ${next.previous} → ${next.version}. Downloading matching client…`,
        percent: 4,
        version: next.version,
      })
    })
    setMessage("warning", `Server upgraded to ${next.version}; reconnecting…`)
    void openInstance(saved)
      .catch((error) => {
        setOpening(undefined)
        setMessage("error", error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        reconnecting.current = false
      })
  }

  async function refreshFileContent(nextPath: string) {
    if (!opened || !nextPath) return
    const response = await opened.client.file.read({ path: nextPath })
    startTransition(() => {
      setSelectedFilePath(nextPath)
      setFileContent(response.data)
    })
  }

  async function refreshSession(sessionID: string) {
    if (!opened) return
    const [messageResponse, todoResponse, diffResponse] = await Promise.all([
      opened.client.session.messages({ sessionID, limit: 80 }),
      opened.client.session.todo({ sessionID }).catch(() => ({ data: [] as Todo[] })),
      opened.client.session.diff({ sessionID }).catch(() => ({ data: [] as SnapshotFileDiff[] })),
    ])
    startTransition(() => {
      setSessionMessages((current) => ({ ...current, [sessionID]: messageResponse.data ?? [] }))
      setTodos((current) => ({ ...current, [sessionID]: todoResponse.data ?? [] }))
      setDiffs((current) => ({ ...current, [sessionID]: diffResponse.data ?? [] }))
    })
  }

  function queueRefresh(key: string, fn: () => Promise<void>, delay = 120) {
    clearTimeout(refreshTimer.current[key])
    refreshTimer.current[key] = setTimeout(() => {
      void fn().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
    }, delay)
  }

  async function refreshWorkspace() {
    await Promise.all([
      refreshSessions(),
      refreshFiles("."),
      refreshNotifications(),
      refreshCron(),
      refreshVersion(),
      refreshAgents(),
      refreshProviders(),
    ])
  }

  async function openInstance(instance: SavedInstance) {
    setOpening({
      instanceID: instance.id,
      phase: "probe",
      message: "Opening instance…",
      percent: 0,
    })
    setMessage("info", `Opening ${instance.label ?? instance.url}`)
    let next: Opened
    try {
      next = await service.open(instance, (progress) => setOpening(progress))
    } catch (error) {
      if (error instanceof TUIAuthRequiredError) {
        startTransition(() => {
          setOpening(undefined)
          setSignin({
            instance,
            authUrl: error.authUrl,
            input: "",
            status: "idle",
          })
          setRoute("setup.signin")
          setFocus("signin")
        })
        setMessage("warning", `${instance.label ?? instance.url} requires sign-in`)
        return
      }
      throw error
    }
    startTransition(() => {
      setOpened(next)
      setRoute("app.directory")
      setFocus("directory")
      setOpening(undefined)
      setSessionMessages({})
      setTodos({})
      setDiffs({})
      setTerminals([])
      setTerminalOpen(false)
    })
    setMessage("success", `Connected to ${next.live.url}`)
    // Seed the directory picker at the project root so the user has a clear
    // starting point. The picker is the first thing they see — they can drill
    // into a sub-tree before the workspace boots, or just press `o` to use the
    // server-reported default cwd.
    try {
      await loadDirectory(next.path.directory, { instance: next })
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : String(error))
    }
    if (props.initialRoute === "session") {
      // Power users that pass --route=session via CLI still want to skip the
      // picker and land directly in the conversation view.
      await refreshWorkspace()
      setRoute("app.session")
      setFocus("messages")
    }
  }

  async function submitSignin() {
    if (!signin || signin.status === "submitting") return
    const headerLine = normalizeAuthInput(signin.input)
    if (!headerLine) {
      setMessage("error", "Paste the auth header value before saving")
      return
    }
    // Pull a single `Name: Value` pair out of the normalized line — we don't
    // round-trip through `parseHeaders` here because that splits on `;`,
    // which is a valid separator inside cookie values.
    const colonIdx = headerLine.indexOf(":")
    const name = colonIdx > 0 ? headerLine.slice(0, colonIdx).trim() : ""
    const value = colonIdx > 0 ? headerLine.slice(colonIdx + 1).trim() : ""
    if (!name || !value) {
      setMessage("error", "Could not parse the auth header — expected `Name: Value`")
      return
    }
    const updated: SavedInstance = {
      ...signin.instance,
      headers: { ...(signin.instance.headers ?? {}), [name]: value },
    }
    setSignin({ ...signin, status: "submitting" })
    try {
      await service.save(updated)
      await loadInstances()
      setSignin(undefined)
      setRoute("setup.list")
      setFocus("instances")
      setMessage("info", `Retrying ${updated.label ?? updated.url}…`)
      await openInstance(updated)
    } catch (error) {
      setSignin((current) => (current ? { ...current, status: "idle" } : current))
      setMessage("error", error instanceof Error ? error.message : String(error))
    }
  }

  async function openSigninUrl() {
    if (!signin) return
    const ok = await openSystemBrowser(signin.authUrl)
    setMessage(ok ? "success" : "warning", ok ? "Opened sign-in URL in your browser" : `Open ${signin.authUrl} in your browser to sign in`)
  }

  async function saveForm() {
    if (!form) return
    const id = form.id ?? uid()
    const instance: SavedInstance = {
      id,
      label: form.label || undefined,
      url: form.kind === "local" ? localInstanceUrl(id) : form.url,
      headers: form.kind === "remote" ? parseHeaders(form.headers) : undefined,
      ignoreCertificateErrors: form.kind === "remote" ? form.ignoreCertificateErrors || undefined : undefined,
      local:
        form.kind === "local"
          ? {
              binaryVersion: form.binaryVersion || CodeplaneVersion,
            }
          : undefined,
    }
    await service.save(instance)
    await loadInstances()
    setSelectedInstanceID(instance.id)
    setForm(undefined)
    setRoute("setup.list")
    setFocus("instances")
    setMessage("success", `${form.kind === "local" ? "Local" : "Remote"} instance saved`)
  }

  async function removeSelectedInstance() {
    if (!selectedInstance) return
    await service.remove(selectedInstance.id)
    await loadInstances()
    setMessage("warning", `Removed ${selectedInstance.label ?? selectedInstance.url}`)
  }

  async function createSession() {
    if (!opened) return
    const response = await opened.client.session.create({
      title: `New session ${new Date().toLocaleTimeString()}`,
    })
    const session = response.data
    if (!session) return
    startTransition(() => {
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)])
      setSelectedSessionID(session.id)
      setRoute("app.session")
      setFocus("composer")
    })
    return session
  }

  async function submitPrompt(value: string) {
    if (!opened || !value.trim()) return
    const session = selectedSession ?? (await createSession())
    if (!session) return
    await opened.client.session.promptAsync({
      sessionID: session.id,
      parts: [{ type: "text", text: value }],
      ...(activeAgent ? { agent: activeAgent } : {}),
      ...(activeModel
        ? { model: { providerID: activeModel.providerID, modelID: activeModel.modelID } }
        : {}),
      ...(activeVariant ? { variant: activeVariant } : {}),
    })
    setComposerValue("")
    setMessage("info", "Prompt sent")
    queueRefresh(`session:${session.id}`, () => refreshSession(session.id), 50)
    queueRefresh("sessions", refreshSessions, 50)
  }

  async function runPalette(commandID: string) {
    const commands = buildCommands()
    const selected = commands.find((item) => item.id === commandID)
    if (!selected) return
    setPaletteOpen(false)
    setPaletteFilter("")
    setPaletteSelection(undefined)
    // Send the user back to the composer so they can keep typing — palette is
    // a quick interjection, not a destination.
    setFocus(opened ? "composer" : "sessions")
    await selected.run()
  }

  function buildCommands(): CommandAction[] {
    const agentCommands: CommandAction[] = agents.map((agent) => ({
      id: `agent:${agent.name}`,
      label: `/agent ${agent.name}`,
      hint:
        (activeAgent === agent.name ? "active" : agent.description) ??
        (agent.mode === "primary" ? "primary" : agent.mode),
      run: () => {
        setActiveAgent(agent.name)
        setMessage("success", `Agent → ${agent.name}`)
      },
    }))
    const modelCommands: CommandAction[] = providers.flatMap((provider) =>
      Object.entries(provider.models)
        .filter(([, model]) => model.status !== "deprecated")
        .map(([modelID, model]) => {
          const active =
            activeModel?.providerID === provider.id && activeModel?.modelID === modelID
          return {
            id: `model:${provider.id}:${modelID}`,
            label: `/model ${provider.name} · ${model.name}`,
            hint: active ? "active" : model.family ?? model.status,
            run: () => {
              setActiveModel({
                providerID: provider.id,
                providerName: provider.name,
                modelID,
                modelName: model.name,
              })
              setMessage("success", `Model → ${provider.name} · ${model.name}`)
            },
          }
        }),
    )
    const variantCommands: CommandAction[] = VARIANT_LABELS.map((variant) => ({
      id: `variant:${variant}`,
      label: `/effort ${variant}`,
      hint: activeVariant === variant ? "active" : "reasoning effort",
      run: () => {
        setActiveVariant(variant)
        setMessage("success", `Effort → ${variant}`)
      },
    }))
    const variantClear: CommandAction[] = activeVariant
      ? [
          {
            id: "variant:clear",
            label: "/effort default",
            hint: "use model default",
            run: () => {
              setActiveVariant(undefined)
              setMessage("info", "Effort cleared")
            },
          },
        ]
      : []

    return [
      { id: "new-session", label: "/new", hint: "create session", run: () => { void createSession() } },
      { id: "session", label: "/session", hint: "open session view", run: () => setRoute("app.session") },
      { id: "home", label: "/home", hint: "open home", run: () => setRoute("app.home") },
      { id: "notifications", label: "/inbox", hint: "permissions & questions", run: () => setRoute("app.notifications") },
      { id: "cron", label: "/cron", hint: "scheduled tasks", run: () => setRoute("app.cron") },
      { id: "settings", label: "/settings", hint: "workspace & version", run: () => setRoute("app.settings") },
      { id: "directory", label: "/cd", hint: "change working directory", run: () => {
        setRoute("app.directory")
        setFocus("directory")
        if (opened && !directory) {
          void loadDirectory(opened.path.directory).catch((error) =>
            setMessage("error", error instanceof Error ? error.message : String(error)),
          )
        }
      } },
      ...agentCommands,
      ...modelCommands,
      ...variantCommands,
      ...variantClear,
      ...(selectedSession && selectedSession.share?.url
        ? [{ id: "unshare", label: "/unshare", hint: "remove public link", run: () => opened?.client.session.unshare({ sessionID: selectedSession.id }).then(() => refreshSessions()) }]
        : selectedSession
          ? [{ id: "share", label: "/share", hint: "publish link", run: () => opened?.client.session.share({ sessionID: selectedSession.id }).then(() => refreshSessions()) }]
          : []),
      ...(selectedSession && !selectedSession.time.archived
        ? [
            {
              id: "archive",
              label: "/archive",
              hint: "soft delete session",
              run: () =>
                opened?.client.session.update({ sessionID: selectedSession.id, time: { archived: Date.now() } }).then(() => refreshSessions()),
            },
          ]
        : selectedSession
          ? [
              {
                id: "unarchive",
                label: "/unarchive",
                hint: "restore session",
                run: () =>
                  opened?.client.session.update({ sessionID: selectedSession.id, time: { archived: null } }).then(() => refreshSessions()),
              },
            ]
          : []),
      ...(selectedSession && !selectedSession.revert && selectedMessages.length > 0
        ? [
            {
              id: "revert-last",
              label: "/revert",
              hint: "rewind to last assistant output",
              run: () => {
                const message = [...selectedMessages].reverse().find((item) => item.info.role === "assistant")
                if (!message) return
                return opened?.client.session.revert({ sessionID: selectedSession.id, messageID: message.info.id }).then(() => refreshSessions())
              },
            },
          ]
        : selectedSession && selectedSession.revert
          ? [{ id: "unrevert", label: "/unrevert", hint: "discard revert", run: () => opened?.client.session.unrevert({ sessionID: selectedSession.id }).then(() => refreshSessions()) }]
          : []),
      ...(selectedSession
        ? [
            {
              id: "compact",
              label: "/compact",
              hint: "summarize session to free context",
              run: () =>
                opened?.client.session
                  .summarize({
                    sessionID: selectedSession.id,
                    ...(activeModel
                      ? {
                          providerID: activeModel.providerID,
                          modelID: activeModel.modelID,
                        }
                      : {}),
                  })
                  .then(() => refreshSession(selectedSession.id))
                  .then(() => setMessage("success", "Session summarized")),
            },
          ]
        : []),
      { id: "sidebar", label: sidebarOpen ? "/sidebar off" : "/sidebar on", hint: "sessions · tasks · diff", run: () => setSidebarOpen((value) => !value) },
      { id: "terminal-toggle", label: terminalOpen ? "/terminal off" : "/terminal", hint: "PTY dock", run: () => setTerminalOpen((value) => !value) },
      { id: "terminal-new", label: "/terminal-new", hint: "new PTY tab", run: createTerminalTab },
      {
        id: "upgrade",
        label: versionInfo.hasUpdate ? `/upgrade ${versionInfo.latest}` : "/upgrade",
        hint: versionInfo.hasUpdate ? "server update available" : "refresh version info",
        run: () =>
          versionInfo.hasUpdate
            ? opened?.client.global.upgrade({ target: versionInfo.latest ?? undefined }).then(async (response) => {
                const result = response.data
                if (!result) return
                setMessage(result.success ? "success" : "error", result.success ? `Upgraded to ${result.version}` : result.error)
                await refreshVersion()
              })
            : refreshVersion(),
      },
      { id: "quit", label: "/quit", hint: "exit codeplane", run: () => exit() },
    ]
  }

  async function selectFile(value: string) {
    if (!opened) return
    const file = files.find((item) => item.path === value)
    if (!file) return
    if (file.type === "directory") {
      await refreshFiles(file.path)
      return
    }
    await refreshFileContent(file.path)
  }

  const instanceOptions = instances.map((item) => ({
    label: `${item.local ? "local" : "remote"} · ${item.label ?? item.url}`,
    value: item.id,
  }))
  const sessionOptions = sessions.map((item) => ({
    label: sessionLabel(item, sessionStatus[item.id]),
    value: item.id,
  }))
  const fileOptions = files.map((item) => ({
    label: `${item.type === "directory" ? "dir" : "file"} · ${opened ? relative(opened.path.directory, item.absolute) : item.path}`,
    value: item.path,
  }))
  const commandOptions = (() => {
    const filter = paletteFilter.replace(/^\//, "").toLowerCase()
    return buildCommands()
      .filter((item) =>
        filter === ""
          ? true
          : item.label.toLowerCase().includes(filter) || (item.hint?.toLowerCase().includes(filter) ?? false),
      )
      .map((item) => ({ label: item.label, value: item.id, hint: item.hint }))
  })()

  async function createTerminalTab() {
    if (!opened) return
    const response = await opened.client.pty.create({
      title: `Terminal ${terminals.length + 1}`,
    })
    const info = response.data
    if (!info) return
    const terminal = new HeadlessTerminal({
      cols: 100,
      rows: 18,
      scrollback: 2000,
    })
    const url = new URL(wsUrlForInstance(opened.live, `/pty/${info.id}/connect`))
    url.searchParams.set("directory", opened.path.directory)
    const Socket = WebSocket as unknown as {
      new (url: string, options?: { headers?: Record<string, string> }): WebSocket
    }
    const socket = new Socket(url.toString(), {
      headers: opened.live.headers,
    })
    socket.binaryType = "arraybuffer"
    socket.onmessage = (event) => {
      const data = event.data
      if (typeof data === "string") {
        void terminal.write(data)
        return
      }
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
            : undefined
      if (!bytes || bytes[0] !== 0) return
    }
    socket.onclose = () => {
      setTerminals((current) => current.map((item) => (item.id === info.id ? { ...item, connected: false } : item)))
      terminalClose.current.delete(info.id)
    }
    socket.onerror = () => {
      setMessage("error", `Terminal ${info.title} disconnected`)
    }
    const tab: TerminalTab = {
      id: info.id,
      title: info.title,
      terminal,
      socket,
      connected: true,
      scrollOffset: 0,
    }
    terminalClose.current.set(info.id, () => socket.close())
    startTransition(() => {
      setTerminals((current) => [...current, tab])
      setActiveTerminalID(info.id)
      setTerminalOpen(true)
    })
  }

  async function closeActiveTerminal() {
    if (!activeTerminalID || !opened) return
    terminalClose.current.get(activeTerminalID)?.()
    await opened.client.pty.remove({ ptyID: activeTerminalID }).catch(() => undefined)
    startTransition(() => {
      setTerminals((current) => current.filter((item) => item.id !== activeTerminalID))
      setActiveTerminalID((current) => (current === activeTerminalID ? terminals.find((item) => item.id !== current)?.id : current))
    })
  }

  async function replySelectedPermission(reply: "once" | "always" | "reject") {
    if (!opened || !selectedPermission) return
    await opened.client.permission.reply({
      requestID: selectedPermission.id,
      reply,
    })
    setMessage(reply === "reject" ? "warning" : "success", `Permission ${reply}`)
    await refreshNotifications()
  }

  async function replySelectedQuestion(reject = false) {
    if (!opened || !selectedQuestion) return
    if (reject) {
      await opened.client.question.reject({ requestID: selectedQuestion.id })
      setMessage("warning", "Question rejected")
      await refreshNotifications()
      return
    }
    await opened.client.question.reply({
      requestID: selectedQuestion.id,
      answers: selectedQuestion.questions.map((question) => (question.options[0]?.label ? [question.options[0].label] : [])),
    })
    setMessage("success", "Question answered with first available options")
    await refreshNotifications()
  }

  useEffect(() => {
    void Promise.all([loadInstances(), service.localTarget().then((value) => setLocalTargetInfo(value))]).catch((error) =>
      setMessage("error", error instanceof Error ? error.message : String(error)),
    )
  }, [])

  useEffect(() => {
    if (!props.initialInstanceID) return
    if (!selectedInstance || selectedInstance.id !== props.initialInstanceID) return
    if (opened) return
    void openInstance(selectedInstance).catch((error) => {
      setOpening(undefined)
      setMessage("error", error instanceof Error ? error.message : String(error))
    })
  }, [opened, props.initialInstanceID, selectedInstance])

  useEffect(() => {
    if (!opened) return
    void refreshSession(selectedSession?.id ?? "").catch(() => undefined)
  }, [opened, selectedSession?.id])

  useEffect(() => {
    if (!opened) return
    const abort = new AbortController()
    eventAbort.current?.abort()
    eventAbort.current = abort
    void opened.client.event
      .subscribe(undefined, {
        signal: abort.signal,
      })
      .then(async (events) => {
        for await (const event of events.stream) {
          if (abort.signal.aborted) return
          switch (event.type) {
            case "session.status":
              setSessionStatus((current) => ({ ...current, [event.properties.sessionID]: event.properties.status }))
              if (event.properties.status.type === "idle") {
                queueRefresh(`session:${event.properties.sessionID}`, () => refreshSession(event.properties.sessionID), 60)
              }
              break
            case "message.updated":
            case "message.part.updated":
            case "message.part.removed":
            case "message.removed":
            case "session.error":
            case "session.diff":
            case "todo.updated":
              if ("properties" in event && "sessionID" in event.properties) {
                const sessionID = event.properties.sessionID
                if (typeof sessionID === "string") {
                  queueRefresh(`session:${sessionID}`, () => refreshSession(sessionID), 120)
                }
              }
              queueRefresh("sessions", refreshSessions, 120)
              break
            case "permission.asked":
            case "permission.replied":
            case "question.asked":
            case "question.replied":
            case "question.rejected":
              queueRefresh("notifications", refreshNotifications, 50)
              break
            case "pty.created":
            case "pty.updated":
            case "pty.deleted":
            case "pty.exited":
              if (event.type === "pty.exited") {
                setTerminals((current) => current.filter((item) => item.id !== event.properties.id))
              }
              break
            case "installation.updated":
              // Force a poll so we react inside the same tick as the
              // server-pushed event, instead of waiting up to `intervalMs`
              // for the next scheduled poll. The watcher's onChange handler
              // takes care of dedupe.
              versionWatcher.current?.ping()
              queueRefresh("version", refreshVersion, 50)
              break
            case "installation.update-available":
              queueRefresh("version", refreshVersion, 50)
              break
          }
        }
      })
      .catch(() => undefined)
    return () => abort.abort()
  }, [opened?.live.url, opened?.path.directory, selectedSessionID])

  useEffect(() => {
    if (!opened) {
      versionWatcher.current?.stop()
      versionWatcher.current = undefined
      return
    }
    const baseUrl = normalizeInstanceUrl(opened.live.url)
    if (!baseUrl) return
    versionWatcher.current?.stop()
    const watcher = createServerVersionWatcher({
      baseUrl,
      headers: headersForInstance(opened.live),
      currentVersion: opened.version,
      onChange: (next) => handleServerUpgrade(opened.instance, next),
      onError: () => undefined,
    })
    versionWatcher.current = watcher
    return () => {
      watcher.stop()
      if (versionWatcher.current === watcher) versionWatcher.current = undefined
    }
  }, [opened?.live.url, opened?.version, opened?.instance.id])

  useEffect(
    () => () => {
      eventAbort.current?.abort()
      versionWatcher.current?.stop()
      for (const close of terminalClose.current.values()) close()
    },
    [],
  )

  useEffect(() => {
    if (!paletteOpen) return
    if (commandOptions.some((item) => item.value === paletteSelection)) return
    setPaletteSelection(commandOptions[0]?.value)
  }, [commandOptions, paletteOpen, paletteSelection])

  useInput(
    (input, key) => {
      if (paletteOpen) {
        if (key.escape) {
          setPaletteOpen(false)
          setPaletteFilter("")
          setFocus(opened ? "composer" : "sessions")
          setPaletteSelection(undefined)
          return
        }
        if (key.upArrow) {
          setPaletteSelection(nextValue(commandOptions, paletteSelection, -1))
          return
        }
        if (key.downArrow) {
          setPaletteSelection(nextValue(commandOptions, paletteSelection, 1))
          return
        }
        if (key.return) {
          const selected = paletteSelection ?? commandOptions[0]?.value
          if (!selected) return
          void runPalette(selected).catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (key.backspace) {
          setPaletteFilter((current) => current.slice(0, -1))
          return
        }
        if (editableInput(input, key)) {
          setPaletteFilter((current) => current + input)
        }
        return
      }

      if (signin) {
        if (signin.status === "submitting") return
        if (key.escape) {
          setSignin(undefined)
          setRoute("setup.list")
          setFocus("instances")
          return
        }
        if (key.ctrl && (input === "o" || input === "O")) {
          void openSigninUrl().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (key.return) {
          void submitSignin().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (key.backspace) {
          setSignin({ ...signin, input: signin.input.slice(0, -1) })
          return
        }
        if (editableInput(input, key)) {
          setSignin({ ...signin, input: signin.input + input })
        }
        return
      }

      if (form) {
        const fields = form.kind === "remote" ? ["label", "url", "headers"] : ["label", "binaryVersion"]
        if (key.escape) {
          setForm(undefined)
          setRoute("setup.list")
          setFocus("instances")
          return
        }
        if (key.tab) {
          const index = fields.indexOf(form.field)
          setForm({
            ...form,
            field: fields[(index + 1) % fields.length] as FormState["field"],
          })
          return
        }
        if (key.return) {
          const index = fields.indexOf(form.field)
          const next = fields[index + 1]
          if (next) {
            setForm({
              ...form,
              field: next as FormState["field"],
            })
            return
          }
          void saveForm().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (key.backspace) {
          if (form.field === "label") {
            setForm({ ...form, label: form.label.slice(0, -1) })
            return
          }
          if (form.field === "url") {
            setForm({ ...form, url: form.url.slice(0, -1) })
            return
          }
          if (form.field === "headers") {
            setForm({ ...form, headers: form.headers.slice(0, -1) })
            return
          }
          setForm({ ...form, binaryVersion: form.binaryVersion.slice(0, -1) })
          return
        }
        if (editableInput(input, key)) {
          if (form.field === "label") {
            setForm({ ...form, label: form.label + input })
            return
          }
          if (form.field === "url") {
            setForm({ ...form, url: form.url + input })
            return
          }
          if (form.field === "headers") {
            setForm({ ...form, headers: form.headers + input })
            return
          }
          setForm({ ...form, binaryVersion: form.binaryVersion + input })
        }
        return
      }

      if (opening) return

      if (key.ctrl && input === "c") {
        exit()
        return
      }

      if (route.startsWith("setup")) {
        if (input === "q") {
          exit()
          return
        }
        if (input === "a") {
          setForm(createRemoteForm())
          setRoute("setup.remote-form")
          setFocus("setupForm")
          return
        }
        if (input === "l") {
          setForm(createLocalForm())
          setRoute("setup.local-form")
          setFocus("setupForm")
          return
        }
        if (input === "s") {
          setRoute("setup.settings")
          setFocus("settings")
          return
        }
        if (focus === "instances" && key.upArrow) {
          setSelectedInstanceID(nextValue(instanceOptions, selectedInstanceID, -1))
          return
        }
        if (focus === "instances" && key.downArrow) {
          setSelectedInstanceID(nextValue(instanceOptions, selectedInstanceID, 1))
          return
        }
        if (input === "e" && selectedInstance) {
          const next = selectedInstance.local ? createLocalForm(selectedInstance) : createRemoteForm(selectedInstance)
          setForm(next)
          setRoute(selectedInstance.local ? "setup.local-form" : "setup.remote-form")
          setFocus("setupForm")
          return
        }
        if (input === "d") {
          void removeSelectedInstance().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
        }
        if (key.return && selectedInstance) {
          void openInstance(selectedInstance).catch((error) => {
            setOpening(undefined)
            setMessage("error", error instanceof Error ? error.message : String(error))
          })
        }
        return
      }

      if (!opened) return

      // Directory picker takes over keyboard input — dual-mode browser.
      if (route === "app.directory" && directory) {
        if (key.escape) {
          if (directory.mode === "input") {
            // Back to browse rather than bail.
            setDirectory({ ...directory, mode: "browse", pathInput: directory.cwd })
            return
          }
          setRoute("setup.list")
          setFocus("instances")
          return
        }

        // Tab toggles between input and browse.
        if (key.tab) {
          setDirectory({
            ...directory,
            mode: directory.mode === "input" ? "browse" : "input",
            pathInput: directory.cwd,
          })
          return
        }

        if (directory.mode === "input") {
          if (key.return) {
            void resolvePathInput().catch((error) =>
              setMessage("error", error instanceof Error ? error.message : String(error)),
            )
            return
          }
          if (key.backspace) {
            setDirectory({
              ...directory,
              pathInput: directory.pathInput.slice(0, -1),
            })
            return
          }
          if (editableInput(input, key)) {
            setDirectory({
              ...directory,
              pathInput: directory.pathInput + input,
            })
            return
          }
          return
        }

        // browse mode
        if (key.upArrow) {
          setDirectory({
            ...directory,
            selected: Math.max(0, directory.selected - 1),
          })
          return
        }
        if (key.downArrow) {
          setDirectory({
            ...directory,
            selected: Math.min(directory.entries.length - 1, directory.selected + 1),
          })
          return
        }
        if (key.return || key.rightArrow) {
          const target = directory.entries[directory.selected]
          if (!target) return
          if (target.type === "directory") {
            void enterDirectory(target.path).catch((error) =>
              setMessage("error", error instanceof Error ? error.message : String(error)),
            )
          }
          return
        }
        if (key.leftArrow || (key.backspace && !directory.loading)) {
          void goUpDirectory().catch((error) =>
            setMessage("error", error instanceof Error ? error.message : String(error)),
          )
          return
        }
        if (input === " " || input === "o") {
          // space and o both confirm the current directory — space because
          // most users instinctively reach for it on a list selection.
          void confirmDirectory().catch((error) =>
            setMessage("error", error instanceof Error ? error.message : String(error)),
          )
          return
        }
        if (input === "h") {
          if (directory.home) {
            void loadDirectory(directory.home, { keep: true, mode: "browse" }).catch((error) =>
              setMessage("error", error instanceof Error ? error.message : String(error)),
            )
          }
          return
        }
        if (input === "w") {
          if (directory.worktree) {
            void loadDirectory(directory.worktree, { keep: true, mode: "browse" }).catch((error) =>
              setMessage("error", error instanceof Error ? error.message : String(error)),
            )
          }
          return
        }
        if (input === "i") {
          // Switch to input mode for typing a path directly.
          setDirectory({ ...directory, mode: "input", pathInput: directory.cwd })
          return
        }
        if (input === "/") {
          setPaletteOpen(true)
          setPaletteFilter("")
          setPaletteSelection(commandOptions[0]?.value)
          setFocus("palette")
        }
        return
      }

      if (input === "/") {
        setPaletteOpen(true)
        setPaletteFilter("")
        setPaletteSelection(commandOptions[0]?.value)
        setFocus("palette")
        return
      }

      if (input === "1") setRoute("app.home")
      if (input === "2") setRoute("app.notifications")
      if (input === "3") setRoute("app.settings")
      if (input === "4") setRoute("app.cron")
      if (input === "5") setRoute("app.session")
      if (input === "d" && opened && route !== "app.directory") {
        setRoute("app.directory")
        setFocus("directory")
        if (!directory) {
          void loadDirectory(opened.path.directory).catch((error) =>
            setMessage("error", error instanceof Error ? error.message : String(error)),
          )
        }
        return
      }
      if (input === "s" && focus !== "composer") {
        setSidebarOpen((value) => !value)
        return
      }
      if (input === "t" && focus !== "terminals") setTerminalOpen((value) => !value)
      if (input === "n") {
        if (focus === "terminals") {
          void createTerminalTab().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
        } else {
          void createSession().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
        }
        return
      }
      if (input === "x" && focus === "terminals") {
        void closeActiveTerminal().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
        return
      }
      if (input === "q") {
        exit()
        return
      }

      if (key.tab) {
        const options: Focus[] =
          route === "app.notifications"
            ? ["notifications", "settings"]
            : route === "app.cron"
              ? ["cron", "settings"]
              : route === "app.settings"
                ? ["settings"]
                : terminalOpen
                  ? ["sessions", "files", "messages", "composer", "terminals"]
                  : ["sessions", "files", "messages", "composer"]
        const index = options.indexOf(focus)
        setFocus(options[(index + 1) % options.length] ?? options[0])
        return
      }

      if (focus === "messages") {
        if (key.pageUp || key.upArrow) setMessageScroll((value) => value + 5)
        if (key.pageDown || key.downArrow) setMessageScroll((value) => Math.max(0, value - 5))
        return
      }

      if (focus === "sessions") {
        if (key.upArrow) {
          setSelectedSessionID(nextValue(sessionOptions, selectedSessionID, -1))
          setRoute("app.session")
          return
        }
        if (key.downArrow) {
          setSelectedSessionID(nextValue(sessionOptions, selectedSessionID, 1))
          setRoute("app.session")
          return
        }
        if (key.return && selectedSessionID) {
          setRoute("app.session")
          setFocus("messages")
          return
        }
      }

      if (focus === "notifications") {
        if (key.upArrow) {
          const next = nextValue(notificationItems, selectedNotification ? `${selectedNotification.kind}:${selectedNotification.id}` : undefined, -1)
          const [kind, id] = next?.split(":") ?? []
          if (!kind || !id) return
          setSelectedNotification({ kind: kind as "permission" | "question", id })
          return
        }
        if (key.downArrow) {
          const next = nextValue(notificationItems, selectedNotification ? `${selectedNotification.kind}:${selectedNotification.id}` : undefined, 1)
          const [kind, id] = next?.split(":") ?? []
          if (!kind || !id) return
          setSelectedNotification({ kind: kind as "permission" | "question", id })
          return
        }
        if (input === "y") {
          void replySelectedPermission("once").catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (input === "a") {
          void replySelectedPermission("always").catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (input === "r") {
          void replySelectedQuestion(false).catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (input === "x") {
          if (selectedNotification?.kind === "permission") {
            void replySelectedPermission("reject").catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
            return
          }
          void replySelectedQuestion(true).catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
        }
        return
      }

      if (focus === "files") {
        if (key.upArrow) {
          setSelectedFilePath(nextValue(fileOptions, selectedFilePath, -1) ?? "")
          return
        }
        if (key.downArrow) {
          setSelectedFilePath(nextValue(fileOptions, selectedFilePath, 1) ?? "")
          return
        }
        if (key.return && selectedFilePath) {
          void selectFile(selectedFilePath).catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
      }

      if (focus === "composer") {
        if (key.return) {
          void submitPrompt(composerValue).catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
          return
        }
        if (key.backspace) {
          setComposerValue((current) => current.slice(0, -1))
          return
        }
        // Codex/Claude Code pattern: typing `/` on an empty composer opens the
        // command palette. Once there's text, `/` is just a literal character.
        if (input === "/" && composerValue === "") {
          setPaletteOpen(true)
          setPaletteFilter("")
          setPaletteSelection(commandOptions[0]?.value)
          setFocus("palette")
          return
        }
        if (editableInput(input, key)) {
          setComposerValue((current) => current + input)
          return
        }
      }

      if (focus === "settings" && input === "u") {
        void runPalette("upgrade").catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
        return
      }

      if (focus === "terminals" && selectedTerminal?.socket && selectedTerminal.socket.readyState === WebSocket.OPEN) {
        if (key.leftArrow) {
          setActiveTerminalID(nextValue(terminals.map((item) => ({ value: item.id })), activeTerminalID, -1))
          return
        }
        if (key.rightArrow) {
          setActiveTerminalID(nextValue(terminals.map((item) => ({ value: item.id })), activeTerminalID, 1))
          return
        }
        if (key.pageUp) {
          setTerminals((current) =>
            current.map((item) => (item.id === selectedTerminal.id ? { ...item, scrollOffset: item.scrollOffset + 3 } : item)),
          )
          return
        }
        if (key.pageDown) {
          setTerminals((current) =>
            current.map((item) => (item.id === selectedTerminal.id ? { ...item, scrollOffset: Math.max(0, item.scrollOffset - 3) } : item)),
          )
          return
        }
        const data = key.return
          ? "\r"
          : key.backspace
            ? "\x7f"
            : key.tab
              ? "\t"
              : key.ctrl && input === "c"
                ? "\x03"
                : input
        if (data) selectedTerminal.socket.send(data)
      }
    },
    { isActive: true },
  )

  const sessionItems = toSessionItems(sessions, sessionStatus)
  const todoItems = toTodoItems(selectedTodos)
  const diffEntries = toDiffLines(selectedDiffs)
  const conversationParts = toConversationParts(selectedMessages)
  // The conversation may be very long; clamp visible parts based on terminal
  // height so we don't push the composer offscreen.
  const conversationVisible = (() => {
    const rows = process.stdout.rows ?? 40
    const budget = Math.max(8, Math.min(80, rows - 18))
    const skip = Math.max(0, conversationParts.length - budget - messageScroll)
    return conversationParts.slice(skip, skip + budget)
  })()
  const notificationViewItems = toNotificationItems(permissions, questions)
  const cronRows = toCronRows(cronTasks)
  const sessionBusy = !!selectedSessionID && sessionStatus[selectedSessionID]?.type === "busy"
  const anyBusy = Object.values(sessionStatus).some((status) => status.type === "busy" || status.type === "retry")
  const spinnerFrame = useSpinnerFrame(anyBusy || !!opening || signin?.status === "submitting")

  const headerBranch = opened ? relative(opened.path.worktree, opened.path.directory) : undefined

  const routeTabs = [
    { id: "app.home", label: "Home", key: "1" },
    {
      id: "app.session",
      label: "Session",
      key: "2",
      badge: sessions.length || undefined,
    },
    {
      id: "app.notifications",
      label: "Inbox",
      key: "3",
      badge: notificationViewItems.length || undefined,
    },
    { id: "app.cron", label: "Cron", key: "4", badge: cronTasks.length || undefined },
    { id: "app.settings", label: "Settings", key: "5" },
  ]

  const setupHints = [
    { keys: "a", label: "add remote" },
    { keys: "l", label: "add local" },
    { keys: "e", label: "edit" },
    { keys: "d", label: "delete" },
    { keys: "↵", label: "open" },
    { keys: "q", label: "quit" },
  ]

  const workspaceHints = (() => {
    if (route === "app.notifications") {
      return [
        { keys: "tab", label: "switch pane" },
        { keys: "y", label: "approve once" },
        { keys: "a", label: "always" },
        { keys: "x", label: "reject" },
        { keys: "/", label: "commands" },
      ]
    }
    if (route === "app.settings") {
      return [
        { keys: "u", label: "upgrade / refresh" },
        { keys: "/", label: "commands" },
      ]
    }
    if (terminalOpen && focus === "terminals") {
      return [
        { keys: "←→", label: "switch tab" },
        { keys: "n", label: "new" },
        { keys: "x", label: "close" },
        { keys: "t", label: "hide dock" },
      ]
    }
    if (focus === "messages") {
      return [
        { keys: "tab", label: "switch pane" },
        { keys: "↑↓ pgup/pgdn", label: "scroll" },
        { keys: "/", label: "commands" },
        { keys: "n", label: "new session" },
        { keys: "q", label: "quit" },
      ]
    }
    return [
      { keys: "↵", label: "send" },
      { keys: "/", label: "commands" },
      { keys: "s", label: sidebarOpen ? "hide sidebar" : "sidebar" },
      { keys: "d", label: "directory" },
      { keys: "n", label: "new session" },
      { keys: "t", label: "terminal" },
      { keys: "q", label: "quit" },
    ]
  })()

  const composerPlaceholder = selectedSession
    ? `Message ${selectedSession.title}`
    : "Create a session and send a prompt"
  const composerHint = focus === "composer"
    ? composerValue === ""
      ? "↵ send · / commands · esc unfocus"
      : "↵ send · esc unfocus"
    : "tab to focus composer · ↵ send when focused"

  return (
    <Box flexDirection="column">
      <Header
        instance={opened ? opened.instance.label ?? opened.live.url : "setup"}
        branch={headerBranch}
        cwd={opened ? undefined : "instance setup"}
        busy={anyBusy || !!opening || signin?.status === "submitting"}
        spinnerFrame={spinnerFrame}
        status={statusMessage}
      />

      {opening ? (
        <Box marginTop={1} paddingX={1} flexDirection="column">
          <Text color={theme.fgMuted}>{opening.message}</Text>
          <ProgressBar value={opening.percent} label={opening.phase} />
        </Box>
      ) : null}

      {!opened ? (
        <Box marginTop={1} flexDirection="column" paddingX={2}>
          {route === "setup.signin" && signin ? (
            <Box flexDirection="column">
              <Text color={theme.fgDim}>SIGN IN</Text>
              <Box marginTop={1}>
                <Text>
                  Sign in to{" "}
                  <Text color={theme.accent} bold>
                    {signin.instance.label ?? signin.instance.url}
                  </Text>
                  .
                </Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.fgMuted}>
                  1. <Text color={theme.accent}>ctrl+o</Text> opens the URL in your browser.
                </Text>
                <Text color={theme.fgMuted}>2. Sign in with your auth provider.</Text>
                <Text color={theme.fgMuted}>3. Copy the auth header (token, cookie, or Bearer).</Text>
                <Text color={theme.fgMuted}>
                  4. Paste below and press <Text color={theme.accent}>↵</Text>.
                </Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.fgDim}>auth header</Text>
                <Box>
                  <InputField
                    value={signin.input}
                    placeholder="CF_Authorization=eyJ…  ·  Bearer eyJ…  ·  Cookie: name=value"
                    active
                  />
                </Box>
              </Box>
              <Box marginTop={2}>
                <StatusBar
                  hints={
                    signin.status === "submitting"
                      ? [{ keys: spinnerFrame, label: "saving…" }]
                      : [
                          { keys: "ctrl+o", label: "open URL" },
                          { keys: "↵", label: "save & retry" },
                          { keys: "esc", label: "cancel" },
                        ]
                  }
                />
              </Box>
            </Box>
          ) : route === "setup.settings" ? (
            <Box flexDirection="column">
              <Text color={theme.fgDim}>SETTINGS</Text>
              <Box marginTop={1} flexDirection="column">
                <MetricRow label="cli" value={CodeplaneVersion} tone="accent" />
                <MetricRow
                  label="local runtime"
                  value={localTargetInfo?.defaultVersion ?? CodeplaneVersion}
                />
                <MetricRow label="node" value={process.version} tone="muted" />
              </Box>
              <Box marginTop={2}>
                <StatusBar hints={setupHints} />
              </Box>
            </Box>
          ) : form ? (
            <Box flexDirection="column">
              <Text color={theme.fgDim}>
                {form.kind === "local" ? "ADD LOCAL INSTANCE" : "ADD REMOTE INSTANCE"}
              </Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Box width={16}>
                    <Text
                      color={form.field === "label" ? theme.accent : theme.fgMuted}
                      bold={form.field === "label"}
                    >
                      label
                    </Text>
                  </Box>
                  <Box flexGrow={1}>
                    <InputField
                      value={form.label}
                      placeholder="my server"
                      active={form.field === "label"}
                    />
                  </Box>
                </Box>
                {form.kind === "remote" ? (
                  <>
                    <Box>
                      <Box width={16}>
                        <Text
                          color={form.field === "url" ? theme.accent : theme.fgMuted}
                          bold={form.field === "url"}
                        >
                          url
                        </Text>
                      </Box>
                      <Box flexGrow={1}>
                        <InputField
                          value={form.url}
                          placeholder="https://server.example.com"
                          active={form.field === "url"}
                        />
                      </Box>
                    </Box>
                    <Box>
                      <Box width={16}>
                        <Text
                          color={form.field === "headers" ? theme.accent : theme.fgMuted}
                          bold={form.field === "headers"}
                        >
                          headers
                        </Text>
                      </Box>
                      <Box flexGrow={1}>
                        <InputField
                          value={form.headers}
                          placeholder="Authorization: Bearer …; X-Token: …"
                          active={form.field === "headers"}
                        />
                      </Box>
                    </Box>
                  </>
                ) : (
                  <Box>
                    <Box width={16}>
                      <Text
                        color={form.field === "binaryVersion" ? theme.accent : theme.fgMuted}
                        bold={form.field === "binaryVersion"}
                      >
                        binary version
                      </Text>
                    </Box>
                    <Box flexGrow={1}>
                      <InputField
                        value={form.binaryVersion}
                        placeholder={localTargetInfo?.defaultVersion ?? CodeplaneVersion}
                        active={form.field === "binaryVersion"}
                      />
                    </Box>
                  </Box>
                )}
              </Box>
              <Box marginTop={2}>
                <StatusBar
                  hints={[
                    { keys: "tab", label: "next field" },
                    { keys: "↵", label: "advance/save" },
                    { keys: "esc", label: "cancel" },
                  ]}
                />
              </Box>
            </Box>
          ) : (
            // Default: a single-column server picker. Selected row expands
            // inline with one summary line — Codex-style.
            <Box flexDirection="column">
              <Text color={theme.fgDim}>SELECT A SERVER</Text>
              <Box marginTop={1} flexDirection="column">
                {instances.length === 0 ? (
                  <Text color={theme.fgDim}>
                    No saved instances. Press{" "}
                    <Text color={theme.accent} bold>
                      a
                    </Text>{" "}
                    for remote or{" "}
                    <Text color={theme.accent} bold>
                      l
                    </Text>{" "}
                    for local.
                  </Text>
                ) : (
                  instances.map((item) => {
                    const selected = item.id === selectedInstanceID
                    const isFocused = focus === "instances"
                    const tag = item.local ? "local " : "remote"
                    const tagColor = item.local ? theme.success : theme.info
                    return (
                      <Box key={item.id} flexDirection="column">
                        <Box>
                          <Text wrap="truncate-end">
                            <Text color={selected && isFocused ? theme.accent : theme.divider}>
                              {selected && isFocused ? "▍" : " "}
                            </Text>
                            <Text color={tagColor}>{`  ${tag}  `}</Text>
                            <Text
                              color={
                                selected ? (isFocused ? theme.accent : theme.fg) : theme.fgMuted
                              }
                              bold={selected}
                            >
                              {item.label ?? item.url}
                            </Text>
                            <Text color={theme.fgDim}>{`   ${item.url}`}</Text>
                          </Text>
                        </Box>
                        {selected ? (
                          <Box paddingLeft={4}>
                            <Text color={theme.fgDim} wrap="truncate-end">
                              {item.local && item.local.binaryVersion
                                ? `binary ${item.local.binaryVersion}  ·  `
                                : ""}
                              {item.headers
                                ? `${Object.keys(item.headers).length} headers  ·  `
                                : "no custom headers  ·  "}
                              {item.ignoreCertificateErrors ? "tls verify off" : "tls verify on"}
                            </Text>
                          </Box>
                        ) : null}
                      </Box>
                    )
                  })
                )}
              </Box>
              <Box marginTop={2}>
                <StatusBar hints={setupHints} />
              </Box>
            </Box>
          )}
        </Box>
      ) : route === "app.directory" ? (
        <Box marginTop={1} flexDirection="column" paddingX={1}>
          <Box>
            <Text color={theme.fgDim}>WHERE TO WORK</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.fg}>
              Pick a working directory for{" "}
              <Text bold color={theme.accent}>
                {opened.instance.label ?? opened.live.url}
              </Text>
              .
            </Text>
          </Box>

          <Box marginTop={1}>
            <PathInput
              value={
                directory?.mode === "input"
                  ? directory.pathInput
                  : directory
                    ? (directory.home && directory.cwd.startsWith(directory.home)
                        ? `~${directory.cwd.slice(directory.home.length)}`
                        : directory.cwd)
                    : opened.path.directory
              }
              active={directory?.mode === "input"}
              loading={directory?.loading}
              spinnerFrame={spinnerFrame}
              hint={
                directory?.mode === "input"
                  ? "↵ resolve · tab back to browse · esc cancel"
                  : "tab to type · i to type · / for commands"
              }
            />
          </Box>

          <Box marginTop={1} flexDirection="row">
            <Text color={theme.fgDim}>here:</Text>
            <Box marginLeft={1}>
              {directory ? (
                <Breadcrumb path={directory.cwd} home={directory.home} />
              ) : (
                <Text color={theme.fgDim}>loading…</Text>
              )}
            </Box>
          </Box>

          <Box marginTop={1}>
            {directory && directory.entries.length === 0 ? (
              <Text color={theme.fgDim}>empty directory</Text>
            ) : directory ? (
              <Box flexDirection="column">
                {(() => {
                  const rows = process.stdout.rows ?? 40
                  const visibleCount = Math.max(8, Math.min(directory.entries.length, rows - 16))
                  const half = Math.floor(visibleCount / 2)
                  const start = Math.max(
                    0,
                    Math.min(
                      directory.selected - half,
                      Math.max(0, directory.entries.length - visibleCount),
                    ),
                  )
                  const visible = directory.entries.slice(start, start + visibleCount)
                  return (
                    <>
                      {start > 0 ? (
                        <Text color={theme.fgDim}>
                          {"  "}
                          {glyph.arrowUp} {start} more above
                        </Text>
                      ) : null}
                      {visible.map((entry, index) => {
                        const realIndex = start + index
                        const selected = realIndex === directory.selected
                        const isDir = entry.type === "directory"
                        const active = directory.mode === "browse"
                        return (
                          <Box key={entry.path}>
                            <Text wrap="truncate-end">
                              <Text color={selected && active ? theme.accent : theme.divider}>
                                {selected && active ? "▍" : " "}
                              </Text>
                              <Text color={isDir ? theme.accent : theme.fgDim}>
                                {isDir ? ` ${glyph.folder}  ` : ` ${glyph.file}  `}
                              </Text>
                              <Text
                                color={
                                  selected && active
                                    ? theme.accent
                                    : isDir
                                      ? theme.fg
                                      : theme.fgDim
                                }
                                bold={(selected && active) || isDir}
                              >
                                {entry.name}
                              </Text>
                              {isDir ? <Text color={theme.fgDim}>/</Text> : null}
                            </Text>
                          </Box>
                        )
                      })}
                      {start + visible.length < directory.entries.length ? (
                        <Text color={theme.fgDim}>
                          {"  "}
                          {glyph.arrowDown} {directory.entries.length - start - visible.length} more
                          below
                        </Text>
                      ) : null}
                    </>
                  )
                })()}
              </Box>
            ) : (
              <Text color={theme.fgDim}>loading directory…</Text>
            )}
          </Box>

          <Box marginTop={1}>
            <StatusBar
              hints={
                directory?.mode === "input"
                  ? [
                      { keys: "↵", label: "resolve" },
                      { keys: "tab", label: "browse" },
                      { keys: "esc", label: "cancel" },
                    ]
                  : [
                      { keys: "↑↓", label: "navigate" },
                      { keys: "↵/→", label: "enter dir" },
                      { keys: "←/⌫", label: "up" },
                      { keys: "i", label: "type path" },
                      { keys: "h", label: "home" },
                      { keys: "w", label: "worktree" },
                      { keys: "space/o", label: "open here" },
                      { keys: "esc", label: "back" },
                    ]
              }
            />
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <RouteTabs tabs={routeTabs} active={route} />

          <Box marginTop={1} alignItems="flex-start" gap={1}>
            {sidebarOpen ? (
              <Box flexDirection="column" width={30} flexShrink={0} gap={1}>
                <Panel
                  title="Sessions"
                  subtitle={`${sessions.length}`}
                  active={focus === "sessions"}
                >
                  <SessionList
                    sessions={sessionItems}
                    selectedID={selectedSessionID}
                    active={focus === "sessions"}
                    spinnerFrame={spinnerFrame}
                  />
                </Panel>
                {(route === "app.session" || route === "app.home") && todoItems.length > 0 ? (
                  <Panel
                    title="Tasks"
                    subtitle={`${todoItems.filter((t) => t.status === "completed").length}/${todoItems.length} done`}
                  >
                    <TodoList todos={todoItems} limit={8} />
                  </Panel>
                ) : null}
                {(route === "app.session" || route === "app.home") && diffEntries.length > 0 ? (
                  <Panel
                    title="Diff"
                    subtitle={selectedDiffs.length ? `${selectedDiffs.length} files` : "clean"}
                  >
                    <DiffView lines={diffEntries} limit={10} />
                  </Panel>
                ) : null}
              </Box>
            ) : null}

            <Box flexDirection="column" flexGrow={1}>
              {route === "app.notifications" ? (
                // Single-column inbox: each entry inline-expands its details
                // when selected. Codex-style approval flow.
                <Box paddingX={2} flexDirection="column">
                  <Text color={theme.fgDim}>
                    INBOX
                    {notificationViewItems.length > 0
                      ? ` · ${notificationViewItems.length} pending`
                      : ""}
                  </Text>
                  <Box marginTop={1} flexDirection="column">
                    {notificationViewItems.length === 0 ? (
                      <Text color={theme.fgDim}>No pending permissions or questions.</Text>
                    ) : (
                      notificationViewItems.map((item) => {
                        const selected = item.id === selectedNotification?.id
                        const isFocused = focus === "notifications"
                        const tone = item.tone === "permission" ? theme.warning : theme.info
                        return (
                          <Box key={item.id} flexDirection="column" marginBottom={1}>
                            <Box>
                              <Text wrap="truncate-end">
                                <Text color={selected && isFocused ? theme.accent : theme.divider}>
                                  {selected && isFocused ? "▍" : " "}
                                </Text>
                                <Text color={tone} bold>{`  ${item.tone}  `}</Text>
                                <Text
                                  color={
                                    selected
                                      ? isFocused
                                        ? theme.accent
                                        : theme.fg
                                      : theme.fgMuted
                                  }
                                  bold={selected}
                                >
                                  {item.title}
                                </Text>
                              </Text>
                            </Box>
                            {selected && selectedPermission ? (
                              <Box paddingLeft={4} flexDirection="column">
                                {selectedPermission.patterns.length > 0 ? (
                                  <Text color={theme.fgDim} wrap="truncate-end">
                                    patterns: {selectedPermission.patterns.slice(0, 4).join(", ")}
                                    {selectedPermission.patterns.length > 4
                                      ? ` (+${selectedPermission.patterns.length - 4})`
                                      : ""}
                                  </Text>
                                ) : null}
                                <Box marginTop={1}>
                                  <Text color={theme.fgDim}>
                                    <Text color={theme.success} bold>
                                      y
                                    </Text>{" "}
                                    approve once   <Text color={theme.success} bold>
                                      a
                                    </Text>{" "}
                                    always   <Text color={theme.error} bold>
                                      x
                                    </Text>{" "}
                                    reject
                                  </Text>
                                </Box>
                              </Box>
                            ) : selected && selectedQuestion ? (
                              <Box paddingLeft={4} flexDirection="column">
                                {selectedQuestion.questions.flatMap((question, qi) =>
                                  question.options.slice(0, 4).map((option, oi) => (
                                    <Text key={`q-o-${qi}-${oi}`} color={theme.fgDim} wrap="truncate-end">
                                      · <Text color={theme.fg}>{option.label}</Text>
                                      {option.description ? `  ${option.description}` : ""}
                                    </Text>
                                  )),
                                )}
                                <Box marginTop={1}>
                                  <Text color={theme.fgDim}>
                                    <Text color={theme.success} bold>
                                      r
                                    </Text>{" "}
                                    reply with first options   <Text color={theme.error} bold>
                                      x
                                    </Text>{" "}
                                    reject
                                  </Text>
                                </Box>
                              </Box>
                            ) : null}
                          </Box>
                        )
                      })
                    )}
                  </Box>
                </Box>
              ) : route === "app.cron" ? (
                <Panel
                  title="Cron Tasks"
                  subtitle={`${cronRows.length}`}
                  active={focus === "cron"}
                >
                  {cronRows.length === 0 ? (
                    <Text color={theme.fgDim}>No cron tasks scheduled.</Text>
                  ) : (
                    <Box flexDirection="column">
                      {cronRows.map((row) => (
                        <Box key={row.id}>
                          <Text wrap="truncate-end">
                            <Text
                              color={
                                row.status === "running"
                                  ? theme.warning
                                  : row.status === "error"
                                    ? theme.error
                                    : theme.success
                              }
                            >
                              {row.status === "running"
                                ? glyph.toolRunning
                                : row.status === "error"
                                  ? glyph.toolError
                                  : glyph.toolDone}
                            </Text>
                            <Text>{` ${row.name}`}</Text>
                            <Text color={theme.fgDim}>{`  ${row.schedule}`}</Text>
                          </Text>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Panel>
              ) : route === "app.settings" ? (
                <Panel
                  title="Workspace"
                  subtitle={versionInfo.hasUpdate ? "update available" : "up to date"}
                  active={focus === "settings"}
                >
                  <Box flexDirection="column">
                    <MetricRow label="Server" value={opened.live.url} tone="muted" />
                    <MetricRow label="Path" value={opened.path.directory} tone="muted" />
                    <MetricRow label="Current" value={versionInfo.current ?? opened.version} />
                    <MetricRow
                      label="Latest"
                      value={versionInfo.latest ?? "unknown"}
                      tone={versionInfo.hasUpdate ? "success" : "muted"}
                    />
                    <MetricRow
                      label="Install method"
                      value={versionInfo.method ?? "unknown"}
                      tone="muted"
                    />
                    <Box marginTop={1}>
                      <Text color={theme.fgDim}>
                        Press <Text color={theme.accent}>u</Text>{" "}
                        {versionInfo.hasUpdate ? "to upgrade" : "to refresh"}.
                      </Text>
                    </Box>
                  </Box>
                </Panel>
              ) : route === "app.session" ? (
                // Borderless conversation surface — title row + body, no panel.
                <Box flexDirection="column" paddingX={2}>
                  <Box>
                    <Text wrap="truncate-end">
                      <Text color={theme.accent} bold>
                        {selectedSession?.title ?? "no session"}
                      </Text>
                      {selectedSession ? (
                        <Text color={theme.fgDim}>
                          {`   ·   ${conversationParts.length} parts`}
                          {sessionBusy ? `   ·   ${spinnerFrame} working` : ""}
                        </Text>
                      ) : null}
                    </Text>
                  </Box>
                  {activeAgent || activeModel || activeVariant ? (
                    <Box>
                      <Text wrap="truncate-end">
                        {activeAgent ? (
                          <>
                            <Text color={theme.fgDim}>agent </Text>
                            <Text color={theme.tool}>{activeAgent}</Text>
                          </>
                        ) : null}
                        {activeAgent && (activeModel || activeVariant) ? (
                          <Text color={theme.fgDim}>{"   ·   "}</Text>
                        ) : null}
                        {activeModel ? (
                          <>
                            <Text color={theme.fgDim}>model </Text>
                            <Text color={theme.info}>
                              {activeModel.providerName} · {activeModel.modelName}
                            </Text>
                          </>
                        ) : null}
                        {activeModel && activeVariant ? (
                          <Text color={theme.fgDim}>{"   ·   "}</Text>
                        ) : null}
                        {activeVariant ? (
                          <>
                            <Text color={theme.fgDim}>effort </Text>
                            <Text color={theme.warning}>{activeVariant}</Text>
                          </>
                        ) : null}
                      </Text>
                    </Box>
                  ) : null}
                  <Box marginTop={1}>
                    {conversationParts.length === 0 ? (
                      <Text color={theme.fgDim}>
                        Press <Text color={theme.accent}>n</Text> for a new session, then type below
                        to start a conversation.
                      </Text>
                    ) : (
                      <Conversation parts={conversationVisible} spinnerFrame={spinnerFrame} />
                    )}
                  </Box>
                </Box>
              ) : (
                <Panel title="Workspace" active={focus === "messages"}>
                  <Box flexDirection="column">
                    <MetricRow
                      label="workspace"
                      value={relative(opened.path.worktree, opened.path.directory)}
                    />
                    <MetricRow label="sessions" value={`${sessions.length}`} tone="muted" />
                    <MetricRow
                      label="inbox"
                      value={`${permissions.length + questions.length}`}
                      tone={permissions.length + questions.length > 0 ? "warning" : "muted"}
                    />
                    <MetricRow label="cron" value={`${cronTasks.length}`} tone="muted" />
                    <MetricRow
                      label="active session"
                      value={selectedSession?.title ?? "none"}
                      tone="accent"
                    />
                    <MetricRow
                      label="share link"
                      value={selectedSession?.share?.url ?? "—"}
                      tone={selectedSession?.share?.url ? "info" : "muted"}
                    />
                  </Box>
                </Panel>
              )}

              {route === "app.session" && fileContent?.type === "text" ? (
                <Box marginTop={1}>
                  <Panel
                    title="Files"
                    subtitle={selectedFilePath || undefined}
                    active={focus === "files"}
                  >
                    <FileList
                      files={files.map((file) => ({
                        path: file.path,
                        type: file.type,
                        rel: opened ? relative(opened.path.directory, file.absolute) : file.path,
                      }))}
                      selected={selectedFilePath}
                      active={focus === "files"}
                    />
                  </Panel>
                </Box>
              ) : null}
            </Box>
          </Box>

          <Box marginTop={1} paddingX={2} flexDirection="column">
            <Composer
              value={composerValue}
              placeholder={composerPlaceholder}
              active={focus === "composer"}
              hint={composerHint}
              status={sessionBusy ? "busy" : "idle"}
              spinnerFrame={spinnerFrame}
            />
          </Box>

          {terminalOpen ? (
            <Box marginTop={1}>
              <Panel
                title="Terminals"
                subtitle={selectedTerminal?.title}
                active={focus === "terminals"}
              >
                <Box flexDirection="column">
                  <Box>
                    {terminals.length === 0 ? (
                      <Text color={theme.fgDim}>
                        Press <Text color={theme.accent}>n</Text> to create a terminal.
                      </Text>
                    ) : (
                      terminals.map((tab, index) => (
                        <React.Fragment key={tab.id}>
                          {index > 0 ? <Text color={theme.fgDim}>{"  "}</Text> : null}
                          <Text
                            color={tab.id === activeTerminalID ? theme.accent : theme.fgMuted}
                            bold={tab.id === activeTerminalID}
                          >
                            {tab.id === activeTerminalID ? `▍${tab.title}` : tab.title}
                          </Text>
                        </React.Fragment>
                      ))
                    )}
                  </Box>
                  {selectedTerminal ? (
                    <Box marginTop={1} flexDirection="column">
                      {terminalLines(selectedTerminal, 12).map((line, index) => (
                        <Text key={index} wrap="truncate-end">
                          {line || " "}
                        </Text>
                      ))}
                    </Box>
                  ) : null}
                  <Box marginTop={1}>
                    <Text color={theme.fgDim}>
                      <Text color={theme.accent}>tab</Text> focus · <Text color={theme.accent}>x</Text>{" "}
                      close · text is sent to the PTY
                    </Text>
                  </Box>
                </Box>
              </Panel>
            </Box>
          ) : null}

          <Box marginTop={1}>
            <StatusBar hints={workspaceHints} />
          </Box>
        </Box>
      )}

      {paletteOpen ? (
        <Box marginTop={1}>
          <CommandPalette
            filter={paletteFilter}
            selection={paletteSelection}
            options={commandOptions}
          />
        </Box>
      ) : null}
    </Box>
  )
}
