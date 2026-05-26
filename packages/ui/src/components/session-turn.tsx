import {
  AssistantMessage,
  type SnapshotFileDiff,
  Message as MessageType,
  Part as PartType,
} from "@codeplane-ai/sdk/v2/client"
import type { SessionStatus } from "@codeplane-ai/sdk/v2"
import { useData } from "../context"
import { useFileComponent } from "../context/file"

import { Binary } from "@codeplane-ai/shared/util/binary"
import { getDirectory, getFilename } from "@codeplane-ai/shared/util/path"
import { createEffect, createMemo, createSignal, For, onCleanup, ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import {
  AssistantParts,
  Message,
  MessageDivider,
  PART_MAPPING,
  type ReasoningDisplay,
  type UserActions,
} from "./message-part"
import { Card } from "./card"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { DiffChanges } from "./diff-changes"
import { Icon } from "./icon"
import { TextShimmer } from "./text-shimmer"
import { LogoLoader } from "./logo-loader"
import { SessionRetry } from "./session-retry"
import { TextReveal } from "./text-reveal"
import { createAutoScroll } from "../hooks"
import { useI18n } from "../context/i18n"
import { normalize } from "./session-diff"
import { messageDiffs } from "./session-turn-diffs"
import { isSessionTurnWorking } from "./session-turn-working"

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrap(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()

  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }

  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  let json = read(text)

  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1))
    }
  }

  if (!record(json)) return message

  const err = record(json.error) ? json.error : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }

  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg

  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason

  return message
}

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

const hidden = new Set(["todowrite"])

function partState(part: PartType, reasoningDisplay: ReasoningDisplay) {
  if (part.type === "tool") {
    if (hidden.has(part.tool)) return
    if (part.tool === "question" && (part.state.status === "pending" || part.state.status === "running")) return
    return "visible" as const
  }
  if (part.type === "text") return part.text?.trim() ? ("visible" as const) : undefined
  if (part.type === "reasoning") {
    if (reasoningDisplay !== "off" && part.text?.trim()) return "visible" as const
    return
  }
  if (PART_MAPPING[part.type]) return "visible" as const
  return
}

function clean(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

function heading(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n")

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = clean(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = clean(atx[1])
    if (value) return value
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = clean(setext[1])
    if (value) return value
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = clean(strong[1])
    if (value) return value
  }
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    messages?: MessageType[]
    actions?: UserActions
    showReasoningSummaries?: boolean
    reasoningDisplay?: ReasoningDisplay
    onReasoningDisplayChange?: (value: ReasoningDisplay) => void
    shellToolDefaultOpen?: boolean
    editToolDefaultOpen?: boolean
    active?: boolean
    status?: SessionStatus
    onUserInteracted?: () => void
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()
  const i18n = useI18n()
  const fileComponent = useFileComponent()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyDiffs: SnapshotFileDiff[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => props.messages ?? list(data.store.message?.[props.sessionID], emptyMessages))

  const messageIndex = createMemo(() => {
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, props.messageID, (m) => m.id)

    const index = result.found ? result.index : messages.findIndex((m) => m.id === props.messageID)
    if (index < 0) return -1

    const msg = messages[index]
    if (!msg || msg.role !== "user") return -1

    return index
  })

  const message = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return undefined

    const messages = allMessages() ?? emptyMessages
    const msg = messages[index]
    if (!msg || msg.role !== "user") return undefined

    return msg
  })

  const pending = createMemo(() => {
    if (typeof props.active === "boolean") return
    const messages = allMessages() ?? emptyMessages
    return messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  })

  const pendingUser = createMemo(() => {
    const item = pending()
    if (!item?.parentID) return
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, item.parentID, (m) => m.id)
    const msg = result.found ? messages[result.index] : messages.find((m) => m.id === item.parentID)
    if (!msg || msg.role !== "user") return
    return msg
  })

  const active = createMemo(() => {
    if (typeof props.active === "boolean") return props.active
    const msg = message()
    const parent = pendingUser()
    if (!msg || !parent) return false
    return parent.id === msg.id
  })

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return list(data.store.part?.[msg.id], emptyParts)
  })

  const compaction = createMemo(() => parts().find((part) => part.type === "compaction"))

  const assistantMessages = createMemo(
    () => {
      const msg = message()
      if (!msg) return emptyAssistant

      const messages = allMessages() ?? emptyMessages
      if (messageIndex() < 0) return emptyAssistant

      const result: AssistantMessage[] = []
      for (let i = 0; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        if (item.role === "assistant" && item.parentID === msg.id) result.push(item as AssistantMessage)
      }
      return result
    },
    emptyAssistant,
    { equals: same },
  )

  const diffs = createMemo(() => {
    const msg = message()
    if (!msg?.summary?.diffs?.length) return emptyDiffs
    return messageDiffs({
      diffs: msg.summary.diffs,
      assistants: assistantMessages(),
      partsByMessageID: data.store.part,
    })
  })
  const MAX_FILES = 10
  const edited = createMemo(() => diffs().length)
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, edited() - MAX_FILES))
  const visible = createMemo(() => (showAll() ? diffs() : diffs().slice(0, MAX_FILES)))
  const toggleAll = () => {
    autoScroll.pause()
    setState("showAll", !showAll())
  }

  const interrupted = createMemo(() => assistantMessages().some((m) => m.error?.name === "MessageAbortedError"))
  const divider = createMemo(() => {
    if (compaction()) return i18n.t("ui.messagePart.compaction")
    if (interrupted()) return i18n.t("ui.message.interrupted")
    return ""
  })
  const error = createMemo(
    () => assistantMessages().find((m) => m.error && m.error.name !== "MessageAbortedError")?.error,
  )
  const showAssistantCopyPartID = createMemo(() => {
    const messages = assistantMessages()

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = list(data.store.part?.[message.id], emptyParts)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }

    return undefined
  })
  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    // oxlint-disable-next-line no-base-to-string -- msg is unknown from error data, coercion is intentional
    return unwrap(String(msg))
  })

  const status = createMemo(() => {
    if (props.status !== undefined) return props.status
    if (typeof props.active === "boolean" && !props.active) return idle
    return data.store.session_status[props.sessionID] ?? idle
  })
  const working = createMemo(() =>
    isSessionTurnWorking({
      active: active(),
      status: status(),
      assistantMessages: assistantMessages(),
    }),
  )
  const reasoningDisplay = createMemo<ReasoningDisplay>(
    () => props.reasoningDisplay ?? (props.showReasoningSummaries === false ? "off" : "full"),
  )
  const showReasoningSummaries = createMemo(() => reasoningDisplay() !== "off")

  const assistantCopyPartID = createMemo(() => {
    if (working()) return null
    return showAssistantCopyPartID() ?? null
  })
  const turnDurationMs = createMemo(() => {
    const start = message()?.time.created
    if (typeof start !== "number") return undefined

    const end = assistantMessages().reduce<number | undefined>((max, item) => {
      const completed = item.time.completed
      if (typeof completed !== "number") return max
      if (max === undefined) return completed
      return Math.max(max, completed)
    }, undefined)

    if (typeof end !== "number") return undefined
    if (end < start) return undefined
    return end - start
  })
  const turnOutputTokens = createMemo(() => assistantMessages().reduce((sum, item) => sum + item.tokens.output, 0))
  const assistantDerived = createMemo(() => {
    let visible = 0
    let reason: string | undefined
    const display = reasoningDisplay()
    for (const message of assistantMessages()) {
      for (const part of list(data.store.part?.[message.id], emptyParts)) {
        if (partState(part, display) === "visible") {
          visible++
        }
        if (part.type === "reasoning" && part.text) {
          const h = heading(part.text)
          if (h) reason = h
        }
      }
    }
    return { visible, reason }
  })
  const assistantVisible = createMemo(() => assistantDerived().visible)
  const reasoningHeading = createMemo(() => assistantDerived().reason)
  const showThinking = createMemo(() => {
    if (!working() || !!error()) return false
    if (status().type === "retry") return false
    if (showReasoningSummaries()) return assistantVisible() === 0
    return true
  })

  const toolDisplayName = (toolName: string) => {
    const key = `ui.tool.${toolName}`
    const translated = i18n.t(key as Parameters<typeof i18n.t>[0])
    if (translated && translated !== key) return translated
    return toolName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }

  const turnTrace = createMemo<{
    running: string[]
    completedCount: number
    lastCompleted?: string
  }>(
    () => {
      const messages = assistantMessages()
      const running: string[] = []
      let completedCount = 0
      let lastCompleted: string | undefined
      let lastEnd = -Infinity

      for (const message of messages) {
        const list = data.store.part?.[message.id]
        if (!list) continue
        for (const part of list) {
          if (part.type !== "tool") continue
          if (hidden.has(part.tool)) continue
          if (part.tool === "todowrite" || part.tool === "todoread") continue
          const state = part.state as { status?: string; time?: { start?: number; end?: number } }
          if (state.status === "running" || state.status === "pending") {
            running.push(part.tool)
            continue
          }
          if (state.status === "completed" || state.status === "error") {
            completedCount++
            const end = state.time?.end ?? 0
            if (end >= lastEnd) {
              lastEnd = end
              lastCompleted = part.tool
            }
          }
        }
      }

      return { running, completedCount, lastCompleted }
    },
    { running: [], completedCount: 0, lastCompleted: undefined },
    {
      equals: (a, b) =>
        a.completedCount === b.completedCount &&
        a.lastCompleted === b.lastCompleted &&
        a.running.length === b.running.length &&
        a.running.every((tool, i) => tool === b.running[i]),
    },
  )

  const currentActivity = createMemo<{ kind: "running" | "recent"; label: string } | undefined>(() => {
    if (!showThinking()) return undefined
    const trace = turnTrace()
    const last = trace.running.at(-1)
    if (last) return { kind: "running", label: toolDisplayName(last) }
    if (trace.lastCompleted) return { kind: "recent", label: toolDisplayName(trace.lastCompleted) }
    return undefined
  })

  const stepCount = createMemo(() => turnTrace().completedCount + turnTrace().running.length)

  const thinkingStart = createMemo<number | undefined>(() => {
    if (!showThinking()) return undefined
    const last = assistantMessages().at(-1)?.time.created
    if (typeof last === "number") return last
    const created = message()?.time.created
    if (typeof created === "number") return created
    return Date.now()
  })

  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!showThinking()) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(id))
  })

  const thinkingElapsedSec = createMemo(() => {
    const start = thinkingStart()
    if (start === undefined) return 0
    return Math.max(0, Math.floor((now() - start) / 1000))
  })

  const formatElapsed = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }

  const thinkingElapsedLabel = createMemo(() => {
    const seconds = thinkingElapsedSec()
    if (seconds < 5) return ""
    return formatElapsed(seconds)
  })

  const thinkingIsLong = createMemo(() => thinkingElapsedSec() >= 30)

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "dynamic",
  })

  return (
    <div data-component="session-turn" data-active={active() ? "true" : undefined} class={props.classes?.root}>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        data-slot="session-turn-content"
        class={props.classes?.content}
      >
        <div onClick={autoScroll.handleInteraction}>
          <Show when={message()}>
            <div
              ref={autoScroll.contentRef}
              data-message={message()!.id}
              data-slot="session-turn-message-container"
              class={props.classes?.container}
            >
              <div data-slot="session-turn-message-content" aria-live="off">
                <Message
                  message={message()!}
                  parts={parts()}
                  actions={props.actions}
                  reasoningDisplay={reasoningDisplay()}
                  onReasoningDisplayChange={props.onReasoningDisplayChange}
                />
              </div>
              <Show when={divider()}>
                <div data-slot="session-turn-compaction">
                  <MessageDivider label={divider()} />
                </div>
              </Show>
              <Show when={assistantMessages().length > 0}>
                <div data-slot="session-turn-assistant-content" aria-hidden={working()}>
                  <AssistantParts
                    messages={assistantMessages()}
                    showAssistantCopyPartID={assistantCopyPartID()}
                    turnDurationMs={turnDurationMs()}
                    turnOutputTokens={turnOutputTokens()}
                    working={working()}
                    showReasoningSummaries={showReasoningSummaries()}
                    reasoningDisplay={reasoningDisplay()}
                    onReasoningDisplayChange={props.onReasoningDisplayChange}
                    shellToolDefaultOpen={props.shellToolDefaultOpen}
                    editToolDefaultOpen={props.editToolDefaultOpen}
                  />
                </div>
              </Show>
              <Show when={showThinking()}>
                <div data-slot="session-turn-thinking" data-long={thinkingIsLong() || undefined}>
                  <LogoLoader />
                  <Show when={currentActivity()} keyed fallback={<TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />}>
                    {(activity) => (
                      <span data-slot="session-turn-thinking-headline" data-kind={activity.kind}>
                        <Show
                          when={activity.kind === "running"}
                          fallback={<TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />}
                        >
                          <TextShimmer text={activity.label} />
                        </Show>
                      </span>
                    )}
                  </Show>
                  <Show when={thinkingElapsedLabel()}>
                    <span data-slot="session-turn-thinking-meta" aria-live="polite">
                      <span data-slot="session-turn-thinking-elapsed">{thinkingElapsedLabel()}</span>
                    </span>
                  </Show>
                  <Show when={!showReasoningSummaries() && !currentActivity()}>
                    <TextReveal
                      text={reasoningHeading()}
                      class="session-turn-thinking-heading"
                      travel={25}
                      duration={700}
                    />
                  </Show>
                </div>
              </Show>
              <SessionRetry status={status()} show={active()} />
              <Show when={edited() > 0 && !working()}>
                <div
                  data-slot="session-turn-diffs"
                  data-component="session-turn-diffs-group"
                  data-show-all={showAll() || undefined}
                >
                  <div data-slot="session-turn-diffs-header">
                    <span data-slot="session-turn-diffs-label">
                      {edited()} {i18n.t("ui.sessionTurn.diffs.changed")}{" "}
                      {i18n.t(edited() === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                    </span>
                    <DiffChanges changes={diffs()} />
                    <Show when={overflow() > 0}>
                      <span data-slot="session-turn-diffs-toggle" onClick={toggleAll}>
                        {showAll() ? i18n.t("ui.sessionTurn.diffs.showLess") : i18n.t("ui.sessionTurn.diffs.showAll")}
                      </span>
                    </Show>
                  </div>
                  <div data-component="session-turn-diffs-content">
                    <Accordion
                      multiple
                      style={{ "--sticky-accordion-offset": "44px" }}
                      value={expanded()}
                      onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
                    >
                      <For each={visible()}>
                        {(diff) => {
                          const view = normalize(diff)
                          const active = createMemo(() => expanded().includes(diff.file))
                          const [shown, setShown] = createSignal(false)

                          createEffect(() => {
                            if (!active()) {
                              setShown(false)
                              return
                            }

                            requestAnimationFrame(() => {
                              if (!active()) return
                              setShown(true)
                            })
                          })

                          return (
                            <Accordion.Item value={diff.file}>
                              <StickyAccordionHeader>
                                <Accordion.Trigger>
                                  <div data-slot="session-turn-diff-trigger">
                                    <span data-slot="session-turn-diff-path">
                                      <Show when={diff.file.includes("/")}>
                                        <span data-slot="session-turn-diff-directory">
                                          {`\u202A${getDirectory(diff.file)}\u202C`}
                                        </span>
                                      </Show>
                                      <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                                    </span>
                                    <div data-slot="session-turn-diff-meta">
                                      <span data-slot="session-turn-diff-changes">
                                        <DiffChanges changes={diff} />
                                      </span>
                                      <span data-slot="session-turn-diff-chevron">
                                        <Icon name="chevron-down" size="small" />
                                      </span>
                                    </div>
                                  </div>
                                </Accordion.Trigger>
                              </StickyAccordionHeader>
                              <Accordion.Content>
                                <Show when={shown()}>
                                  <div data-slot="session-turn-diff-view" data-scrollable>
                                    <Dynamic component={fileComponent} mode="diff" fileDiff={view.fileDiff} />
                                  </div>
                                </Show>
                              </Accordion.Content>
                            </Accordion.Item>
                          )
                        }}
                      </For>
                    </Accordion>
                    <Show when={!showAll() && overflow() > 0}>
                      <div data-slot="session-turn-diffs-more" onClick={toggleAll}>
                        {i18n.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
              <Show when={error()}>
                <Card variant="error" class="error-card">
                  {errorText()}
                </Card>
              </Show>
            </div>
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
