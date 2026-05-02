import React, { startTransition, useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import type {
  CronTask,
  FileContent,
  FileNode,
  Message,
  Part,
  Path,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@codeplane-ai/sdk/v2/client"
import type { LocalTarget, OpenProgress, SavedInstance } from "@codeplane-ai/shared/instance"
import { localInstanceUrl } from "@codeplane-ai/shared/instance"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import { createInstanceService, type InstanceService } from "./instance-service"
import { wsUrlForInstance } from "./client"

type SetupRoute = "setup.list" | "setup.remote-form" | "setup.local-form" | "setup.settings"
type WorkspaceRoute = "app.home" | "app.notifications" | "app.settings" | "app.cron" | "app.session"
type Route = SetupRoute | WorkspaceRoute
type Focus =
  | "instances"
  | "setupForm"
  | "sessions"
  | "files"
  | "messages"
  | "composer"
  | "notifications"
  | "cron"
  | "settings"
  | "terminals"
  | "palette"
type Opened = Awaited<ReturnType<InstanceService["open"]>>

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
  run: () => Promise<void> | void
}

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

function formatHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return ""
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ")
}

function parseHeaders(input: string) {
  return input
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, item) => {
      const index = item.indexOf(":")
      if (index === -1) return acc
      const key = item.slice(0, index).trim()
      const value = item.slice(index + 1).trim()
      if (!key || !value) return acc
      acc[key] = value
      return acc
    }, {})
}

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

function renderPart(part: Part) {
  switch (part.type) {
    case "text":
      return part.text
    case "reasoning":
      return `[reasoning]\n${part.text}`
    case "tool":
      return `[tool:${part.tool}] ${part.state.status}${"title" in part.state && part.state.title ? ` ${part.state.title}` : ""}${
        part.state.status === "completed" ? `\n${part.state.output}` : part.state.status === "error" ? `\n${part.state.error}` : ""
      }`
    case "file":
      return `[file] ${part.filename ?? part.url}`
    case "subtask":
      return `[subtask:${part.agent}] ${part.description}`
    case "agent":
      return `[agent] ${part.name}`
    case "retry":
      return `[retry ${part.attempt}] ${part.error.data.message}`
    case "compaction":
      return `[compaction] ${part.auto ? "auto" : "manual"}${part.overflow ? " overflow" : ""}`
    case "patch":
      return `[patch] ${part.files.join(", ")}`
    case "snapshot":
      return `[snapshot] ${part.snapshot}`
    case "step-start":
      return "[step-start]"
    case "step-finish":
      return `[step-finish] ${part.reason}`
  }
}

function renderMessageBlock(message: Message, parts: Part[]) {
  const heading =
    message.role === "user"
      ? `User  ${formatTime(message.time.created)}`
      : `Assistant  ${formatTime(message.time.created)}${"completed" in message.time && message.time.completed ? ` -> ${formatTime(message.time.completed)}` : ""}`
  return [heading, ...parts.map(renderPart).flatMap((part) => part.split("\n")), ""]
}

function renderMessages(messages: Array<{ info: Message; parts: Part[] }>) {
  return messages.flatMap((item) => renderMessageBlock(item.info, item.parts))
}

function renderDiffs(diffs: SnapshotFileDiff[]) {
  if (diffs.length === 0) return ["No diff snapshot"]
  return diffs.flatMap((diff) => [`${diff.status ?? "modified"} ${diff.file} (+${diff.additions}/-${diff.deletions})`, ...diff.patch.split("\n"), ""])
}

function renderTodos(todos: Todo[]) {
  if (todos.length === 0) return ["No todos"]
  return todos.map((todo) => `[${todo.status}] (${todo.priority}) ${todo.content}`)
}

function terminalLines(tab: TerminalTab, rows: number) {
  const buffer = tab.terminal.buffer.active
  const end = Math.max(0, buffer.length - tab.scrollOffset)
  const start = Math.max(0, end - rows)
  return Array.from({ length: Math.max(0, end - start) }, (_, index) =>
    buffer.getLine(start + index)?.translateToString(false) ?? "",
  )
}

function Panel(props: {
  title: string
  active?: boolean
  width?: number | string
  grow?: number
  children: React.ReactNode
}) {
  return (
    <Box borderStyle="round" borderColor={props.active ? "cyan" : "gray"} flexDirection="column" width={props.width} flexGrow={props.grow}>
      <Box paddingX={1}>
        <Text bold color={props.active ? "cyan" : "white"}>
          {props.title}
        </Text>
      </Box>
      <Box paddingX={1} paddingBottom={1} flexDirection="column" flexGrow={1}>
        {props.children}
      </Box>
    </Box>
  )
}

function Lines(props: { lines: string[]; limit?: number }) {
  const lines = props.limit ? props.lines.slice(-props.limit) : props.lines
  if (lines.length === 0) return <Text dimColor>Empty</Text>
  return (
    <>
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`}>{line || " "}</Text>
      ))}
    </>
  )
}

function StatusBanner(props: { variant: "info" | "success" | "error" | "warning"; text: string }) {
  const color =
    props.variant === "success"
      ? "green"
      : props.variant === "error"
        ? "red"
        : props.variant === "warning"
          ? "yellow"
          : "cyan"
  const label =
    props.variant === "success"
      ? "success"
      : props.variant === "error"
        ? "error"
        : props.variant === "warning"
          ? "warning"
          : "info"
  return (
    <Text color={color}>
      [{label}] {props.text}
    </Text>
  )
}

function Meter(props: { value: number }) {
  const width = 32
  const clamped = Math.max(0, Math.min(100, Math.round(props.value)))
  const filled = Math.round((clamped / 100) * width)
  return (
    <Text>
      [{"■".repeat(filled)}
      {"·".repeat(Math.max(0, width - filled))}] {clamped}%
    </Text>
  )
}

function InputField(props: { value: string; placeholder: string; active?: boolean }) {
  if (!props.value) {
    return (
      <Text dimColor>
        {props.active ? "› " : "  "}
        {props.placeholder}
        {props.active ? "█" : ""}
      </Text>
    )
  }
  return (
    <Text color={props.active ? "cyan" : undefined}>
      {props.active ? "› " : "  "}
      {props.value}
      {props.active ? "█" : ""}
    </Text>
  )
}

function OptionList(props: {
  options: Array<{ label: string; value: string }>
  selectedValue?: string
  active?: boolean
  empty?: string
  limit?: number
}) {
  if (props.options.length === 0) return <Text dimColor>{props.empty ?? "Empty"}</Text>
  const index = Math.max(0, props.options.findIndex((item) => item.value === props.selectedValue))
  const limit = props.limit ?? 14
  const start = Math.max(0, Math.min(index - Math.floor(limit / 2), Math.max(0, props.options.length - limit)))
  const visible = props.options.slice(start, start + limit)
  return (
    <>
      {visible.map((item) => {
        const selected = item.value === props.selectedValue
        return (
          <Text key={item.value} color={selected && props.active ? "cyan" : selected ? "white" : "gray"}>
            {selected ? (props.active ? "›" : "•") : " "} {item.label}
          </Text>
        )
      })}
    </>
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
  const [composerValue, setComposerValue] = useState("")
  const [messageScroll, setMessageScroll] = useState(0)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminals, setTerminals] = useState<TerminalTab[]>([])
  const [activeTerminalID, setActiveTerminalID] = useState<string>()
  const [versionInfo, setVersionInfo] = useState<{ current?: string; latest?: string | null; hasUpdate?: boolean; method?: string }>({})
  const refreshTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const eventAbort = useRef<AbortController | undefined>(undefined)
  const terminalClose = useRef<Map<string, VoidFunction>>(new Map())

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
    await Promise.all([refreshSessions(), refreshFiles("."), refreshNotifications(), refreshCron(), refreshVersion()])
  }

  async function openInstance(instance: SavedInstance) {
    setOpening({
      instanceID: instance.id,
      phase: "probe",
      message: "Opening instance…",
      percent: 0,
    })
    setMessage("info", `Opening ${instance.label ?? instance.url}`)
    const next = await service.open(instance, (progress) => setOpening(progress))
    startTransition(() => {
      setOpened(next)
      setRoute("app.home")
      setFocus("sessions")
      setOpening(undefined)
      setSessionMessages({})
      setTodos({})
      setDiffs({})
      setTerminals([])
      setTerminalOpen(false)
    })
    await refreshWorkspace()
    if (props.initialRoute === "session") {
      setRoute("app.session")
      setFocus("messages")
    }
    setMessage("success", `Connected to ${next.live.url}`)
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
    setFocus("sessions")
    await selected.run()
  }

  function buildCommands(): CommandAction[] {
    return [
      { id: "home", label: "Open Home", run: () => setRoute("app.home") },
      { id: "notifications", label: "Open Notifications", run: () => setRoute("app.notifications") },
      { id: "settings", label: "Open Settings", run: () => setRoute("app.settings") },
      { id: "cron", label: "Open Cron", run: () => setRoute("app.cron") },
      { id: "session", label: "Open Session", run: () => setRoute("app.session") },
      { id: "new-session", label: "Create Session", run: createSession },
      ...(selectedSession && selectedSession.share?.url
        ? [{ id: "unshare", label: "Unshare Session", run: () => opened?.client.session.unshare({ sessionID: selectedSession.id }).then(() => refreshSessions()) }]
        : selectedSession
          ? [{ id: "share", label: "Share Session", run: () => opened?.client.session.share({ sessionID: selectedSession.id }).then(() => refreshSessions()) }]
          : []),
      ...(selectedSession && !selectedSession.time.archived
        ? [
            {
              id: "archive",
              label: "Archive Session",
              run: () =>
                opened?.client.session.update({ sessionID: selectedSession.id, time: { archived: Date.now() } }).then(() => refreshSessions()),
            },
          ]
        : selectedSession
          ? [
              {
                id: "unarchive",
                label: "Unarchive Session",
                run: () =>
                  opened?.client.session.update({ sessionID: selectedSession.id, time: { archived: null } }).then(() => refreshSessions()),
              },
            ]
          : []),
      ...(selectedSession && !selectedSession.revert && selectedMessages.length > 0
        ? [
            {
              id: "revert-last",
              label: "Revert To Latest Assistant Output",
              run: () => {
                const message = [...selectedMessages].reverse().find((item) => item.info.role === "assistant")
                if (!message) return
                return opened?.client.session.revert({ sessionID: selectedSession.id, messageID: message.info.id }).then(() => refreshSessions())
              },
            },
          ]
        : selectedSession && selectedSession.revert
          ? [{ id: "unrevert", label: "Remove Revert", run: () => opened?.client.session.unrevert({ sessionID: selectedSession.id }).then(() => refreshSessions()) }]
          : []),
      { id: "terminal-toggle", label: terminalOpen ? "Hide Terminal Dock" : "Show Terminal Dock", run: () => setTerminalOpen((value) => !value) },
      { id: "terminal-new", label: "New Terminal", run: createTerminalTab },
      {
        id: "upgrade",
        label: versionInfo.hasUpdate ? `Upgrade Server To ${versionInfo.latest}` : "Refresh Version Info",
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
  const commandOptions = buildCommands()
    .filter((item) => item.label.toLowerCase().includes(paletteFilter.toLowerCase()))
    .map((item) => ({ label: item.label, value: item.id }))

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
            case "installation.update-available":
              queueRefresh("version", refreshVersion, 50)
              break
          }
        }
      })
      .catch(() => undefined)
    return () => abort.abort()
  }, [opened?.live.url, opened?.path.directory, selectedSessionID])

  useEffect(
    () => () => {
      eventAbort.current?.abort()
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
          setFocus("sessions")
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
      if (input === "t" && focus !== "terminals") setTerminalOpen((value) => !value)
      if (input === "n" && focus !== "terminals") {
        void createTerminalTab().catch((error) => setMessage("error", error instanceof Error ? error.message : String(error)))
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

  const messageLines = renderMessages(selectedMessages)
  const visibleMessageLines = messageScroll > 0 ? messageLines.slice(Math.max(0, messageLines.length - 40 - messageScroll), Math.max(0, messageLines.length - messageScroll)) : messageLines.slice(-40)
  const diffLines = renderDiffs(selectedDiffs).slice(0, 18)
  const todoLines = renderTodos(selectedTodos).slice(0, 10)

  return (
    <Box flexDirection="column" height={process.stdout.rows || 40}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          codeplane tui
        </Text>
        <Text>
          {opened ? `${opened.instance.label ?? opened.live.url} · ${relative(opened.path.worktree, opened.path.directory)}` : "instance setup"}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {statusMessage ? <StatusBanner variant={statusMessage.variant} text={statusMessage.text} /> : null}
      </Box>

      {opening ? (
        <Box marginTop={1} flexDirection="column">
          <Text>{opening.message}</Text>
          <Meter value={opening.percent} />
        </Box>
      ) : null}

      {!opened ? (
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          <Box gap={1} flexGrow={1}>
            <Panel title="Instances" active={focus === "instances"} grow={2}>
              {instances.length === 0 ? (
                <Text dimColor>No saved instances. Press `a` for remote or `l` for local.</Text>
              ) : (
                <OptionList options={instanceOptions} selectedValue={selectedInstanceID} active={focus === "instances"} empty="No instances" />
              )}
            </Panel>
            <Panel title={route === "setup.settings" ? "Settings" : form?.kind === "local" ? "Local Instance" : "Remote Instance"} active={focus === "setupForm" || focus === "settings"} grow={3}>
              {route === "setup.settings" ? (
                <>
                  <Text>Current CLI version: {CodeplaneVersion}</Text>
                  <Text>Default local runtime: {localTargetInfo?.defaultVersion ?? CodeplaneVersion}</Text>
                  <Text>Keyboard: `a` add remote, `l` add local, `e` edit, `d` delete, `enter` open.</Text>
                  <Text>Interactive bare `codeplane` now routes here; non-interactive bare `codeplane` still routes to `web`.</Text>
                  <Text>Node companion runtime: {process.version}</Text>
                </>
              ) : form ? (
                <>
                  <Text color={form.field === "label" ? "cyan" : undefined}>Label</Text>
                  <InputField value={form.label} placeholder="My server" active={form.field === "label"} />
                  {form.kind === "remote" ? (
                    <>
                      <Text color={form.field === "url" ? "cyan" : undefined}>URL</Text>
                      <InputField value={form.url} placeholder="https://server.example.com" active={form.field === "url"} />
                      <Text color={form.field === "headers" ? "cyan" : undefined}>Headers (`name: value; name2: value2`)</Text>
                      <InputField value={form.headers} placeholder="Authorization: Bearer ..." active={form.field === "headers"} />
                    </>
                  ) : (
                    <>
                      <Text color={form.field === "binaryVersion" ? "cyan" : undefined}>Binary version</Text>
                      <InputField
                        value={form.binaryVersion}
                        placeholder={localTargetInfo?.defaultVersion ?? CodeplaneVersion}
                        active={form.field === "binaryVersion"}
                      />
                    </>
                  )}
                  <Box marginTop={1} flexDirection="column">
                    <Text dimColor>`tab` next field, `enter` advance/save, `esc` cancel</Text>
                  </Box>
                </>
              ) : selectedInstance ? (
                <>
                  <Text>{selectedInstance.label ?? selectedInstance.url}</Text>
                  <Text dimColor>{selectedInstance.local ? `Local binary ${selectedInstance.local.binaryVersion}` : selectedInstance.url}</Text>
                  <Text>{selectedInstance.headers ? `${Object.keys(selectedInstance.headers).length} custom headers configured` : "No custom headers"}</Text>
                  <Text>{selectedInstance.ignoreCertificateErrors ? "TLS certificate verification disabled" : "TLS verification enabled"}</Text>
                </>
              ) : (
                <Text dimColor>Select an instance to inspect or open.</Text>
              )}
            </Panel>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          <Box>
            <Text color={route === "app.home" ? "cyan" : undefined}>[1] Home</Text>
            <Text> </Text>
            <Text color={route === "app.notifications" ? "cyan" : undefined}>[2] Notifications</Text>
            <Text> </Text>
            <Text color={route === "app.settings" ? "cyan" : undefined}>[3] Settings</Text>
            <Text> </Text>
            <Text color={route === "app.cron" ? "cyan" : undefined}>[4] Cron</Text>
            <Text> </Text>
            <Text color={route === "app.session" ? "cyan" : undefined}>[5] Session</Text>
          </Box>

	          <Box gap={1} flexGrow={1} marginTop={1}>
            <Panel title="Sessions" active={focus === "sessions"} width="28%">
              <OptionList options={sessionOptions} selectedValue={selectedSessionID} active={focus === "sessions"} empty="No sessions" />
            </Panel>

            {route === "app.notifications" ? (
              <>
                <Panel title="Notifications" active={focus === "notifications"} grow={2}>
                  {notificationItems.length === 0 ? (
                    <Text dimColor>No pending permissions or questions.</Text>
                  ) : (
                    <OptionList
                      options={notificationItems}
                      selectedValue={selectedNotification ? `${selectedNotification.kind}:${selectedNotification.id}` : undefined}
                      active={focus === "notifications"}
                      empty="No notifications"
                    />
                  )}
                </Panel>
                <Panel title="Details" active={focus === "settings"} grow={3}>
                  {selectedPermission ? (
                    <>
                      <Text>{selectedPermission.permission}</Text>
                      <Lines lines={selectedPermission.patterns} limit={12} />
                      <Text dimColor>`y` approve once, `a` always, `x` reject</Text>
                    </>
                  ) : selectedQuestion ? (
                    <>
                      <Lines
                        lines={selectedQuestion.questions.flatMap((question) => [
                          question.header,
                          question.question,
                          ...question.options.map((option) => `  - ${option.label}: ${option.description}`),
                          "",
                        ])}
                        limit={24}
                      />
                      <Text dimColor>`r` reply with first options, `x` reject</Text>
                    </>
                  ) : (
                    <Text dimColor>Select a notification.</Text>
                  )}
                </Panel>
              </>
            ) : route === "app.cron" ? (
              <>
                <Panel title="Cron Tasks" active={focus === "cron"} grow={5}>
                  {cronTasks.length === 0 ? <Text dimColor>No cron tasks.</Text> : <Lines lines={cronTasks.map((item) => `${item.status} · ${item.name} · ${item.schedule.kind === "cron" ? item.schedule.expression : `${item.schedule.intervalMs}ms`}`)} limit={30} />}
                </Panel>
              </>
            ) : route === "app.settings" ? (
              <>
                <Panel title="Instance Settings" active={focus === "settings"} grow={5}>
                  <Text>Current: {versionInfo.current ?? opened.version}</Text>
                  <Text>Latest: {versionInfo.latest ?? "unknown"}</Text>
                  <Text>Install method: {versionInfo.method ?? "unknown"}</Text>
                  <Text>Path: {opened.path.directory}</Text>
                  <Text>Server: {opened.live.url}</Text>
                  <Text>{versionInfo.hasUpdate ? "Update available" : "No update available"}</Text>
                  <Text dimColor>`u` upgrade or refresh version status</Text>
                </Panel>
              </>
            ) : (
              <>
                <Panel title={route === "app.session" ? "Conversation" : "Project"} active={focus === "messages"} grow={3}>
                  {route === "app.home" ? (
                    <>
                      <Text>{relative(opened.path.worktree, opened.path.directory)}</Text>
                      <Text>{sessions.length} sessions · {permissions.length + questions.length} notifications · {cronTasks.length} cron tasks</Text>
                      <Text>{selectedSession?.share?.url ? `Shared: ${selectedSession.share.url}` : "Session not shared"}</Text>
                      <Text>{selectedSession?.revert ? `Reverted to ${selectedSession.revert.messageID}` : "No active revert"}</Text>
                      <Box marginTop={1}>
                        <Text bold>Todos</Text>
                      </Box>
                      <Lines lines={todoLines} limit={10} />
                    </>
                  ) : (
                    <>
                      <Lines lines={visibleMessageLines} />
                      <Text dimColor>`tab` cycles panes, `/` opens command palette, `page up/down` scrolls this panel</Text>
                    </>
                  )}
                </Panel>
                <Panel title="Files / Details" active={focus === "files"} grow={2}>
                  <OptionList options={fileOptions} selectedValue={selectedFilePath} active={focus === "files"} empty="No files" />
                  {route === "app.session" ? (
                    <Box marginTop={1} flexDirection="column">
                      <Text bold>Todo</Text>
                      <Lines lines={todoLines} limit={8} />
                      <Text bold>Diff</Text>
                      <Lines lines={diffLines} limit={12} />
                    </Box>
                  ) : fileContent?.type === "text" ? (
                    <Box marginTop={1}>
                      <Lines lines={fileContent.content.split("\n").slice(0, 20)} />
                    </Box>
                  ) : (
                    <Box marginTop={1}>
                      <Text dimColor>{selectedFilePath ? "Select a file to preview." : "Choose a file or directory."}</Text>
                    </Box>
                  )}
                </Panel>
              </>
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Panel title="Composer" active={focus === "composer"}>
              <InputField
                value={composerValue}
                placeholder={selectedSession ? `Message ${selectedSession.title}` : "Create a session and send a prompt"}
                active={focus === "composer"}
              />
            </Panel>
          </Box>

          {terminalOpen ? (
            <Box marginTop={1}>
              <Panel title={`Terminal Dock${selectedTerminal ? ` · ${selectedTerminal.title}` : ""}`} active={focus === "terminals"} grow={1}>
                <Text>{terminals.map((item) => `${item.id === activeTerminalID ? "[" : ""}${item.title}${item.id === activeTerminalID ? "]" : ""}`).join("  ") || "No terminals"}</Text>
                {selectedTerminal ? <Lines lines={terminalLines(selectedTerminal, 12)} limit={12} /> : <Text dimColor>Press `n` to create a terminal tab.</Text>}
                <Text dimColor>`tab` focus terminal, `x` close active tab, text is sent directly to the PTY</Text>
              </Panel>
            </Box>
          ) : null}
        </Box>
      )}

      {paletteOpen ? (
        <Box
          position="absolute"
          top={3}
          left={4}
          right={4}
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
          paddingBottom={1}
        >
          <Text bold color="cyan">
            Command Palette
          </Text>
          <InputField value={paletteFilter} placeholder="Filter commands" active />
          {commandOptions.length > 0 ? (
            <OptionList options={commandOptions} selectedValue={paletteSelection} active empty="No matching commands." />
          ) : (
            <Text dimColor>No matching commands.</Text>
          )}
          <Text dimColor>`esc` closes the palette</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          focus:{focus} · route:{route} · keys: `tab` cycle, `/` palette, `n` terminal, `q` quit
        </Text>
      </Box>
    </Box>
  )
}
