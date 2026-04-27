import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type {
  AssistantMessage,
  Message as MessageType,
  Part,
  SnapshotFileDiff,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/shared/util/path"
import { useLanguage } from "@/context/language"
import { diffs as listDiffs } from "@/utils/diffs"

type ActivityKind = "model" | "tool" | "file"
type ActivityTab = "timeline" | "heatmap" | "stats"
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

type FileTouch = {
  file: string
  count: number
  additions: number
  deletions: number
  lastTime: number
}

type ActivitySummary = {
  events: ActivityEvent[]
  heatmap: FileTouch[]
  totals: {
    tools: number
    modelSwitches: number
    files: number
  }
}

const emptyParts: Part[] = []
const eventOrder: Record<ActivityKind, number> = {
  model: 0,
  tool: 1,
  file: 2,
}
const timelineBatchSize = 80
const activityTabs: ActivityTab[] = ["timeline", "heatmap", "stats"]

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
  return part.tool
}

const toolSubtitle = (part: ToolPart) => {
  const input = part.state.input
  const files = input.files
  if (Array.isArray(files) && files.length > 0) return files.filter((item) => typeof item === "string").join(", ")
  return textInputValue(input, ["filePath", "path", "description", "pattern", "query", "url", "command"])
}

const toolIcon = (tool: string): IconProps["name"] => {
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

  const heatmap = [
    ...users
      .flatMap((message) =>
        turnDiffs(message).map((diff) => ({
          ...diff,
          time: completedAt(assistantsByParent.get(message.id) ?? []) ?? message.time.created,
        })),
      )
      .reduce((map, diff) => {
        const current = map.get(diff.file)
        map.set(diff.file, {
          file: diff.file,
          count: (current?.count ?? 0) + 1,
          additions: (current?.additions ?? 0) + diff.additions,
          deletions: (current?.deletions ?? 0) + diff.deletions,
          lastTime: Math.max(current?.lastTime ?? 0, diff.time),
        })
        return map
      }, new Map<string, FileTouch>())
      .values(),
  ].sort(
    (a, b) =>
      b.count - a.count || b.additions + b.deletions - (a.additions + a.deletions) || a.file.localeCompare(b.file),
  )

  return {
    events: [...modelEvents, ...toolEvents, ...fileEvents].sort(
      (a, b) => a.time - b.time || a.order - b.order || a.id.localeCompare(b.id),
    ),
    heatmap,
    totals: {
      tools: toolEvents.length,
      modelSwitches: modelEvents.filter((event) => event.kind === "model" && !event.initial).length,
      files: heatmap.length,
    },
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
  const [tab, setTab] = createSignal<ActivityTab>("timeline")
  const [timelineLimit, setTimelineLimit] = createSignal(timelineBatchSize)
  const activity = createMemo(() => buildSessionActivity({ messages: props.messages, parts: props.parts }))
  const visibleEvents = createMemo(() => activity().events.slice(0, timelineLimit()))
  const hiddenEventCount = createMemo(() => Math.max(0, activity().events.length - visibleEvents().length))
  const maxTouches = createMemo(() => Math.max(1, ...activity().heatmap.map((item) => item.count)))
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
  const heatFillStyle = (count: number) => ({
    width: `${Math.round((count / maxTouches()) * 100)}%`,
  })
  const openFile = (path: string) => props.onViewFile?.(path)
  const showMoreEvents = () => setTimelineLimit((limit) => limit + timelineBatchSize)
  const tabLabel = (value: ActivityTab) => {
    if (value === "timeline") return language.t("session.activity.timeline.title")
    if (value === "heatmap") return language.t("session.activity.heatmap.title")
    return language.t("session.activity.stats.title")
  }
  let timelineRoot: string | undefined

  createEffect(() => {
    const next = activity().events[0]?.messageID
    if (next === timelineRoot) return
    timelineRoot = next
    setTimelineLimit(timelineBatchSize)
  })

  const Stat = (props: { label: string; value: number }) => (
    <div class="min-w-0 border-r border-border-weaker-base px-3 py-2.5 last:border-r-0">
      <div class="text-[15px] font-medium leading-5 tracking-normal text-text-strong tabular-nums">
        {formatNumber().format(props.value)}
      </div>
      <div class="pt-0.5 text-12-regular text-text-weak truncate">{props.label}</div>
    </div>
  )

  const EventIcon = (props: { event: ActivityEvent }) => (
    <div class="relative z-10 mt-3 flex size-7 shrink-0 items-center justify-center rounded-full border border-border-weaker-base bg-surface-raised-stronger-non-alpha text-icon-base shadow-[var(--shadow-xs)]">
      <Show
        when={props.event.kind === "tool"}
        fallback={<Icon name={props.event.kind === "model" ? "models" : "code-lines"} size="small" />}
      >
        <Icon name={toolIcon((props.event as Extract<ActivityEvent, { kind: "tool" }>).tool)} size="small" />
      </Show>
    </div>
  )

  const EventBody = (props: { event: ActivityEvent; last: boolean }) => (
    <div class="min-w-0 flex-1 border-b border-border-weaker-base py-2.5" classList={{ "border-b-0": props.last }}>
      <div class="rounded-md px-2.5 py-2 transition-colors group-hover:bg-surface-raised-base-hover">
        <SwitchEvent event={props.event} />
      </div>
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
            <Show when={props.event.from} fallback={<span>{props.event.to}</span>}>
              {(from) => (
                <span>
                  {from()} -&gt; {props.event.to}
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
          <Show when={props.event.subtitle}>
            {(subtitle) => <div class="pt-1 text-12-regular text-text-weak truncate">{subtitle()}</div>}
          </Show>
        </div>
        <div class="shrink-0 text-12-regular text-text-weak tabular-nums">
          {formatTime().format(new Date(props.event.time))}
        </div>
      </div>
      <div class="pt-2 flex items-center gap-2 text-12-regular">
        <span class="size-1.5 rounded-full" style={statusDotStyle(props.event.status)} />
        <span class={statusClass(props.event.status)}>{language.t(toolStatusKey(props.event.status))}</span>
        <Show when={duration(props.event.duration)}>
          {(value) => <span class="text-text-weak tabular-nums">{value()}</span>}
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
      <div class={`${sectionClass()} sticky top-0 z-20 bg-background-stronger pt-3 pb-2`}>
        <div class="flex rounded-lg border border-border-weaker-base bg-background-base p-1 shadow-[var(--shadow-xs)]">
          <For each={activityTabs}>
            {(value) => (
              <button
                type="button"
                role="tab"
                class={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-12-medium transition-colors hover:bg-surface-raised-base-hover hover:text-text-base focus:outline-none focus-visible:shadow-[var(--shadow-xs-border-focus)] ${
                  tab() === value ? "bg-surface-base-active text-text-strong" : "text-text-weak"
                }`}
                aria-selected={tab() === value}
                onClick={() => setTab(value)}
              >
                <span class="block truncate">{tabLabel(value)}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={tab() === "stats"}>
        <section class={`${sectionClass()} pt-4`}>
          <div class="grid grid-cols-3 overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
            <Stat label={language.t("session.activity.stat.tools")} value={activity().totals.tools} />
            <Stat label={language.t("session.activity.stat.models")} value={activity().totals.modelSwitches} />
            <Stat label={language.t("session.activity.stat.files")} value={activity().totals.files} />
          </div>
        </section>
      </Show>

      <Show when={tab() === "heatmap"}>
        <section class={`${sectionClass()} pt-4`}>
          <Show
            when={activity().heatmap.length > 0}
            fallback={
              <div class="rounded-lg border border-border-weaker-base bg-background-base px-3 py-5 text-center text-12-regular text-text-weak">
                {language.t("session.activity.heatmap.empty")}
              </div>
            }
          >
            <div class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
              <For each={activity().heatmap.slice(0, 12)}>
                {(item) => (
                  <button
                    type="button"
                    class="group w-full min-w-0 border-b border-border-weaker-base px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-raised-base-hover focus:outline-none focus-visible:shadow-[var(--shadow-xs-border-focus)]"
                    onClick={() => openFile(item.file)}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0 flex items-center gap-2">
                        <FileIcon node={{ path: item.file, type: "file" }} class="size-4 shrink-0" />
                        <div class="min-w-0">
                          <div class="truncate text-12-medium text-text-strong">{getFilename(item.file)}</div>
                          <Show when={item.file.includes("/")}>
                            <div class="truncate text-12-regular text-text-weak">{getDirectory(item.file)}</div>
                          </Show>
                        </div>
                      </div>
                      <div class="shrink-0 text-right">
                        <div class="text-12-medium text-text-strong tabular-nums">
                          {formatNumber().format(item.count)}
                        </div>
                        <div class="text-12-regular text-text-weak tabular-nums">
                          +{formatNumber().format(item.additions)} -{formatNumber().format(item.deletions)}
                        </div>
                      </div>
                    </div>
                    <div class="mt-2 h-1 overflow-hidden rounded-full bg-surface-base">
                      <div
                        class="h-full rounded-full bg-[color-mix(in_srgb,var(--text-interactive-base)_48%,transparent)]"
                        style={heatFillStyle(item.count)}
                      />
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>
      </Show>

      <Show when={tab() === "timeline"}>
        <section class={`${sectionClass()} pt-2`}>
          <Show
            when={activity().events.length > 0}
            fallback={
              <div class="py-4 text-12-regular text-text-weak">{language.t("session.activity.timeline.empty")}</div>
            }
          >
            <div class="relative">
              <div class="absolute left-3.5 top-5 bottom-5 w-px bg-border-weaker-base" aria-hidden="true" />
              <div class="flex flex-col">
                <For each={visibleEvents()}>
                  {(event, index) => (
                    <div class="group relative flex gap-3">
                      <EventIcon event={event} />
                      <EventBody
                        event={event}
                        last={index() === visibleEvents().length - 1 && hiddenEventCount() === 0}
                      />
                    </div>
                  )}
                </For>
              </div>
              <Show when={hiddenEventCount() > 0}>
                <div class="pl-10 pt-3">
                  <button
                    type="button"
                    class="rounded-md border border-border-weaker-base bg-background-base px-3 py-1.5 text-12-medium text-text-base shadow-[var(--shadow-xs)] transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong focus:outline-none focus-visible:shadow-[var(--shadow-xs-border-focus)]"
                    onClick={showMoreEvents}
                  >
                    {language.t("common.loadMore")}
                    {language.t("common.moreCountSuffix", { count: hiddenEventCount() })}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </section>
      </Show>
    </div>
  )
}
