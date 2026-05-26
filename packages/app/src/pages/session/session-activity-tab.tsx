import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type {
  AssistantMessage,
  Message as MessageType,
  Part,
  SnapshotFileDiff,
  ToolPart,
  UserMessage,
} from "@codeplane-ai/sdk/v2"
import { Button } from "@codeplane-ai/ui/button"
import { FileIcon } from "@codeplane-ai/ui/file-icon"
import { Icon, type IconProps } from "@codeplane-ai/ui/icon"
import { describeGenericToolDisplay } from "@codeplane-ai/shared/tool-display"
import { getDirectory, getFilename } from "@codeplane-ai/shared/util/path"
import { useLanguage } from "@/context/language"
import { diffs as listDiffs } from "@/utils/diffs"

type ActivityKind = "model" | "tool" | "file"
type ToolStatus = ToolPart["state"]["status"]
type FileStatus = NonNullable<SnapshotFileDiff["status"]>

type ActivityEvent =
  | {
      id: string
      kind: "model"
      time: number
      order: number
      messageID: string
      agent: string
      from?: string
      to: string
      initial: boolean
    }
  | {
      id: string
      kind: "tool"
      time: number
      order: number
      messageID: string
      tool: string
      title: string
      subtitle?: string
      metadata?: Record<string, unknown>
      status: ToolStatus
      duration?: number
    }
  | {
      id: string
      kind: "file"
      time: number
      order: number
      messageID: string
      file: string
      status: FileStatus
      additions: number
      deletions: number
    }

type ActivitySummary = {
  events: ActivityEvent[]
}

const emptyParts: Part[] = []
const eventOrder: Record<ActivityKind, number> = {
  model: 0,
  tool: 1,
  file: 2,
}
const timelineBatchSize = 80

const isUserMessage = (message: MessageType): message is UserMessage => message.role === "user"
const isAssistantMessage = (message: MessageType): message is AssistantMessage => message.role === "assistant"
const isToolPart = (part: Part): part is ToolPart => part.type === "tool"
const partTime = (part: ToolPart, fallback: number) => ("time" in part.state ? part.state.time.start : fallback)
const partDuration = (part: ToolPart) =>
  "time" in part.state && "end" in part.state.time
    ? Math.max(0, part.state.time.end - part.state.time.start)
    : undefined

const modelLabel = (model: UserMessage["model"]) =>
  `${model.providerID}/${model.modelID}${model.variant ? ` (${model.variant})` : ""}`

const completedAt = (messages: AssistantMessage[]) => {
  const times = messages
    .map((message) => message.time.completed)
    .filter((time): time is number => typeof time === "number")
  return times.length ? Math.max(...times) : undefined
}

const turnDiffs = (message: UserMessage) => {
  const seen = new Set<string>()
  return listDiffs(message.summary?.diffs).filter((diff): diff is SnapshotFileDiff => {
    if (seen.has(diff.file)) return false
    seen.add(diff.file)
    return true
  })
}

const textInputValue = (input: Record<string, unknown>, keys: string[]) =>
  keys.map((key) => input[key]).find((value): value is string => typeof value === "string" && value.trim().length > 0)

const toolTitle = (part: ToolPart) => {
  const title = "title" in part.state && typeof part.state.title === "string" ? part.state.title : undefined
  if (title) return title
  return describeGenericToolDisplay({
    tool: part.tool,
    args: part.state.input,
    metadata: "metadata" in part.state ? part.state.metadata : undefined,
  }).title
}

const toolSubtitle = (part: ToolPart) => {
  const display = describeGenericToolDisplay({
    tool: part.tool,
    args: part.state.input,
    metadata: "metadata" in part.state ? part.state.metadata : undefined,
  })
  if (display.subtitle) return display.subtitle
  const input = part.state.input
  const files = input.files
  if (Array.isArray(files) && files.length > 0) return files.filter((item) => typeof item === "string").join(", ")
  return textInputValue(input, ["filePath", "path", "description", "pattern", "query", "url", "command"])
}

const toolIcon = (tool: string, metadata?: Record<string, unknown>): IconProps["name"] => {
  if (metadata?.mcp === true) return "server"
  if (tool === "bash") return "console"
  if (tool === "edit" || tool === "write" || tool === "apply_patch") return "code-lines"
  if (tool === "read") return "glasses"
  if (tool === "task") return "task"
  if (tool === "grep" || tool === "glob" || tool === "list") return "magnifying-glass-menu"
  return "mcp"
}

const statusClass = (status: ToolStatus) => {
  if (status === "completed") return "text-syntax-success"
  if (status === "error") return "text-syntax-critical"
  if (status === "running") return "text-syntax-info"
  return "text-text-weak"
}

const statusDotStyle = (status: ToolStatus) => {
  if (status === "completed") return { background: "var(--syntax-success)" }
  if (status === "error") return { background: "var(--syntax-critical)" }
  if (status === "running") return { background: "var(--syntax-info)" }
  return { background: "var(--text-weak)" }
}

const toolStatusKey = (status: ToolStatus) => {
  if (status === "completed") return "session.activity.tool.completed"
  if (status === "error") return "session.activity.tool.error"
  if (status === "running") return "session.activity.tool.running"
  return "session.activity.tool.pending"
}

const fileStatusKey = (status: FileStatus) => {
  if (status === "added") return "session.activity.file.added"
  if (status === "deleted") return "session.activity.file.deleted"
  return "session.activity.file.modified"
}

export function buildSessionActivity(input: {
  messages: MessageType[]
  parts: Record<string, Part[] | undefined>
}): ActivitySummary {
  const users = input.messages.filter(isUserMessage)
  const assistantsByParent = input.messages.filter(isAssistantMessage).reduce((map, message) => {
    map.set(message.parentID, [...(map.get(message.parentID) ?? []), message])
    return map
  }, new Map<string, AssistantMessage[]>())

  const modelEvents = users.flatMap((message, index, all): ActivityEvent[] => {
    const to = modelLabel(message.model)
    const prev = all[index - 1]
    if (!prev) {
      return [
        {
          id: `model:${message.id}`,
          kind: "model",
          time: message.time.created,
          order: eventOrder.model,
          messageID: message.id,
          agent: message.agent,
          to,
          initial: true,
        },
      ]
    }

    const from = modelLabel(prev.model)
    if (from === to) return []
    return [
      {
        id: `model:${message.id}`,
        kind: "model",
        time: message.time.created,
        order: eventOrder.model,
        messageID: message.id,
        agent: message.agent,
        from,
        to,
        initial: false,
      },
    ]
  })

  const toolEvents = users.flatMap((message) =>
    (assistantsByParent.get(message.id) ?? []).flatMap((assistant) =>
      (input.parts[assistant.id] ?? emptyParts).filter(isToolPart).map(
        (part): ActivityEvent => ({
          id: `tool:${part.id}`,
          kind: "tool",
          time: partTime(part, assistant.time.created),
          order: eventOrder.tool,
          messageID: message.id,
          tool: part.tool,
          title: toolTitle(part),
          subtitle: toolSubtitle(part),
          metadata: "metadata" in part.state ? part.state.metadata : undefined,
          status: part.state.status,
          duration: partDuration(part),
        }),
      ),
    ),
  )

  const fileEvents = users.flatMap((message) =>
    turnDiffs(message).map((diff): ActivityEvent => {
      const assistants = assistantsByParent.get(message.id) ?? []
      return {
        id: `file:${message.id}:${diff.file}`,
        kind: "file",
        time: completedAt(assistants) ?? message.time.created,
        order: eventOrder.file,
        messageID: message.id,
        file: diff.file,
        status: diff.status ?? "modified",
        additions: diff.additions,
        deletions: diff.deletions,
      }
    }),
  )

  return {
    events: [...modelEvents, ...toolEvents, ...fileEvents].sort(
      (a, b) => a.time - b.time || a.order - b.order || a.id.localeCompare(b.id),
    ),
  }
}

export function SessionActivityTab(props: {
  messages: MessageType[]
  parts: Record<string, Part[] | undefined>
  onViewFile?: (file: string) => void
  classes?: {
    root?: string
    section?: string
  }
}) {
  const language = useLanguage()
  const [timelineLimit, setTimelineLimit] = createSignal(timelineBatchSize)
  const activity = createMemo(
    () => buildSessionActivity({ messages: props.messages, parts: props.parts }),
    { events: [] as ActivityEvent[] },
    {
      equals: (prev, next) => {
        if (prev.events.length !== next.events.length) return false
        return prev.events.every((e, i) => {
          const n = next.events[i]
          if (e.id !== n.id) return false
          if (e.kind === "tool" && n.kind === "tool") return e.status === n.status && e.duration === n.duration
          return true
        })
      },
    },
  )
  const visibleEvents = createMemo(() => activity().events.slice(0, timelineLimit()))
  const hiddenEventCount = createMemo(() => Math.max(0, activity().events.length - visibleEvents().length))
  const formatTime = createMemo(
    () => new Intl.DateTimeFormat(language.intl(), { dateStyle: "short", timeStyle: "short" }),
  )
  const formatNumber = createMemo(() => new Intl.NumberFormat(language.intl()))
  const duration = (ms: number | undefined) => {
    if (ms === undefined) return
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  }
  const changes = (event: Extract<ActivityEvent, { kind: "file" }>) =>
    `+${formatNumber().format(event.additions)} -${formatNumber().format(event.deletions)}`
  const openFile = (path: string) => props.onViewFile?.(path)
  const showMoreEvents = () => setTimelineLimit((limit) => limit + timelineBatchSize)
  let timelineRoot: string | undefined

  createEffect(() => {
    const next = activity().events[0]?.messageID
    if (next === timelineRoot) return
    timelineRoot = next
    setTimelineLimit(timelineBatchSize)
  })

  const EventIcon = (props: { event: ActivityEvent }) => (
    <div class="mt-0.5 shrink-0 text-icon-weak-base">
      <Show
        when={props.event.kind === "tool"}
        fallback={<Icon name={props.event.kind === "model" ? "models" : "code-lines"} size="small" />}
      >
        <Icon
          name={toolIcon(
            (props.event as Extract<ActivityEvent, { kind: "tool" }>).tool,
            (props.event as Extract<ActivityEvent, { kind: "tool" }>).metadata,
          )}
          size="small"
        />
      </Show>
    </div>
  )

  const SwitchEvent = (props: { event: ActivityEvent }) => (
    <Show
      when={props.event.kind === "model"}
      fallback={
        <Show
          when={props.event.kind === "tool"}
          fallback={<FileEvent event={props.event as Extract<ActivityEvent, { kind: "file" }>} />}
        >
          <ToolEvent event={props.event as Extract<ActivityEvent, { kind: "tool" }>} />
        </Show>
      }
    >
      <ModelEvent event={props.event as Extract<ActivityEvent, { kind: "model" }>} />
    </Show>
  )

  const ModelEvent = (props: { event: Extract<ActivityEvent, { kind: "model" }> }) => (
    <>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-14-medium text-text-strong">
            {props.event.initial
              ? language.t("session.activity.model.initial")
              : language.t("session.activity.model.switch")}
          </div>
          <div class="pt-1 text-12-regular text-text-base break-all">
            <Show when={props.event.from} keyed fallback={<span>{props.event.to}</span>}>
              {(from) => (
                <span>
                  {from} -&gt; {props.event.to}
                </span>
              )}
            </Show>
          </div>
        </div>
        <div class="shrink-0 text-12-regular text-text-weak tabular-nums">
          {formatTime().format(new Date(props.event.time))}
        </div>
      </div>
      <div class="pt-1 text-12-regular text-text-weak truncate">{props.event.agent}</div>
    </>
  )

  const ToolEvent = (props: { event: Extract<ActivityEvent, { kind: "tool" }> }) => (
    <>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="truncate text-14-medium text-text-strong">{props.event.title}</span>
            <span class="shrink-0 rounded bg-surface-base px-1.5 py-0.5 text-12-mono text-text-weak">
              {props.event.tool}
            </span>
          </div>
          <Show when={props.event.subtitle} keyed>
            {(subtitle) => <div class="pt-1 text-12-regular text-text-weak truncate">{subtitle}</div>}
          </Show>
        </div>
        <div class="shrink-0 text-12-regular text-text-weak tabular-nums">
          {formatTime().format(new Date(props.event.time))}
        </div>
      </div>
      <div class="pt-2 flex items-center gap-2 text-12-regular">
        <span class="size-1.5 rounded-full" style={statusDotStyle(props.event.status)} />
        <span class={statusClass(props.event.status)}>{language.t(toolStatusKey(props.event.status))}</span>
        <Show when={duration(props.event.duration)} keyed>
          {(value) => <span class="text-text-weak tabular-nums">{value}</span>}
        </Show>
      </div>
    </>
  )

  const FileEvent = (props: { event: Extract<ActivityEvent, { kind: "file" }> }) => (
    <>
      <div class="flex items-start justify-between gap-3">
        <button
          type="button"
          class="min-w-0 flex items-center gap-2 text-left"
          onClick={() => openFile(props.event.file)}
        >
          <FileIcon node={{ path: props.event.file, type: "file" }} class="size-4 shrink-0" />
          <span class="min-w-0">
            <span class="block truncate text-14-medium text-text-strong">{getFilename(props.event.file)}</span>
            <Show when={props.event.file.includes("/")}>
              <span class="block truncate text-12-regular text-text-weak">{getDirectory(props.event.file)}</span>
            </Show>
          </span>
        </button>
        <div class="shrink-0 text-12-regular text-text-weak tabular-nums">
          {formatTime().format(new Date(props.event.time))}
        </div>
      </div>
      <div class="pt-2 flex items-center gap-2 text-12-regular text-text-weak">
        <span>{language.t(fileStatusKey(props.event.status))}</span>
        <span class="tabular-nums">{changes(props.event)}</span>
      </div>
    </>
  )

  const sectionClass = () => props.classes?.section ?? "px-3"

  return (
    <div class={props.classes?.root ?? "h-full overflow-y-auto pb-8"} data-scrollable>
      <section class={`${sectionClass()} pt-2`}>
        <Show
          when={activity().events.length > 0}
          fallback={
            <div class="py-4 text-12-regular text-text-weak">{language.t("session.activity.timeline.empty")}</div>
          }
        >
          <div class="flex flex-col">
            <For each={visibleEvents()}>
              {(event, index) => (
                <div
                  class="flex items-start gap-3 py-3 border-b border-border-weaker-base"
                  classList={{
                    "border-b-0": index() === visibleEvents().length - 1 && hiddenEventCount() === 0,
                  }}
                >
                  <EventIcon event={event} />
                  <div class="min-w-0 flex-1">
                    <SwitchEvent event={event} />
                  </div>
                </div>
              )}
            </For>
            <Show when={hiddenEventCount() > 0}>
              <div class="pt-2">
                <Button
                  variant="ghost"
                  size="large"
                  class="w-full justify-center text-12-medium text-text-weak"
                  onClick={showMoreEvents}
                >
                  {language.t("common.loadMore")}
                  {language.t("common.moreCountSuffix", { count: hiddenEventCount() })}
                </Button>
              </div>
            </Show>
          </div>
        </Show>
      </section>
    </div>
  )
}
