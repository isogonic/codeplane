import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { getScrollAcceleration } from "@tui/util/scroll"
import { useTuiConfig } from "@tui/context/tui-config"
import { useToast } from "@tui/ui/toast"
import { Locale } from "@/util"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"

type TaskWave = {
  message: Message
  index: number
  tasks: ToolPart[]
}

function isTaskPart(part: Part): part is ToolPart {
  return part.type === "tool" && part.tool === "task"
}

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool"
}

function taskWaves(sessionID: string, sync: ReturnType<typeof useSync>): TaskWave[] {
  return (sync.data.message[sessionID] ?? []).flatMap((message, index): TaskWave[] => {
    if (message.role !== "assistant") return []
    const tasks = (sync.data.part[message.id] ?? []).filter(isTaskPart)
    if (tasks.length === 0) return []
    return [{ message, index, tasks }]
  })
}

function taskSessionID(part: ToolPart): string | undefined {
  if (part.state.status === "pending") return
  const value = part.state.metadata?.sessionId
  if (typeof value === "string" && value.length > 0) return value
}

function inputText(part: ToolPart, key: string, fallback: string) {
  const value = part.state.input[key]
  if (typeof value === "string" && value.trim().length > 0) return value
  return fallback
}

function taskTitle(part: ToolPart) {
  return inputText(part, "description", part.state.status === "completed" ? part.state.title : "Task")
}

function taskAgent(part: ToolPart) {
  return Locale.titlecase(inputText(part, "subagent_type", "general"))
}

function taskDuration(part: ToolPart): string | undefined {
  if (part.state.status === "pending") return
  const end = part.state.status === "running" ? Date.now() : part.state.time.end
  return Locale.duration(end - part.state.time.start)
}

function taskSessionIDs(
  sessionID: string,
  sync: ReturnType<typeof useSync>,
  seen: ReadonlySet<string> = new Set(),
): string[] {
  if (seen.has(sessionID)) return []
  const nextSeen = new Set(seen).add(sessionID)
  return taskWaves(sessionID, sync).flatMap((wave) =>
    wave.tasks.flatMap((part) => {
      const child = taskSessionID(part)
      if (!child || nextSeen.has(child)) return []
      return [child, ...taskSessionIDs(child, sync, nextSeen)]
    }),
  )
}

function statusLabel(part: ToolPart) {
  if (part.state.status === "completed") return "done"
  if (part.state.status === "error") return "error"
  return part.state.status
}

function indent(depth: number) {
  return "  ".repeat(depth)
}

function childActivity(sessionID: string | undefined, sync: ReturnType<typeof useSync>) {
  if (!sessionID) return
  const tools = (sync.data.message[sessionID] ?? []).flatMap((message) =>
    (sync.data.part[message.id] ?? []).filter(isToolPart),
  )
  const current = tools.findLast(
    (part) => (part.state.status === "running" || part.state.status === "completed") && part.state.title,
  )
  const counts = {
    running: tools.filter((part) => part.state.status === "running").length,
    completed: tools.filter((part) => part.state.status === "completed").length,
    error: tools.filter((part) => part.state.status === "error").length,
  }
  const currentTitle =
    current && (current.state.status === "running" || current.state.status === "completed")
      ? `${Locale.titlecase(current.tool)} ${current.state.title}`
      : undefined

  return {
    status: sync.session.status(sessionID),
    tools: tools.length,
    counts,
    currentTitle,
  }
}

export function OrchestratorView(props: { sessionID: string }) {
  const sync = useSync()
  const route = useRoute()
  const renderer = useRenderer()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const rootSessionID = createMemo(() => sync.session.get(props.sessionID)?.parentID ?? props.sessionID)
  const rootSession = createMemo(() => sync.session.get(rootSessionID()))
  const waves = createMemo(() => taskWaves(rootSessionID(), sync))
  const tasks = createMemo(() => waves().flatMap((wave) => wave.tasks))
  const active = createMemo(() => tasks().filter((part) => part.state.status === "running").length)
  const completed = createMemo(() => tasks().filter((part) => part.state.status === "completed").length)
  const failed = createMemo(() => tasks().filter((part) => part.state.status === "error").length)
  const sessionIDs = createMemo(() => [rootSessionID(), ...new Set(taskSessionIDs(rootSessionID(), sync))])

  createEffect(() => {
    sessionIDs().forEach((sessionID) => {
      void sync.session.sync(sessionID).catch(toast.error)
    })
  })

  function back() {
    route.navigate({ type: "session", sessionID: rootSessionID() })
  }

  useKeyboard((evt) => {
    if (renderer.getSelection()?.getSelectedText()) return
    if (evt.name !== "escape" && evt.name !== "backspace") return
    evt.preventDefault()
    evt.stopPropagation()
    back()
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Orchestrator View
          </text>
          <text fg={theme.textMuted}>
            {rootSession()?.title ?? rootSessionID()} · {waves().length} waves · {tasks().length} tasks
            <Show when={active() > 0}> · {active()} active</Show>
            <Show when={completed() > 0}> · {completed()} done</Show>
            <Show when={failed() > 0}> · {failed()} failed</Show>
          </text>
        </box>
        <text fg={theme.textMuted} onMouseUp={back}>
          esc
        </text>
      </box>
      <scrollbox
        flexGrow={1}
        scrollAcceleration={scrollAcceleration()}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <Show
          when={waves().length > 0}
          fallback={
            <box
              border={["left"]}
              customBorderChars={SplitBorder.customBorderChars}
              borderColor={theme.backgroundPanel}
              backgroundColor={theme.backgroundPanel}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              marginTop={1}
            >
              <text fg={theme.text}>No delegated task flow in this session.</text>
              <text fg={theme.textMuted}>Parallel task waves appear here after the task tool starts subagents.</text>
            </box>
          }
        >
          <box gap={1}>
            <For each={waves()}>
              {(wave, waveIndex) => (
                <box
                  border={["left"]}
                  customBorderChars={SplitBorder.customBorderChars}
                  borderColor={wave.tasks.length > 1 ? theme.borderActive : theme.backgroundPanel}
                  backgroundColor={theme.backgroundPanel}
                  paddingTop={1}
                  paddingBottom={1}
                  paddingLeft={2}
                  marginTop={waveIndex() === 0 ? 0 : 1}
                >
                  <text fg={theme.text}>
                    <b>Wave {waveIndex() + 1}</b>{" "}
                    <span style={{ fg: theme.textMuted }}>
                      {wave.tasks.length} {wave.tasks.length === 1 ? "task" : "parallel tasks"} ·{" "}
                      {Locale.time(wave.message.time.created)}
                    </span>
                  </text>
                  <For each={wave.tasks}>
                    {(part, index) => (
                      <TaskNode part={part} depth={0} last={index() === wave.tasks.length - 1} path={[rootSessionID()]} />
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        </Show>
      </scrollbox>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.textMuted}>click a task to open its subagent</text>
        <text fg={theme.textMuted}>esc/backspace back to session</text>
      </box>
    </box>
  )
}

function TaskNode(props: { part: ToolPart; depth: number; last: boolean; path: string[] }) {
  const sync = useSync()
  const route = useRoute()
  const renderer = useRenderer()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const sessionID = createMemo(() => taskSessionID(props.part))
  const activity = createMemo(() => childActivity(sessionID(), sync))
  const nested = createMemo(() => {
    const child = sessionID()
    if (!child || props.path.includes(child)) return []
    return taskWaves(child, sync).flatMap((wave) => wave.tasks)
  })
  const color = createMemo(() => {
    if (props.part.state.status === "completed") return theme.success
    if (props.part.state.status === "error") return theme.error
    if (props.part.state.status === "running") return theme.warning
    return theme.textMuted
  })
  const duration = createMemo(() => taskDuration(props.part))

  function open() {
    if (renderer.getSelection()?.getSelectedText()) return
    const child = sessionID()
    if (child) route.navigate({ type: "session", sessionID: child })
  }

  return (
    <box marginTop={1} gap={1}>
      <box
        backgroundColor={hover() && sessionID() ? theme.backgroundElement : theme.backgroundPanel}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={open}
      >
        <text fg={theme.text}>
          <span style={{ fg: theme.textMuted }}>
            {indent(props.depth)}
            {props.last ? "└─" : "├─"}
          </span>{" "}
          <span style={{ fg: color() }}>●</span> <b>{taskAgent(props.part)}</b> {taskTitle(props.part)}
          <span style={{ fg: theme.textMuted }}>
            {" "}
            · {statusLabel(props.part)}
            <Show when={duration()}>{(value) => <> · {value()}</>}</Show>
          </span>
        </text>
      </box>
      <Show when={sessionID()}>
        {(child) => (
          <text fg={theme.textMuted}>
            {indent(props.depth + 1)}↳ session {child()}
            <Show when={activity()}>
              {(item) => (
                <>
                  {" "}
                  · {item().status}
                  <Show when={item().tools > 0}>
                    {" "}
                    · {item().tools} tools ({item().counts.running} running, {item().counts.completed} done
                    <Show when={item().counts.error > 0}>, {item().counts.error} failed</Show>)
                  </Show>
                  <Show when={item().currentTitle}> · {item().currentTitle}</Show>
                </>
              )}
            </Show>
          </text>
        )}
      </Show>
      <Show when={nested().length > 0}>
        <text fg={theme.textMuted}>
          {indent(props.depth + 1)}fan-out · {nested().length} {nested().length === 1 ? "task" : "parallel tasks"}
        </text>
        <For each={nested()}>
          {(part, index) => (
            <TaskNode
              part={part}
              depth={props.depth + 1}
              last={index() === nested().length - 1}
              path={[...props.path, sessionID()].filter((item): item is string => typeof item === "string")}
            />
          )}
        </For>
      </Show>
    </box>
  )
}
