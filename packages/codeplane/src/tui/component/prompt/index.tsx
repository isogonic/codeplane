import {
  BoxRenderable,
  RGBA,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  TextAttributes,
} from "@opentui/core"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match, For } from "solid-js"
import "opentui-spinner/solid"
import path from "path"
import { fileURLToPath } from "url"
import { Filesystem } from "@/tui/_compat/filesystem"
import { useLocal } from "@/tui/context/local"
import { tint, useTheme } from "@/tui/context/theme"
import { EmptyBorder, SplitBorder } from "@/tui/component/border"
import { useSDK } from "@/tui/context/sdk"
import { useRoute } from "@/tui/context/route"
import { useProject } from "@/tui/context/project"
import { useSync } from "@/tui/context/sync"
import { useEvent } from "@/tui/context/event"
import { editorSelectionKey, useEditorContext, type EditorSelection } from "@/tui/context/editor"
import { MessageID, PartID } from "@/session/schema"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { useKeybind } from "@/tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { computePromptTraits } from "./traits"
import { assign } from "./part"
import { usePromptStash } from "./stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import * as Editor from "@/tui/util/editor"
import { useExit } from "../../context/exit"
import * as Clipboard from "../../util/clipboard"
import type { AssistantMessage, FilePart, UserMessage } from "@/tui/_compat/sdk-v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/tui/_compat/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog, type DialogContext } from "@/tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { createFadeIn } from "../../util/signal"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { DialogSkill } from "../dialog-skill"
import { DialogWorkspaceCreate, restoreWorkspaceSession } from "../dialog-workspace-create"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"
import { useArgs } from "@/tui/context/args"

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

function getEditorRangeLabel(selection: EditorSelection["ranges"][number]) {
  if (!hasEditorRangeSelection(selection)) return
  if (selection.selection.start.line === selection.selection.end.line) return `#${selection.selection.start.line}`
  return `#${selection.selection.start.line}-${selection.selection.end.line}`
}

function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `Note: The user selected ${prefix}${getEditorRangeLabel(range)} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
  })

  return `<system-reminder>${ranges.join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`
}

let stashed: { prompt: PromptInfo; cursor: number } | undefined

export type FollowupMode = "queue" | "steer"

// Queue rows are server-authoritative: each entry mirrors a `prompt_job`
// in the SQLite-backed `PromptQueue` table. Local state for the dock
// (preview text, reorder, etc.) is derived from `sync.data.prompt_queue`,
// populated by a snapshot fetch on session change and kept fresh by
// session.queue.{created,updated,removed} bus events.
//
// Display name kept as `QueuedSubmission` so the existing dock component
// keeps its prop shape; underneath, this is just a `PromptQueueJob` plus a
// computed `inputPreview`.
type QueuedSubmission = {
  id: string
  sessionID: string
  inputPreview: string
  status: "pending" | "failed"
}

function snapshotPromptInfo(prompt: PromptInfo): PromptInfo {
  return structuredClone(unwrap(prompt))
}

/**
 * Best-effort preview extraction from the server's stored payload. Server
 * stores `JSON.stringify({ parts: [...] })` — we peel out the first
 * non-empty line of text, fall back to a file or generic placeholder. If
 * the payload doesn't parse cleanly (older row, schema drift), we surface
 * a placeholder rather than crash the dock.
 */
function previewFromPayload(payload: string): string {
  let parsed: { parts?: Array<{ type?: string; text?: string; filename?: string }> }
  try {
    parsed = JSON.parse(payload)
  } catch {
    return "[attachment]"
  }
  const parts = parsed.parts ?? []
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      const line = part.text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0)
      if (line) return line
    }
  }
  const file = parts.find((p) => p.type === "file")
  if (file?.filename) return `[file: ${file.filename}]`
  const agent = parts.find((p) => p.type === "agent")
  if (agent && "name" in (agent as Record<string, unknown>)) return `@${(agent as { name?: string }).name ?? "agent"}`
  return "[attachment]"
}

function FollowupQueueAction(props: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const background = createMemo(() =>
    props.disabled ? undefined : hover() ? theme.backgroundElement : theme.backgroundMenu,
  )
  const foreground = createMemo(() => {
    if (props.disabled) return theme.textMuted
    if (props.danger) return theme.error
    return theme.text
  })

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={background()}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (props.disabled) return
        props.onClick()
      }}
    >
      <text fg={foreground()}>{props.label}</text>
    </box>
  )
}

function FollowupQueueDock(props: {
  items: QueuedSubmission[]
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [collapsed, setCollapsed] = createSignal(false)
  const count = createMemo(() => props.items.length)
  const summary = createMemo(() => `${count()} queued follow-up${count() === 1 ? "" : "s"}`)
  const preview = createMemo(() => props.items[0]?.inputPreview ?? "")
  const previewWidth = createMemo(() => Math.max(16, dimensions().width - 44))
  const rowWidth = createMemo(() => Math.max(16, dimensions().width - 56))
  // Cap the expanded queue at a few visible rows so it never crowds the
  // transcript — beyond that, the inner scrollbox handles overflow. The
  // `dimensions().height - 13` floor only kicks in on very short terminals
  // where 6 rows wouldn't fit alongside the rest of the prompt chrome.
  const listMaxHeight = createMemo(() => Math.min(6, Math.max(1, dimensions().height - 13)))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.secondary}
      customBorderChars={SplitBorder.customBorderChars}
      flexShrink={0}
    >
      <box
        flexDirection="row"
        alignItems="center"
        gap={1}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        onMouseUp={() => setCollapsed(!collapsed())}
      >
        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
          {summary()}
        </text>
        <Show when={collapsed() && preview()}>
          <text fg={theme.textMuted} overflow="hidden" wrapMode="none" flexGrow={1}>
            {Locale.truncate(preview(), previewWidth())}
          </text>
        </Show>
        <box flexGrow={1} />
        <text fg={theme.textMuted}>{collapsed() ? "▴" : "▾"}</text>
      </box>

      <Show when={!collapsed()}>
        <scrollbox
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={1}
          maxHeight={listMaxHeight()}
          scrollbarOptions={{ visible: count() > listMaxHeight() }}
        >
          <For each={props.items}>
            {(item, index) => {
              const first = createMemo(() => index() === 0)
              const last = createMemo(() => index() === props.items.length - 1)
              return (
                <box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
                  <text fg={theme.textMuted} flexShrink={0}>
                    {`${index() + 1}.`}
                  </text>
                  <text fg={theme.text} overflow="hidden" wrapMode="none" flexGrow={1}>
                    {Locale.truncate(item.inputPreview, rowWidth())}
                  </text>
                  <FollowupQueueAction label="send" onClick={() => props.onSend(item.id)} />
                  <FollowupQueueAction label="edit" onClick={() => props.onEdit(item.id)} />
                  <FollowupQueueAction label="↑" disabled={first()} onClick={() => props.onMove(item.id, -1)} />
                  <FollowupQueueAction label="↓" disabled={last()} onClick={() => props.onMove(item.id, 1)} />
                  <FollowupQueueAction label="×" danger onClick={() => props.onDelete(item.id)} />
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const args = useArgs()
  const sdk = useSDK()
  const editor = useEditorContext()
  const route = useRoute()
  const project = useProject()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const fileContextEnabled = createMemo(() => kv.get("file_context_enabled", true))
  const followupMode = createMemo<FollowupMode>(() => {
    const raw = kv.get("followup_mode", "queue")
    return raw === "steer" ? "steer" : "queue"
  })
  const setFollowupMode = (next: FollowupMode) => kv.set("followup_mode", next)
  const toggleFollowupMode = () => setFollowupMode(followupMode() === "queue" ? "steer" : "queue")
  // Dock items derived from the server-authoritative prompt queue. We
  // surface pending + failed rows (failed stays visible so the user can see
  // the error and dismiss explicitly); running is the active turn that the
  // message timeline already represents. Items are returned in the order
  // the server will run them (which matches their array order in the store
  // — the reducer appends Created events).
  const queuedForSession = createMemo<QueuedSubmission[]>(() => {
    if (!props.sessionID) return []
    const list = sync.data.prompt_queue?.[props.sessionID] ?? []
    // Dock shows only items that are actually waiting — pending and failed.
    // The currently-running job is the active turn, already represented in
    // the timeline; including it here made every just-submitted message
    // look like "queued behind something" even when it was the only
    // submission, which is the opposite of what the user expects.
    return list
      .filter((job) => job.status === "pending" || job.status === "failed")
      .map((job) => ({
        id: job.id,
        sessionID: job.sessionID,
        inputPreview: previewFromPayload(job.payload),
        status: job.status as "pending" | "failed",
      }))
  })
  const followupModeLabel = createMemo(() => {
    if (followupMode() === "steer") return "Steer"
    const count = queuedForSession().length
    return count > 0 ? `Follow-up (${count})` : "Follow-up"
  })
  const followupModeColor = createMemo(() => (followupMode() === "steer" ? theme.warning : theme.secondary))
  const [dismissedEditorSelectionKey, setDismissedEditorSelectionKey] = createSignal<string>()
  const editorContext = createMemo(() => {
    const selection = fileContextEnabled() ? editor.selection() : undefined
    if (!selection) return
    return editorSelectionKey(selection) === dismissedEditorSelectionKey() ? undefined : selection
  })
  const editorPath = createMemo(() => editorContext()?.filePath)
  const editorSelectionLabel = createMemo(() => {
    const ranges = editorContext()?.ranges
    if (!ranges) return
    const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
    if (!first) return
    return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined]
      .filter(Boolean)
      .join(" ")
  })
  const editorFileLabel = createMemo(() => {
    const value = editorPath()
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${editorSelectionLabel() ?? ""}`
  })
  const editorFileLabelDisplay = createMemo(() => {
    const file = editorFileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })
  const [editorContextHover, setEditorContextHover] = createSignal(false)
  let lastSubmittedEditorSelectionKey: string | undefined
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  const hasRightContent = createMemo(() => Boolean(props.right))

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  function dismissEditorContext() {
    setDismissedEditorSelectionKey(editorSelectionKey(editorContext()))
    editor.clearSelection()
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m): m is UserMessage => m.role === "user")
  })

  const usage = createMemo(() => {
    if (!props.sessionID) return
    const msg = sync.data.message[props.sessionID] ?? []
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = msg.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    return {
      context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: randomIndex(list().length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID || !msg) return

      syncedSessionID = sessionID

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        // Keep command line --agent if specified.
        if (!args.agent) local.agent.set(msg.agent)
        if (msg.model) {
          local.model.set(msg.model)
          local.model.variant.set(msg.model.variant)
        }
      }
    }
  })

  // Re-snapshot the server queue for a session. Used both on session change
  // (initial paint) and as a defensive sweep after a control command
  // (enqueue / cancel / reorder) — if a single SSE event drops on the floor,
  // refetching keeps the dock in sync with what the server actually has.
  function refreshQueue(sessionID: string) {
    return sdk.client.session.queue
      .list({ sessionID })
      .then((res) => {
        if (props.sessionID !== sessionID) return
        if (!res.data) return
        // reconcile() keyed on job id so repeat refreshes with the
        // same data don't produce new array refs and force every
        // downstream <For>/memo to redraw. Without this, each
        // refreshQueue tick (3s busy poll) re-keys the entire queue
        // list — visible as TUI flicker.
        sync.set("prompt_queue", sessionID, reconcile(res.data, { key: "id" }))
      })
      .catch(() => {
        // Snapshot failed (e.g. session not yet visible on server, or
        // transient network blip). Bus events will reconcile later.
      })
  }

  // Snapshot the server queue when the session changes so the dock paints
  // immediately on first render. After that, the SSE event stream keeps the
  // store fresh via session.queue.{created,updated,removed}; the reducer is
  // idempotent (duplicate Created is dropped; unknown Updated is treated as
  // create) so the snapshot vs. event-stream race resolves cleanly.
  createEffect(
    on(
      () => props.sessionID,
      (sessionID) => {
        if (!sessionID) return
        void refreshQueue(sessionID)
      },
    ),
  )

  // Defensive periodic refresh while the session is busy. If an SSE event
  // drops silently (network blip, mid-flight reconnect, anything), the
  // dock can drift from the server's actual queue and items appear "stuck"
  // or fail to remove after they complete. A 3s poll while busy guarantees
  // convergence without thrashing the server: idle sessions don't poll.
  createEffect(() => {
    const sessionID = props.sessionID
    if (!sessionID) return
    if (status().type === "idle") return
    const interval = setInterval(() => {
      void refreshQueue(sessionID)
    }, 3_000)
    onCleanup(() => clearInterval(interval))
  })

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: async (dialog) => {
          if (!input.focused) return
          const handled = await submit()
          if (!handled) return

          dialog.clear()
        },
      },
      {
        title: "Remove editor context",
        value: "prompt.editor_context.clear",
        category: "Prompt",
        enabled: Boolean(editorContext()),
        onSelect: (dialog) => {
          dismissEditorContext()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteAttachment({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            // `session.abort` calls PromptQueue.cancelSession server-side,
            // which drops every pending+running job for this session — so
            // double-interrupt continues to clear the queue without a
            // separate client-side wipe.
            void sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      void submit()
    },
  }

  onMount(() => {
    const saved = stashed
    stashed = undefined
    if (store.prompt.input) return
    if (saved && saved.prompt.input) {
      input.setText(saved.prompt.input)
      setStore("prompt", saved.prompt)
      restoreExtmarksFromParts(saved.prompt.parts)
      input.cursorOffset = saved.cursor
    }
  })

  onCleanup(() => {
    if (store.prompt.input) {
      stashed = { prompt: unwrap(store.prompt), cursor: input.cursorOffset }
    }
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      return
    }

    // Slot/plugin updates can remount the background prompt while a dialog is open.
    // Keep focus with the dialog and let the prompt reclaim it after the dialog closes.
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    input.traits = computePromptTraits({
      mode: store.mode,
      disabled: !!props.disabled,
      autocompleteVisible: !!auto()?.visible,
    })
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  function loadPrompt(prompt: PromptInfo, mode: "normal" | "shell" = prompt.mode ?? "normal") {
    const next = snapshotPromptInfo(prompt)
    input.setText(next.input)
    setStore("prompt", next)
    setStore("mode", mode)
    restoreExtmarksFromParts(next.parts)
    input.gotoBufferEnd()
  }

  // Edit a queued row: cancel the server-side job, then pre-fill the
  // composer with a text-only reconstruction of the payload. The original
  // PromptInfo (parts, file context, etc.) is gone because the server only
  // persists the wire-format request — good enough for v1, user can re-add
  // attachments. If the row is already running by the time we hit this,
  // cancel returns 204 (no-op) and the user re-runs from the composer.
  function editQueuedFollowup(id: string) {
    const sessionID = props.sessionID
    if (!sessionID) return
    const row = sync.data.prompt_queue?.[sessionID]?.find((j) => j.id === id)
    if (!row) return

    void sdk.client.session.queue.cancel({ sessionID, jobID: id }).catch(() => undefined)

    if (store.prompt.input) {
      stash.push(snapshotPromptInfo(store.prompt))
    }

    let parsed: { parts?: Array<{ type?: string; text?: string }> } = {}
    try {
      parsed = JSON.parse(row.payload)
    } catch {
      // Payload schema drift — fall through with empty composer.
    }
    const text = (parsed.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
    const restored: PromptInfo = { input: text, parts: [], mode: "normal" }
    loadPrompt(restored, "normal")
  }

  // "Send now": promote this job to the head of the queue so the worker
  // picks it next, as soon as the active turn finishes. We do NOT call
  // session.abort first — that's session-wide and would server-cancel
  // every other pending job in the queue (matches the user-reported bug
  // "click send on one item → all items get aborted"). If the user wants
  // to interrupt the active turn AND run a queued item immediately, they
  // can use the dedicated interrupt command (double-tap), but that intent
  // is "stop everything," not "skip ahead."
  async function sendQueuedFollowup(id: string) {
    const sessionID = props.sessionID
    if (!sessionID) return
    const pending = (sync.data.prompt_queue?.[sessionID] ?? []).filter((j) => j.status === "pending")
    if (!pending.some((j) => j.id === id)) return
    const reordered = [id, ...pending.filter((j) => j.id !== id).map((j) => j.id)]
    await sdk.client.session.queue.reorder({ sessionID, jobIDs: reordered }).catch(() => undefined)
    void refreshQueue(sessionID)
  }

  function deleteQueuedFollowup(id: string) {
    const sessionID = props.sessionID
    if (!sessionID) return
    void sdk.client.session.queue
      .cancel({ sessionID, jobID: id })
      .then(() => refreshQueue(sessionID))
      .catch(() => undefined)
  }

  function moveQueuedFollowup(id: string, direction: -1 | 1) {
    const sessionID = props.sessionID
    if (!sessionID) return
    const pending = (sync.data.prompt_queue?.[sessionID] ?? []).filter((j) => j.status === "pending")
    const from = pending.findIndex((j) => j.id === id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= pending.length) return
    const next = pending.slice()
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    void sdk.client.session.queue
      .reorder({ sessionID, jobIDs: next.map((j) => j.id) })
      .then(() => refreshQueue(sessionID))
      .catch(() => undefined)
  }

  command.register(() => [
    {
      title: "Stash prompt",
      value: "prompt.stash",
      category: "Prompt",
      enabled: !!store.prompt.input,
      onSelect: (dialog) => {
        if (!store.prompt.input) return
        stash.push({
          input: store.prompt.input,
          parts: store.prompt.parts,
        })
        input.extmarks.clear()
        input.clear()
        setStore("prompt", { input: "", parts: [] })
        setStore("extmarkToPartIndex", new Map())
        dialog.clear()
      },
    },
    {
      title: "Stash pop",
      value: "prompt.stash.pop",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        const entry = stash.pop()
        if (entry) {
          input.setText(entry.input)
          setStore("prompt", { input: entry.input, parts: entry.parts })
          restoreExtmarksFromParts(entry.parts)
          input.gotoBufferEnd()
        }
        dialog.clear()
      },
    },
    {
      title: "Stash list",
      value: "prompt.stash.list",
      category: "Prompt",
      enabled: stash.list().length > 0,
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogStash
            onSelect={(entry) => {
              input.setText(entry.input)
              setStore("prompt", { input: entry.input, parts: entry.parts })
              restoreExtmarksFromParts(entry.parts)
              input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
    {
      title:
        followupMode() === "queue"
          ? "Follow-up: switch to steer (interrupt + send)"
          : "Follow-up: switch to queue (wait for idle)",
      value: "prompt.followup.toggle",
      keybind: "followup_toggle",
      category: "Prompt",
      onSelect: (dialog) => {
        toggleFollowupMode()
        toast.show({
          variant: "info",
          message: `Follow-up mode: ${followupMode()}`,
          duration: 2000,
        })
        dialog.clear()
      },
    },
    ...queuedForSession().flatMap((item, index) => [
      {
        title: `Queued follow-up ${index + 1}: send now`,
        description: item.inputPreview,
        value: `prompt.followup.${item.id}.send`,
        category: "Prompt",
        onSelect: (dialog: DialogContext) => {
          void sendQueuedFollowup(item.id)
          dialog.clear()
        },
      },
      {
        title: `Queued follow-up ${index + 1}: edit`,
        description: item.inputPreview,
        value: `prompt.followup.${item.id}.edit`,
        category: "Prompt",
        onSelect: (dialog: DialogContext) => {
          editQueuedFollowup(item.id)
          dialog.clear()
        },
      },
      {
        title: `Queued follow-up ${index + 1}: delete`,
        description: item.inputPreview,
        value: `prompt.followup.${item.id}.delete`,
        category: "Prompt",
        onSelect: (dialog: DialogContext) => {
          deleteQueuedFollowup(item.id)
          dialog.clear()
        },
      },
      {
        title: `Queued follow-up ${index + 1}: move up`,
        description: item.inputPreview,
        value: `prompt.followup.${item.id}.up`,
        category: "Prompt",
        enabled: index > 0,
        onSelect: (dialog: DialogContext) => {
          moveQueuedFollowup(item.id, -1)
          dialog.clear()
        },
      },
      {
        title: `Queued follow-up ${index + 1}: move down`,
        description: item.inputPreview,
        value: `prompt.followup.${item.id}.down`,
        category: "Prompt",
        enabled: index < queuedForSession().length - 1,
        onSelect: (dialog: DialogContext) => {
          moveQueuedFollowup(item.id, 1)
          dialog.clear()
        },
      },
    ]),
  ])

  async function submit() {
    // IME: double-defer may fire before onContentChange flushes the last
    // composed character (e.g. Korean hangul) to the store, so read
    // plainText directly and sync before any downstream reads.
    if (input && !input.isDestroyed && input.plainText !== store.prompt.input) {
      setStore("prompt", "input", input.plainText)
      syncExtmarksWithPromptParts()
    }
    if (props.disabled) return false
    if (autocomplete?.visible) return false
    if (!store.prompt.input) return false
    const agent = local.agent.current()
    if (!agent) return false
    const trimmed = store.prompt.input.trim()
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      void exit()
      return true
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      void promptModelWarning()
      return false
    }

    const workspaceSession = props.sessionID ? sync.session.get(props.sessionID) : undefined
    const workspaceID = workspaceSession?.workspaceID
    const workspaceStatus = workspaceID ? (project.workspace.status(workspaceID) ?? "error") : undefined
    if (props.sessionID && workspaceID && workspaceStatus !== "connected") {
      dialog.replace(() => (
        <DialogWorkspaceUnavailable
          onRestore={() => {
            dialog.replace(() => (
              <DialogWorkspaceCreate
                onSelect={(nextWorkspaceID) =>
                  restoreWorkspaceSession({
                    dialog,
                    sdk,
                    sync,
                    project,
                    toast,
                    workspaceID: nextWorkspaceID,
                    sessionID: props.sessionID!,
                  })
                }
              />
            ))
          }}
        />
      ))
      return false
    }

    const variant = local.model.variant.current()
    let sessionID = props.sessionID
    if (sessionID == null) {
      // The runtime server accepts `agent` and `model` on session create; our
      // SDK type defs don't yet model those two fields. Build a typed extension
      // of the SDK's create input so the call is checked against everything
      // else (workspace, parentID, title, permission, ...).
      type SessionCreateInputAugmented = Parameters<typeof sdk.client.session.create>[0] & {
        agent?: string
        model?: { providerID: string; id: string; variant?: string }
      }
      const createInput: SessionCreateInputAugmented = {
        workspace: props.workspaceID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          id: selectedModel.modelID,
          variant,
        },
      }
      const res = await sdk.client.session.create(createInput)

      if (res.error) {
        console.log("Creating a session failed:", res.error)

        toast.show({
          message: "Creating a session failed. Open console for more details.",
          variant: "error",
        })

        return true
      }

      sessionID = res.data.id
    }

    const messageID = MessageID.ascending()
    const promptSnapshot = snapshotPromptInfo(store.prompt)
    let inputText = promptSnapshot.input

    // Expand pasted text inline before submitting
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

    for (const extmark of sortedExtmarks) {
      const partIndex = store.extmarkToPartIndex.get(extmark.id)
      if (partIndex !== undefined) {
        const part = store.prompt.parts[partIndex]
        if (part?.type === "text" && part.text) {
          const before = inputText.slice(0, extmark.start)
          const after = inputText.slice(extmark.end)
          inputText = before + part.text + after
        }
      }
    }

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = promptSnapshot.parts.filter((part) => part.type !== "text")

    // Capture mode before it gets reset
    const currentMode = store.mode
    const editorSelection = editorContext()
    const currentEditorSelectionKey = editorSelectionKey(editorSelection)
    const editorParts =
      editorSelection && currentEditorSelectionKey !== lastSubmittedEditorSelectionKey
        ? [
            {
              id: PartID.ascending(),
              type: "text" as const,
              text: formatEditorContext(editorSelection),
              synthetic: true,
              metadata: {
                kind: "editor_context",
                source: editorSelection.source ?? "editor",
                filePath: editorSelection.filePath,
                ranges: editorSelection.ranges,
              },
            },
          ]
        : []

    // Detect a custom slash command up front so the dispatch closure does not
    // need to re-parse the text and so the disposition logic below can route
    // commands the same way the web app does (steer = abort+send, queue =
    // delay until idle).
    const isCustomCommand =
      currentMode !== "shell" &&
      inputText.startsWith("/") &&
      iife(() => {
        const firstLine = inputText.split("\n")[0]
        const command = firstLine.split(" ")[0].slice(1)
        return sync.data.command.some((x) => x.name === command)
      })

    // Build a single dispatch closure that captures all the state needed to
    // send this submission later (queue drain) or now (immediate / steer).
    const dispatch = async () => {
      if (currentMode === "shell") {
        void sdk.client.session.shell({
          sessionID: sessionID!,
          agent: agent.name,
          model: {
            providerID: selectedModel.providerID,
            modelID: selectedModel.modelID,
          },
          command: inputText,
        })
        return
      }
      if (isCustomCommand) {
        const firstLineEnd = inputText.indexOf("\n")
        const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
        const [command, ...firstLineArgs] = firstLine.split(" ")
        const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
        const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")
        void sdk.client.session.command({
          sessionID: sessionID!,
          command: command.slice(1),
          arguments: args,
          agent: agent.name,
          model: `${selectedModel.providerID}/${selectedModel.modelID}`,
          messageID,
          variant,
          parts: nonTextParts
            .filter((x) => x.type === "file")
            .map((x) => ({
              id: PartID.ascending(),
              ...x,
            })),
        })
        return
      }
      // Always go through the server's persistent queue, even for an idle
      // session. The server's PromptQueueWorker picks up the row on its next
      // tick; for an empty queue, that's milliseconds. This keeps execution
      // entirely server-side — the client never invokes the synchronous
      // `prompt` endpoint. Benefits over the previous in-process path:
      //   - the request survives a client disconnect / TUI crash
      //   - failures retry with bounded attempts
      //   - the dock shows the in-flight row the same way it shows pending
      //     ones, with no special-case "we're executing this one right now"
      //     client state
      sdk.client.session
        .promptAsync({
          sessionID: sessionID!,
          ...selectedModel,
          messageID,
          agent: agent.name,
          model: selectedModel,
          variant,
          parts: [
            ...editorParts,
            {
              id: PartID.ascending(),
              type: "text",
              text: inputText,
            },
            ...nonTextParts.map(assign),
          ],
        })
        .then(() => {
          // Refresh the queue snapshot so the dock fills in even if the
          // session.queue.created SSE event arrives late or is dropped.
          // Cheap (one HTTP round-trip), idempotent (reducer dedupes by id).
          if (sessionID) void refreshQueue(sessionID)
        })
        .catch(() => {})
      lastSubmittedEditorSelectionKey = currentEditorSelectionKey
    }

    // Resolve send vs steer. With the server-authoritative queue,
    // "queue" and "send" collapse into the same call: the server's
    // PromptQueueWorker decides what runs and when, so the only thing the
    // client has to choose is whether to abort the active turn first.
    //
    //   - steer: abort the in-flight turn before submitting (the server
    //     also cancels pending queue rows for the session on abort, so a
    //     queued backlog is wiped — matching the previous semantics).
    //   - everything else: just submit. If the queue is empty and the
    //     session is idle, the worker picks the row up on its next tick
    //     (milliseconds). If the queue has rows, this one lands at the
    //     end and the worker reaches it in FIFO order.
    //
    // Shell and custom command still bypass the queue because they have
    // no async server-queue counterpart yet. They run server-side, but
    // synchronously — not queued.
    const wasNewSession = !props.sessionID
    const statusType = status().type
    const steering =
      !wasNewSession &&
      currentMode !== "shell" &&
      statusType !== "idle" &&
      followupMode() === "steer" &&
      !!props.sessionID

    if (steering && props.sessionID) {
      await sdk.client.session.abort({ sessionID: props.sessionID }).catch(() => undefined)
    }
    void dispatch()

    if (currentMode === "shell") {
      setStore("mode", "normal")
    }
    history.append({
      ...promptSnapshot,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID)
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    input.clear()
    return true
  }
  const exit = useExit()

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + virtualText.length

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteAttachment(file: { filename?: string; filepath?: string; content: string; mime: string }) {
    const currentOffset = input.visualCursor.offset
    const extmarkStart = currentOffset
    const pdf = file.mime === "application/pdf"
    const count = store.prompt.parts.filter((x) => {
      if (x.type !== "file") return false
      if (pdf) return x.mime === "application/pdf"
      return x.mime.startsWith("image/")
    }).length
    const virtualText = pdf ? `[PDF ${count + 1}]` : `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename: file.filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: file.filepath ?? file.filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    const agent = local.agent.current()
    if (!agent) return theme.border
    return local.agent.color(agent.name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const agentMetaAlpha = createFadeIn(() => !!local.agent.current(), animationsEnabled)
  const modelMetaAlpha = createFadeIn(() => !!local.agent.current() && store.mode === "normal", animationsEnabled)
  const variantMetaAlpha = createFadeIn(
    () => !!local.agent.current() && store.mode === "normal" && showVariant(),
    animationsEnabled,
  )
  const borderHighlight = createMemo(() => tint(theme.border, highlight(), agentMetaAlpha()))

  const placeholderText = createMemo(() => {
    if (props.showPlaceholder === false) return undefined
    if (store.mode === "shell") {
      if (!shell().length) return undefined
      const example = shell()[store.placeholder % shell().length]
      return `Run a command... "${example}"`
    }
    if (!list().length) return undefined
    return `Ask anything... "${list()[store.placeholder % list().length]}"`
  })

  const spinnerDef = createMemo(() => {
    const agent = local.agent.current()
    const color = agent ? local.agent.color(agent.name) : theme.border
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })

  return (
    <>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => {
          autocomplete = r
          setAuto(() => r)
        }}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
      <box ref={(r) => (anchor = r)} visible={props.visible !== false}>
        <Show when={queuedForSession().length > 0}>
          <FollowupQueueDock
            items={queuedForSession()}
            onSend={(id) => void sendQueuedFollowup(id)}
            onEdit={editQueuedFollowup}
            onDelete={deleteQueuedFollowup}
            onMove={moveQueuedFollowup}
          />
        </Show>
        <box
          border={["left"]}
          borderColor={borderHighlight()}
          customBorderChars={{
            ...SplitBorder.customBorderChars,
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
          >
            <textarea
              placeholder={placeholderText()}
              placeholderColor={theme.textMuted}
              textColor={keybind.leader ? theme.textMuted : theme.text}
              focusedTextColor={keybind.leader ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={6}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                autocomplete.onInput(value)
                syncExtmarksWithPromptParts()
              }}
              keyBindings={textareaKeybindings()}
              onKeyDown={async (e) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
                // Check clipboard for images before terminal-handled paste runs.
                // This helps terminals that forward Ctrl+V to the app; Windows
                // Terminal 1.25+ usually handles Ctrl+V before this path.
                if (keybind.match("input_paste", e)) {
                  const content = await Clipboard.read()
                  if (content?.mime.startsWith("image/")) {
                    e.preventDefault()
                    await pasteAttachment({
                      filename: "clipboard",
                      mime: content.mime,
                      content: content.data,
                    })
                    return
                  }
                  // If no image, let the default paste behavior continue
                }
                if (keybind.match("input_clear", e) && store.prompt.input !== "") {
                  input.clear()
                  input.extmarks.clear()
                  setStore("prompt", {
                    input: "",
                    parts: [],
                  })
                  setStore("extmarkToPartIndex", new Map())
                  return
                }
                if (keybind.match("app_exit", e)) {
                  if (store.prompt.input === "") {
                    await exit()
                    // Don't preventDefault - let textarea potentially handle the event
                    e.preventDefault()
                    return
                  }
                }
                if (e.name === "!" && input.visualCursor.offset === 0) {
                  setStore("placeholder", randomIndex(shell().length))
                  setStore("mode", "shell")
                  e.preventDefault()
                  return
                }
                if (store.mode === "shell") {
                  if ((e.name === "backspace" && input.visualCursor.offset === 0) || e.name === "escape") {
                    setStore("mode", "normal")
                    e.preventDefault()
                    return
                  }
                }
                if (store.mode === "normal") autocomplete.onKeyDown(e)
                if (!autocomplete.visible) {
                  if (
                    (keybind.match("history_previous", e) && input.cursorOffset === 0) ||
                    (keybind.match("history_next", e) && input.cursorOffset === input.plainText.length)
                  ) {
                    const direction = keybind.match("history_previous", e) ? -1 : 1
                    const item = history.move(direction, input.plainText)

                    if (item) {
                      input.setText(item.input)
                      setStore("prompt", item)
                      setStore("mode", item.mode ?? "normal")
                      restoreExtmarksFromParts(item.parts)
                      e.preventDefault()
                      if (direction === -1) input.cursorOffset = 0
                      if (direction === 1) input.cursorOffset = input.plainText.length
                    }
                    return
                  }

                  if (keybind.match("history_previous", e) && input.visualCursor.visualRow === 0) input.cursorOffset = 0
                  if (keybind.match("history_next", e) && input.visualCursor.visualRow === input.height - 1)
                    input.cursorOffset = input.plainText.length
                }
              }}
              onSubmit={() => {
                // IME: double-defer so the last composed character (e.g. Korean
                // hangul) is flushed to plainText before we read it for submission.
                setTimeout(() => setTimeout(() => submit(), 0), 0)
              }}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()

                // Windows Terminal <1.25 can surface image-only clipboard as an
                // empty bracketed paste. Windows Terminal 1.25+ does not.
                if (!pastedContent) {
                  command.trigger("prompt.paste")
                  return
                }

                // Once we cross an async boundary below, the terminal may perform its
                // default paste unless we suppress it first and handle insertion ourselves.
                event.preventDefault()

                const filepath = iife(() => {
                  const raw = pastedContent.replace(/^['"]+|['"]+$/g, "")
                  if (raw.startsWith("file://")) {
                    try {
                      return fileURLToPath(raw)
                    } catch {}
                  }
                  if (process.platform === "win32") return raw
                  return raw.replace(/\\(.)/g, "$1")
                })
                const isUrl = /^(https?):\/\//.test(filepath)
                if (!isUrl) {
                  try {
                    const mime = await Filesystem.mimeType(filepath)
                    const filename = path.basename(filepath)
                    // Handle SVG as raw text content, not as base64 image
                    if (mime === "image/svg+xml") {
                      const content = await Filesystem.readText(filepath).catch(() => {})
                      if (content) {
                        pasteText(content, `[SVG: ${filename ?? "image"}]`)
                        return
                      }
                    }
                    if (mime.startsWith("image/") || mime === "application/pdf") {
                      const content = await Filesystem.readArrayBuffer(filepath)
                        .then((buffer) => Buffer.from(buffer).toString("base64"))
                        .catch(() => {})
                      if (content) {
                        await pasteAttachment({
                          filename,
                          filepath,
                          mime,
                          content,
                        })
                        return
                      }
                    }
                  } catch {}
                }

                const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
                if (
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary)
                ) {
                  pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
                  return
                }

                input.insertText(normalizedText)

                // Force layout update and render for the pasted content
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.getLayoutNode().markDirty()
                  renderer.requestRender()
                }, 0)
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.text}
              syntaxStyle={syntax()}
            />
            <box
              flexDirection="row"
              flexShrink={0}
              paddingTop={1}
              gap={1}
              justifyContent="space-between"
              alignItems="center"
            >
              <box flexDirection="row" gap={1} flexShrink={1}>
                <Show when={local.agent.current()} fallback={<box height={1} />}>
                  {(agent) => (
                    <>
                      <text fg={fadeColor(highlight(), agentMetaAlpha())} wrapMode="none" flexShrink={0}>
                        {store.mode === "shell" ? "Shell" : Locale.titlecase(agent().name)}
                      </text>
                      <Show when={store.mode === "normal"}>
                        <box flexDirection="row" gap={1} flexShrink={1}>
                          <text fg={fadeColor(theme.textMuted, modelMetaAlpha())}>·</text>
                          <text
                            flexShrink={1}
                            fg={fadeColor(keybind.leader ? theme.textMuted : theme.text, modelMetaAlpha())}
                            overflow="hidden"
                            wrapMode="none"
                          >
                            {local.model.parsed().model}
                          </text>
                          <text fg={fadeColor(theme.textMuted, modelMetaAlpha())} wrapMode="none" flexShrink={0}>
                            {currentProviderLabel()}
                          </text>
                        </box>
                      </Show>
                    </>
                  )}
                </Show>
              </box>
              <box flexDirection="row" gap={1} alignItems="center" justifyContent="flex-end" flexShrink={0}>
                <Show when={local.agent.current() && store.mode === "normal"}>
                  <text fg={fadeColor(followupModeColor(), modelMetaAlpha())} wrapMode="none" flexShrink={0}>
                    <span style={{ bold: followupMode() === "steer" }}>{followupModeLabel()}</span>
                  </text>
                  <Show when={showVariant()}>
                    <text fg={fadeColor(theme.textMuted, variantMetaAlpha())}>·</text>
                    <text wrapMode="none" flexShrink={0}>
                      <span style={{ fg: fadeColor(theme.warning, variantMetaAlpha()), bold: true }}>
                        {local.model.variant.current()}
                      </span>
                    </text>
                  </Show>
                </Show>
                <Show when={hasRightContent()}>
                  {props.right}
                </Show>
              </box>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={borderHighlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <Show when={status().type !== "idle"} fallback={props.hint ?? <text />}>
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1}>
                  <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                    <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  {(() => {
                    const retry = createMemo(() => {
                      const s = status()
                      if (s.type !== "retry") return
                      return s
                    })
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "gemini is way too hot right now"
                      if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                      return r.message
                    })
                    const isTruncated = createMemo(() => {
                      const r = retry()
                      if (!r) return false
                      return r.message.length > 120
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const timer = setInterval(() => {
                        const next = retry()?.next
                        if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                      }, 1000)

                      onCleanup(() => {
                        clearInterval(timer)
                      })
                    })
                    const handleMessageClick = () => {
                      const r = retry()
                      if (!r) return
                      if (isTruncated()) {
                        void DialogAlert.show(dialog, "Retry Error", r.message)
                      }
                    }

                    const retryText = () => {
                      const r = retry()
                      if (!r) return ""
                      const baseMessage = message()
                      const truncatedHint = isTruncated() ? " (click to expand)" : ""
                      const duration = formatDuration(seconds())
                      const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                      return baseMessage + truncatedHint + retryInfo
                    }

                    return (
                      <Show when={retry()}>
                        <box onMouseUp={handleMessageClick}>
                          <text fg={theme.error}>{retryText()}</text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <Show when={status().type !== "retry"}>
                <text fg={theme.text}>
                  {keybind.print("followup_toggle")}{" "}
                  <span style={{ fg: followupModeColor() }}>{followupModeLabel()}</span>
                </text>
              </Show>
              <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                  {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Show>
          <Show when={status().type !== "retry"}>
            <box gap={2} flexDirection="row">
              <Show when={editorFileLabelDisplay()}>
                {(file) => (
                  <text
                    fg={theme.secondary}
                    onMouseOver={() => setEditorContextHover(true)}
                    onMouseOut={() => setEditorContextHover(false)}
                    onMouseUp={dismissEditorContext}
                  >
                    {editorContextHover() ? `x ${file()}` : file()}
                  </text>
                )}
              </Show>
              <Switch>
                <Match when={store.mode === "normal"}>
                  <Switch>
                    <Match when={usage()}>
                      {(item) => (
                        <text fg={theme.textMuted} wrapMode="none">
                          {[item().context, item().cost].filter(Boolean).join(" · ")}
                        </text>
                      )}
                    </Match>
                    <Match when={true}>
                      <text fg={theme.text}>
                        {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>agents</span>
                      </text>
                    </Match>
                  </Switch>
                  <text fg={theme.text}>
                    {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
    </>
  )
}
