import type { Message, Part, Project, UserMessage } from "@codeplane-ai/sdk/v2"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { createQuery, skipToken, useMutation, useQueryClient } from "@tanstack/solid-query"
import {
  batch,
  onCleanup,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createComputed,
  on,
  onMount,
  untrack,
  createResource,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore, reconcile } from "solid-js/store"
import { ResizeHandle } from "@codeplane-ai/ui/resize-handle"
import { Select } from "@codeplane-ai/ui/select"
import { Tabs } from "@codeplane-ai/ui/tabs"
import { FileReferenceProvider, type FileReferenceSelection } from "@codeplane-ai/ui/context/file"
import { createAutoScroll } from "@codeplane-ai/ui/hooks"
import { previewSelectedLines } from "@codeplane-ai/ui/pierre/selection-bridge"
import { Button } from "@codeplane-ai/ui/button"
import { Spinner } from "@codeplane-ai/ui/spinner"
import { showToast } from "@codeplane-ai/ui/toast"
import { checksum } from "@codeplane-ai/shared/util/encode"
import { useSearchParams } from "@solidjs/router"
import { NewSessionView, SessionHeader } from "@/components/session"
import { useComments } from "@/context/comments"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { INITIAL_MESSAGE_PAGE_SIZE, useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import { sessionPermissionRequest, sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import type { Prompt as PromptType, ContextItem } from "@/context/prompt"
import type { PromptQueueJob } from "@/context/global-sync/types"
import {
  createOpenReviewFile,
  createSessionTabs,
  createSizing,
  focusTerminalById,
  shouldFocusTerminalOnKeyDown,
} from "@/pages/session/helpers"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { SessionActivityTab } from "@/pages/session/session-activity-tab"
import { useSessionLayout } from "@/pages/session/session-layout"
import { hasUnansweredUserMessage, isSessionWorking } from "@/pages/session/session-working"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { Identifier } from "@/utils/id"
import { diffs as list } from "@/utils/diffs"
import { Persist, persisted } from "@/utils/persist"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError } from "@/utils/server-errors"

const emptyUserMessages: UserMessage[] = []

/**
 * Pre-v29.0.26 sessions can have long runs of compaction-only user
 * messages from the autocompact-loop bug (the runLoop fired
 * compaction.create() every iteration without ever processing the
 * scheduled task). Each of those messages renders as a "Session
 * compacted" divider and hides every adjacent real message because the
 * turn renderer treats compaction turns as standalone dividers.
 *
 * This filter hides compaction-only user messages that didn't produce
 * any assistant response. A legitimate compaction always has an
 * assistant child (the summary, marked `summary: true`); a runaway one
 * doesn't. The first compaction-only message in a run is still kept if
 * NO compaction in the run has a child — that way the user still sees
 * "Session compacted" once, even on legacy data, instead of the wall
 * of dividers.
 *
 * Server-side v29.0.26 prevents new runs from forming; this filter
 * cleans up the historical noise so pre-fix sessions render properly.
 */
function collapseEmptyCompactionTurns(
  userMessages: UserMessage[],
  partsByMessage: Record<string, Part[]>,
  allMessages: Message[],
): UserMessage[] {
  if (userMessages.length === 0) return userMessages
  const hasCompactionPart = (id: string) =>
    (partsByMessage[id] ?? []).some((part) => part.type === "compaction")
  const hasAssistantChild = (id: string) =>
    allMessages.some((m) => m.role === "assistant" && m.parentID === id)
  let changed = false
  const out: UserMessage[] = []
  // Track whether the previous emitted user message was a compaction
  // divider; collapse adjacent compaction-only dividers into one.
  let lastEmittedWasCompactionDivider = false
  for (const msg of userMessages) {
    if (!hasCompactionPart(msg.id)) {
      out.push(msg)
      lastEmittedWasCompactionDivider = false
      continue
    }
    if (hasAssistantChild(msg.id)) {
      // Real compaction that produced a summary. Keep it.
      out.push(msg)
      lastEmittedWasCompactionDivider = true
      continue
    }
    // Empty compaction (no summary produced). Hide unless this is the
    // first in the run — keep one divider so the user knows compaction
    // was scheduled.
    if (lastEmittedWasCompactionDivider) {
      changed = true
      continue
    }
    out.push(msg)
    lastEmittedWasCompactionDivider = true
  }
  return changed ? out : userMessages
}

type FollowupEdit = {
  id: string
  prompt: PromptType
  context: (ContextItem & { key: string })[]
}
const WORKING_RESYNC_INITIAL_MS = 1_500
const WORKING_RESYNC_INTERVAL_MS = 4_000
const WORKING_RESYNC_MAX_ATTEMPTS = 60
const IDLE_RESYNC_SETTLE_MS = 250
const IDLE_RESYNC_RETRY_MS = 1_250
const IDLE_RESYNC_MAX_ATTEMPTS = 3

type ChangeMode = "git" | "branch" | "turn"
type VcsMode = "git" | "branch"

type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  messagesReady: () => boolean
  loaded: () => number
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  loadMore: (sessionID: string) => Promise<void>
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
}

/**
 * Maintains the rendered history window for a session timeline.
 *
 * It keeps initial paint bounded to recent turns, reveals cached turns in
 * small batches while scrolling upward, and prefetches older history near top.
 */
function createSessionHistoryWindow(input: SessionHistoryWindowInput) {
  const turnInit = 10
  const turnBatch = 8
  const turnScrollThreshold = 200
  const turnPrefetchBuffer = 16
  const prefetchCooldownMs = 400
  const prefetchNoGrowthLimit = 2

  const [state, setState] = createStore({
    turnID: undefined as string | undefined,
    turnStart: 0,
    prefetchUntil: 0,
    prefetchNoGrowth: 0,
  })

  const initialTurnStart = (len: number) => (len > turnInit ? len - turnInit : 0)

  const turnStart = createMemo(() => {
    const id = input.sessionID()
    const len = input.visibleUserMessages().length
    if (!id || len <= 0) return 0
    if (state.turnID !== id) return initialTurnStart(len)
    if (state.turnStart <= 0) return 0
    if (state.turnStart >= len) return initialTurnStart(len)
    return state.turnStart
  })

  const setTurnStart = (start: number) => {
    const id = input.sessionID()
    const next = start > 0 ? start : 0
    if (!id) {
      setState({ turnID: undefined, turnStart: next })
      return
    }
    setState({ turnID: id, turnStart: next })
  }

  const renderedUserMessages = createMemo(
    () => {
      const msgs = input.visibleUserMessages()
      const start = turnStart()
      if (start <= 0) return msgs
      return msgs.slice(start)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )

  const preserveScroll = (fn: () => void) => {
    const el = input.scroller()
    if (!el) {
      fn()
      return
    }
    const beforeTop = el.scrollTop
    const beforeHeight = el.scrollHeight
    fn()
    requestAnimationFrame(() => {
      const delta = el.scrollHeight - beforeHeight
      if (!delta) return
      el.scrollTop = beforeTop + delta
    })
  }

  const backfillTurns = () => {
    const start = turnStart()
    if (start <= 0) return

    const next = start - turnBatch
    const nextStart = next > 0 ? next : 0

    preserveScroll(() => setTurnStart(nextStart))
  }

  /** Button path: reveal all cached turns, fetch older history, reveal one batch. */
  const loadAndReveal = async () => {
    const id = input.sessionID()
    if (!id) return

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    let loaded = input.loaded()

    if (start > 0) setTurnStart(0)

    if (!input.historyMore() || input.historyLoading()) return

    let afterVisible = beforeVisible
    let added = 0

    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      afterVisible = input.visibleUserMessages().length
      const nextLoaded = input.loaded()
      const raw = nextLoaded - loaded
      added += raw
      loaded = nextLoaded

      if (afterVisible > beforeVisible) break
      if (raw <= 0) break
      if (!input.historyMore()) break
    }

    if (added <= 0) return
    if (state.prefetchNoGrowth) setState("prefetchNoGrowth", 0)

    const growth = afterVisible - beforeVisible
    if (growth <= 0) return
    if (turnStart() !== 0) return

    const target = Math.min(afterVisible, beforeVisible + turnBatch)
    setTurnStart(Math.max(0, afterVisible - target))
  }

  /** Scroll/prefetch path: fetch older history from server. */
  const fetchOlderMessages = async (opts?: { prefetch?: boolean }) => {
    const id = input.sessionID()
    if (!id) return
    if (!input.historyMore() || input.historyLoading()) return

    if (opts?.prefetch) {
      const now = Date.now()
      if (state.prefetchUntil > now) return
      if (state.prefetchNoGrowth >= prefetchNoGrowthLimit) return
      setState("prefetchUntil", now + prefetchCooldownMs)
    }

    const start = turnStart()
    const beforeVisible = input.visibleUserMessages().length
    const beforeRendered = start <= 0 ? beforeVisible : renderedUserMessages().length
    let loaded = input.loaded()
    let added = 0
    let growth = 0

    while (true) {
      await input.loadMore(id)
      if (input.sessionID() !== id) return

      const nextLoaded = input.loaded()
      const raw = nextLoaded - loaded
      added += raw
      loaded = nextLoaded
      growth = input.visibleUserMessages().length - beforeVisible

      if (growth > 0) break
      if (raw <= 0) break
      if (opts?.prefetch) break
      if (!input.historyMore()) break
    }

    const afterVisible = input.visibleUserMessages().length

    if (opts?.prefetch) {
      setState("prefetchNoGrowth", added > 0 ? 0 : state.prefetchNoGrowth + 1)
    } else if (added > 0 && state.prefetchNoGrowth) {
      setState("prefetchNoGrowth", 0)
    }

    if (added <= 0) return
    if (growth <= 0) return

    if (opts?.prefetch) {
      const current = turnStart()
      preserveScroll(() => setTurnStart(current + growth))
      return
    }

    if (turnStart() !== start) return

    const currentRendered = renderedUserMessages().length
    const base = Math.max(beforeRendered, currentRendered)
    const target = Math.min(afterVisible, base + turnBatch)
    preserveScroll(() => setTurnStart(Math.max(0, afterVisible - target)))
  }

  const onScrollerScroll = () => {
    if (!input.userScrolled()) return
    const el = input.scroller()
    if (!el) return
    if (el.scrollTop >= turnScrollThreshold) return

    const start = turnStart()
    if (start > 0) {
      if (start <= turnPrefetchBuffer) {
        void fetchOlderMessages({ prefetch: true })
      }
      backfillTurns()
      return
    }

    void fetchOlderMessages()
  }

  createEffect(
    on(
      input.sessionID,
      () => {
        setState({ prefetchUntil: 0, prefetchNoGrowth: 0 })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [input.sessionID(), input.messagesReady()] as const,
      ([id, ready]) => {
        if (!id || !ready) return
        setTurnStart(initialTurnStart(input.visibleUserMessages().length))
      },
      { defer: true },
    ),
  )

  return {
    turnStart,
    setTurnStart,
    renderedUserMessages,
    loadAndReveal,
    onScrollerScroll,
  }
}

export default function Page() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const language = useLanguage()
  const permission = usePermission()
  const sdk = useSDK()
  const settings = useSettings()
  const prompt = usePrompt()
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      if (params.id) return
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
    },
  })

  const composer = createSessionComposerState()

  const workspaceKey = createMemo(() => params.dir ?? "")
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== (params.dir ?? "")) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  const isWide = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const wideReviewOpen = createMemo(() => isWide() && view().reviewPanel.opened())
  const wideFileTreeOpen = createMemo(() => isWide() && layout.fileTree.opened())
  const wideSidePanelOpen = createMemo(() => wideReviewOpen() || wideFileTreeOpen())
  const sessionPanelWidth = createMemo(() => {
    if (!wideSidePanelOpen()) return "100%"
    if (wideReviewOpen()) return `${layout.session.width()}px`
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isWide() && !wideReviewOpen())

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const isChildSession = createMemo(() => !!info()?.parentID)
  const isCronSession = createMemo(() => !!(info() as { cronRunID?: string } | undefined)?.cronRunID)
  // Cron-driven sessions are read-only: the agent runs autonomously, no prompts
  // or follow-ups accepted. We piggy-back on the existing `archived` predicate
  // which already gates input, follow-ups, revert, and queue actions.
  const archived = createMemo(() => !!info()?.time.archived || isCronSession())
  const diffs = createMemo(() => (params.id ? list(sync.data.session_diff[params.id]) : []))
  const canReview = createMemo(() => !!sync.project)
  const reviewTab = createMemo(() => isWide())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return sync.data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.loading(id)
  })
  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      const base = revert ? userMessages().filter((m) => m.id < revert) : userMessages()
      return collapseEmptyCompactionTurns(base, sync.data.part, messages())
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes" | "activity",
    changes: "git" as ChangeMode,
    newSessionWorktree: "main",
    deferRender: false,
  })

  // After the central-queue migration, only the composer-edit cache lives
  // client-side. Active queue items (pending/running/failed) come from
  // `sync.data.prompt_queue[sessionID]`, populated by the server's
  // session.queue.{created,updated,removed} bus events. The `edit` slot
  // here is the staging area for "edit a queued item" — we cancel the
  // server row and stash the original payload here so the composer can
  // re-populate.
  const [followup, setFollowup] = persisted(
    Persist.serverWorkspace(sdk.scope, sdk.directory, "followup", ["followup.v2"]),
    createStore<{
      edit: Record<string, FollowupEdit | undefined>
    }>({
      edit: {},
    }),
  )

  createComputed((prev) => {
    const key = sessionKey()
    if (prev !== undefined && key !== prev) {
      const id = params.id
      const ready = !id || sync.data.message[id] !== undefined
      if (!ready) setStore("deferRender", true)
      else if (store.deferRender) setStore("deferRender", false)
    } else if (store.deferRender) {
      const id = params.id
      const ready = !id || sync.data.message[id] !== undefined
      if (ready) setStore("deferRender", false)
    }
    return key
  }, sessionKey())

  let reviewFrame: number | undefined
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
  let workingResyncTimer: number | undefined
  let workingResyncToken = 0
  let idleResyncTimer: number | undefined
  let idleResyncToken = 0
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createComputed((prev) => {
    const open = wideReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setUi("reviewSnap", false)
    })
    return open
  }, wideReviewOpen())

  const turnDiffs = createMemo(() => list(lastUserMessage()?.summary?.diffs))
  const nogit = createMemo(() => !!sync.project && sync.project.vcs !== "git")
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    if (sync.project?.vcs === "git") list.push("git")
    if (
      sync.project?.vcs === "git" &&
      sync.data.vcs?.branch &&
      sync.data.vcs?.default_branch &&
      sync.data.vcs.branch !== sync.data.vcs.default_branch
    ) {
      list.push("branch")
    }
    list.push("turn")
    return list
  })
  const mobileChanges = createMemo(() => !isWide() && store.mobileTab === "changes")
  const mobileActivity = createMemo(() => !isWide() && store.mobileTab === "activity")
  const mobilePanel = createMemo(() => !isWide() && store.mobileTab !== "session")
  const wantsReview = createMemo(() =>
    isWide() ? wideFileTreeOpen() || (wideReviewOpen() && activeTab() === "review") : store.mobileTab === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (store.changes === "git" || store.changes === "branch") return store.changes
  })
  const vcsKey = createMemo(
    () => ["session-vcs", sdk.directory, sync.data.vcs?.branch ?? "", sync.data.vcs?.default_branch ?? ""] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && sync.project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 60 * 1000,
      queryFn: mode
        ? () =>
            sdk.client.vcs
              .diff({ mode })
              .then((result) => list(result.data))
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = () => void queryClient.invalidateQueries({ queryKey: vcsKey() })
  const reviewDiffs = () => {
    if (store.changes === "git" || store.changes === "branch")
      // avoids suspense
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (store.changes === "git" || store.changes === "branch") return !vcsQuery.isPending
    return true
  }

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  function upsert(next: Project) {
    const list = globalSync.data.project
    sync.set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      globalSync.set(
        "project",
        list.map((item, i) => (i === idx ? { ...item, ...next } : item)),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      globalSync.set("project", [...list.slice(0, at), next, ...list.slice(at)])
      return
    }
    globalSync.set("project", [...list, next])
  }

  const gitMutation = useMutation(() => ({
    mutationFn: () => sdk.client.project.initGit(),
    onSuccess: (x) => {
      if (!x.data) return
      upsert(x.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    },
  }))

  function initGit() {
    if (gitMutation.isPending) return
    gitMutation.mutate()
  }

  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  const [sessionSync] = createResource(
    () => [sdk.directory, params.id] as const,
    ([directory, id]) => {
      if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshFrame = undefined
      refreshTimer = undefined
      if (!id) return

      const cached = untrack(() => sync.data.message[id] !== undefined)
      const stale = !cached
        ? false
        : (() => {
            const info = getSessionPrefetch(sdk.scope.key, directory, id)
            if (!info) return true
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (params.id !== id) return
          untrack(() => {
            if (stale) void sync.session.sync(id, { force: true, messageLimit: INITIAL_MESSAGE_PAGE_SIZE })
          })
        }, 0)
      })

      return sync.session.sync(id, { messageLimit: INITIAL_MESSAGE_PAGE_SIZE })
    },
  )

  createEffect(
    on(
      () => [sdk.directory, params.id] as const,
      ([dir, id]) => {
        if (!id) return
        const cached = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)
        if (cached) return
        untrack(() => {
          if (sdk.directory !== dir || params.id !== id) return
          void sync.session.todo(id)
        })
      },
    ),
  )

  createEffect(
    on(
      () => {
        const id = params.id
        return [
          sdk.directory,
          id,
          id ? isSessionWorking(sync.data.session_status[id], sync.data.message[id]) : false,
          id ? composer.blocked() : false,
        ] as const
      },
      ([dir, id, working, blocked]) => {
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (!working && !blocked) return
        const cached = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (sdk.directory !== dir || params.id !== id) return
            untrack(() => {
              void sync.session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  const activeMessageLimit = (id: string) => Math.max(INITIAL_MESSAGE_PAGE_SIZE, sync.data.message[id]?.length ?? 0)
  const forceVisibleSessionSync = (id: string) =>
    sync.session.sync(id, { force: true, messageLimit: activeMessageLimit(id) })
  const needsSettledIdleResync = (id: string) => hasUnansweredUserMessage(sync.data.message[id])
  const needsLiveResync = (id: string) =>
    isSessionWorking(sync.data.session_status[id], sync.data.message[id]) ||
    hasUnansweredUserMessage(sync.data.message[id])

  createEffect(
    on(
      () => {
        const id = params.id
        return [
          sdk.directory,
          id,
          id ? isSessionWorking(sync.data.session_status[id], sync.data.message[id]) : false,
        ] as const
      },
      ([dir, id, working], previous) => {
        const token = ++idleResyncToken
        if (idleResyncTimer !== undefined) window.clearTimeout(idleResyncTimer)
        idleResyncTimer = undefined
        if (!id || working) return

        const wasWorking = previous?.[2] === true
        const staleIdle = untrack(() => needsSettledIdleResync(id))
        if (!wasWorking && !staleIdle) return

        const schedule = (attempt: number, delay: number) => {
          idleResyncTimer = window.setTimeout(() => {
            idleResyncTimer = undefined
            if (token !== idleResyncToken) return
            if (sdk.directory !== dir || params.id !== id) return

            void Promise.allSettled([
              untrack(() => forceVisibleSessionSync(id)),
              sdk.client.session.status().then((x) => {
                if (token !== idleResyncToken) return
                if (sdk.directory !== dir || params.id !== id) return
                sync.set("session_status", x.data ?? {})
              }),
            ]).then(() => {
              if (token !== idleResyncToken) return
              if (sdk.directory !== dir || params.id !== id) return
              const stillStale = untrack(() => needsSettledIdleResync(id))
              if (stillStale && attempt < IDLE_RESYNC_MAX_ATTEMPTS) schedule(attempt + 1, IDLE_RESYNC_RETRY_MS)
            })
          }, delay)
        }

        schedule(1, IDLE_RESYNC_SETTLE_MS)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => {
        const id = params.id
        return [sdk.directory, id, id ? needsLiveResync(id) : false] as const
      },
      ([dir, id, needs]) => {
        const token = ++workingResyncToken
        if (workingResyncTimer !== undefined) window.clearTimeout(workingResyncTimer)
        workingResyncTimer = undefined
        if (!id || !needs) return

        const schedule = (attempt: number, delay: number) => {
          workingResyncTimer = window.setTimeout(() => {
            workingResyncTimer = undefined
            if (token !== workingResyncToken) return
            if (sdk.directory !== dir || params.id !== id) return
            void Promise.allSettled([
              untrack(() => forceVisibleSessionSync(id)),
              sdk.client.session.status().then((x) => {
                if (token !== workingResyncToken) return
                if (sdk.directory !== dir || params.id !== id) return
                sync.set("session_status", x.data ?? {})
              }),
            ]).then(() => {
              if (token !== workingResyncToken) return
              if (sdk.directory !== dir || params.id !== id) return
              const stillNeeds = untrack(() => needsLiveResync(id))
              if (stillNeeds && attempt < WORKING_RESYNC_MAX_ATTEMPTS) {
                schedule(attempt + 1, WORKING_RESYNC_INTERVAL_MS)
              }
            })
          }, delay)
        }

        schedule(1, WORKING_RESYNC_INITIAL_MS)
      },
    ),
  )

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      sessionKey,
      () => {
        setStore("messageId", undefined)
        setStore("changes", "git")
        setUi("pendingMessage", undefined)
      },
      { defer: true },
    ),
  )

  const stopVcs = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const props =
      typeof evt.details.properties === "object" && evt.details.properties
        ? (evt.details.properties as Record<string, unknown>)
        : undefined
    const file = typeof props?.file === "string" ? props.file : undefined
    if (!file || file.startsWith(".git/")) return
    refreshVcs()
  })
  onCleanup(stopVcs)

  createEffect(
    on(
      () => params.dir,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (view().terminal.opened()) {
      const id = terminal.active()
      if (id && shouldFocusTerminalOnKeyDown(event) && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked() || isChildSession() || archived()) return
      inputRef?.focus()
    }
  }

  createEffect(() => {
    const list = changesOptions()
    if (list.includes(store.changes)) return
    const next = list[0]
    if (!next) return
    setStore("changes", next)
  })

  createEffect(
    on(
      () => {
        const id = params.id
        if (!id) return false
        return isSessionWorking(sync.data.session_status[id], sync.data.message[id])
      },
      (next, prev) => {
        if (next || prev === undefined || !prev) return
        refreshVcs()
      },
      { defer: true },
    ),
  )

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  createEffect(
    on(
      sessionKey,
      () => {
        setTree({
          reviewScroll: undefined,
          pendingDiff: undefined,
          activeDiff: undefined,
        })
      },
      { defer: true },
    ),
  )

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const focusInput = () => {
    if (isChildSession()) return
    if (archived()) return
    inputRef?.focus()
  }

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    review: reviewTab,
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const activityContent = (classes?: { root?: string; section?: string }) => (
    <SessionActivityTab messages={messages()} parts={sync.data.part} onViewFile={openReviewFile} classes={classes} />
  )

  const openChatFileReference = (target: string, selection?: FileReferenceSelection) => {
    const path = file.normalize(target)
    if (!path) return
    if (selection)
      file.setSelectedLines(path, { start: selection.startLine, end: selection.endLine ?? selection.startLine })
    openReviewFile(path)
  }

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    const label = (option: ChangeMode) => {
      if (option === "git") return language.t("ui.sessionReview.title.git")
      if (option === "branch") return language.t("ui.sessionReview.title.branch")
      return language.t("ui.sessionReview.title.lastTurn")
    }

    return (
      <Select
        options={changesOptions()}
        current={store.changes}
        label={label}
        onSelect={(option) => option && setStore("changes", option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const createGit = (input: { emptyClass: string }) => (
    <div class={input.emptyClass}>
      <div class="flex flex-col gap-3">
        <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
        <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
          {language.t("session.review.noVcs.createGit.description")}
        </div>
      </div>
      <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
        {gitMutation.isPending
          ? language.t("session.review.noVcs.createGit.actionLoading")
          : language.t("session.review.noVcs.createGit.action")}
      </Button>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (store.changes === "git") return language.t("session.review.noUncommittedChanges")
    if (store.changes === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (store.changes === "git" || store.changes === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (store.changes === "turn") {
      if (nogit()) return createGit(input)
      return empty(reviewEmptyText())
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={!store.deferRender}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(input)}
        diffs={reviewDiffs}
        view={view}
        diffStyle={input.diffStyle}
        onDiffStyleChange={input.onDiffStyleChange}
        onScrollRef={(el) => setTree("reviewScroll", el)}
        focusedFile={tree.activeDiff}
        onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
        onLineCommentUpdate={updateCommentInContext}
        onLineCommentDelete={removeCommentFromContext}
        lineCommentActions={reviewCommentActions()}
        commentMentions={{
          items: file.searchFilesAndDirectories,
        }}
        comments={comments.all()}
        focusedComment={comments.focus()}
        onFocusedCommentChange={comments.setFocus}
        onViewFile={openReviewFile}
        classes={input.classes}
      />
    </Show>
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  const activityPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="relative flex-1 min-h-0 overflow-hidden">{activityContent()}</div>
    </div>
  )

  const sessionLoading = () => (
    <div class="size-full flex items-center justify-center bg-background-stronger text-text-weak">
      <Spinner class="size-4" />
    </div>
  )

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    setTree({ activeDiff: path, pendingDiff: path })
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  createEffect(() => {
    const id = params.id
    if (!id) return

    if (!wantsReview()) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  createEffect(
    on(
      () => [sessionKey(), wantsReview()] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = params.id
        if (!id) return
        if (!untrack(() => sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (sessionKey() !== key) return
            void sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!isWide()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  createEffect(
    on(
      () => sdk.directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined
  let contentResizeFrame: number | undefined
  let promptResizeFrame: number | undefined
  let pendingDockHeight = 0

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom && ui.scroll.jump === jump) return
    setUi("scroll", { overflow, bottom, jump })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return

      updateScrollState(target)
    })
  }

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  let fill = () => {}

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  const markUserScroll = () => {
    scrollMark += 1
  }

  createResizeObserver(
    () => content,
    () => {
      if (contentResizeFrame !== undefined) return
      contentResizeFrame = requestAnimationFrame(() => {
        contentResizeFrame = undefined
        const el = scroller
        if (el) scheduleScrollState(el)
        fill()
      })
    },
  )

  const historyWindow = createSessionHistoryWindow({
    sessionID: () => params.id,
    messagesReady,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!params.id || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (historyWindow.turnStart() <= 0 && !historyMore()) return

      void historyWindow.loadAndReveal()
    })
  }

  createEffect(
    on(
      () =>
        [
          params.id,
          messagesReady(),
          historyWindow.turnStart(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, start, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (start <= 0 && !more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => {
    return isSessionWorking(sync.data.session_status[sessionID], sync.data.message[sessionID])
  }

  // Server-authoritative queue: rows come from `sync.data.prompt_queue` —
  // populated by the snapshot fetch below and kept fresh by the
  // session.queue.{created,updated,removed} bus events. We display
  // pending + running + failed (failed stays so the user sees the error
  // and can dismiss explicitly). The active turn lives at the head of the
  // list with status === "running", followed by pending rows in run order.
  const serverQueue = createMemo(() => {
    const id = params.id
    if (!id) return [] as PromptQueueJob[]
    return sync.data.prompt_queue[id] ?? []
  })

  // Dock shows only items that are actually waiting — pending and failed.
  // Running jobs are the active turn, already represented in the timeline
  // (the user message + the streaming assistant). Showing them in the
  // dock too made the dock label "N queued messages" lie about the very
  // first send into an idle session, where the freshly-submitted message
  // immediately flips to running and showed up as if it were still queued
  // — user-reported bug v29.0.18 → v29.0.20: "I send a message, it sends
  // AND adds to queue but never processes queue, wtf."
  const queuedJobs = createMemo(() =>
    serverQueue().filter((job) => job.status === "pending" || job.status === "failed"),
  )

  const editingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    return followup.edit[id]
  })

  // Reverse-engineer a preview line from the server-side payload. Format:
  //   `{ parts: [{ type: "text", text: "..." } | { type: "file", ... }], ... }`
  // — see `buildRequestParts`. We pick the first non-empty text line; if
  // none, surface an attachment placeholder.
  const previewFromPayload = (payload: string) => {
    let parsed: { parts?: Array<{ type?: string; text?: string; filename?: string; path?: string }> }
    try {
      parsed = JSON.parse(payload)
    } catch {
      return `[${language.t("common.attachment")}]`
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
    if (file?.filename) return `[file:${file.filename}]`
    return `[${language.t("common.attachment")}]`
  }

  // The dock cares about active items only — pending + failed. (Running is
  // the in-flight turn; the timeline already represents it.) For each row
  // we surface the preview text the user originally typed.
  const followupDock = createMemo(() =>
    queuedJobs().map((job) => ({ id: job.id, text: previewFromPayload(job.payload) })),
  )

  // No `sending` indicator anymore — the server runs jobs as soon as the
  // active turn finishes, so there's no client-side "sending" gap. We
  // expose `undefined` here to keep the composer-region prop shape stable.
  const sendingFollowup = createMemo<string | undefined>(() => undefined)

  const queueEnabled = createMemo(() => {
    const id = params.id
    if (!id) return false
    return (
      settings.general.followup() === "queue" && busy(id) && !composer.blocked() && !isChildSession() && !archived()
    )
  })

  // Enqueue: hand the draft straight to the server's persistent queue via
  // promptAsync. The server FIFOs per session, survives our disconnect, and
  // broadcasts `session.queue.created` so the dock fills in within one
  // round-trip. No local store — the old `followup.items` is gone.
  // Re-snapshot the server queue for a session. Used both on session change
  // (initial paint) and as a defensive sweep after we send a control command
  // (enqueue / cancel / reorder) — if a single SSE event drops on the floor,
  // refetching keeps the dock in sync with what the server actually has.
  const refreshQueue = (sessionID: string, directory: string) => {
    const client =
      directory === sdk.directory
        ? sdk.client
        : sdk.createClient({ directory, throwOnError: true })
    return client.session.queue
      .list({ sessionID })
      .then((res) => {
        if (sdk.directory !== directory) return
        const [, setStore] = globalSync.child(directory, { bootstrap: false })
        if (!res.data) return
        setStore("prompt_queue", sessionID, reconcile(res.data))
      })
      .catch(() => {
        /* Best effort — SSE events will reconcile later. */
      })
  }

  const queueFollowup = (draft: FollowupDraft) => {
    const client =
      draft.sessionDirectory === sdk.directory
        ? sdk.client
        : sdk.createClient({ directory: draft.sessionDirectory, throwOnError: true })

    // Refresh the dock IMMEDIATELY before the API call so the user gets
    // visual feedback that something happened — without this, the dock
    // empty-state lingers until the round-trip completes (~50-200ms
    // typically, longer on slow connections). The refresh is idempotent
    // and a no-op if the server hasn't enqueued yet; the post-promise
    // refresh below catches the newly-enqueued row.
    void sendFollowupDraft({
      client,
      sync,
      globalSync,
      draft,
      // Session is already busy when we queue; an optimistic busy flip
      // would clobber a real status update from the server.
      optimisticBusy: false,
      // The dock is the user-facing representation for queued messages.
      // Skip the optimistic timeline entry — otherwise the same message
      // appears in both the timeline AND the dock, and a transient API
      // error removes the timeline copy (looks like "the message just
      // disappeared"). Keep one source of truth: the server's queue.
      optimisticMessage: false,
    })
      .then(() => {
        // Refresh the queue snapshot so the dock fills in even if the
        // session.queue.created SSE event got dropped or hasn't arrived yet.
        // Cheap (one HTTP round-trip) and idempotent (reducer dedupes by id).
        void refreshQueue(draft.sessionID, draft.sessionDirectory)
      })
      .catch((err) => fail(err))
  }

  // "Send now": promote the chosen pending job to the head of its session
  // queue. Server already runs head-of-queue next as soon as the active
  // turn finishes, so this is just a reorder. We pass the current order
  // with the chosen id moved to the front.
  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    const list = (sync.data.prompt_queue[sessionID] ?? []).filter((j) => j.status === "pending")
    const target = list.find((j) => j.id === id)
    if (!target) return Promise.resolve()
    const reordered = [target.id, ...list.filter((j) => j.id !== target.id).map((j) => j.id)]
    if (opts?.manual) resumeScroll()
    return sdk.client.session.queue
      .reorder({ sessionID, jobIDs: reordered })
      .catch((err) => fail(err))
      .then(() => undefined)
  }

  // Edit: cancel the server row, then pre-fill the composer with a best-
  // effort text reconstruction. We can't recover the original Prompt
  // (images, file context, etc.) because the payload only carries the
  // wire-format parts the server received. Good enough for v1 — the user
  // can re-attach files/images if needed.
  const editFollowup = (id: string) => {
    const sessionID = params.id
    if (!sessionID) return
    const job = serverQueue().find((entry) => entry.id === id)
    if (!job) return

    void sdk.client.session.queue
      .cancel({ sessionID, jobID: job.id })
      .then(() => refreshQueue(sessionID, sdk.directory))
      .catch((err) => fail(err))

    let parsed: { parts?: Array<{ type?: string; text?: string }> } = {}
    try {
      parsed = JSON.parse(job.payload)
    } catch {
      /* leave parsed empty — composer will load with no prefill */
    }
    const text = (parsed.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
    setFollowup("edit", sessionID, {
      id: job.id,
      prompt: text ? [{ type: "text", content: text, start: 0, end: text.length }] : [],
      context: [],
    })
  }

  const deleteFollowup = (id: string) => {
    const sessionID = params.id
    if (!sessionID) return
    setFollowup("edit", sessionID, (value) => (value?.id === id ? undefined : value))
    void sdk.client.session.queue
      .cancel({ sessionID, jobID: id })
      .then(() => refreshQueue(sessionID, sdk.directory))
      .catch((err) => fail(err))
  }

  // Reorder: pass the full intended order through to the server. The server
  // validates that every id refers to a pending row in this session and
  // rewrites sort_order atomically. On 409 (something raced — a worker
  // claim, an external cancel) we silently swallow: the next sync event
  // will reconcile the dock to whatever actually happened.
  const reorderFollowup = (sessionID: string, ids: string[]) => {
    if (ids.length === 0) return
    void sdk.client.session.queue
      .reorder({ sessionID, jobIDs: ids })
      .then(() => refreshQueue(sessionID, sdk.directory))
      .catch((err) => {
        // 409 conflict (row state changed mid-flight) is expected during
        // rapid drag interactions; refresh the snapshot so the dock matches
        // what the server actually has.
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 409) {
          void refreshQueue(sessionID, sdk.directory)
          return
        }
        fail(err)
      })
  }

  const clearFollowupEdit = () => {
    const id = params.id
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  const halt = (sessionID: string) =>
    busy(sessionID) ? sdk.client.session.abort({ sessionID }).catch(() => {}) : Promise.resolve()

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const prev = prompt.current().slice()
      const last = info()?.revert
      const value = draft(input.messageID)
      batch(() => {
        roll(input.sessionID, { messageID: input.messageID })
        prompt.set(value)
      })
      await halt(input.sessionID)
        .then(() => sdk.client.session.revert(input))
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(input.sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = params.id
      if (!sessionID) return

      const next = userMessages().find((item) => item.id > id)
      const prev = prompt.current().slice()
      const last = info()?.revert

      batch(() => {
        roll(sessionID, next ? { messageID: next.id } : undefined)
        if (next) {
          prompt.set(draft(next.id))
          return
        }
        prompt.reset()
      })

      const task = !next
        ? halt(sessionID).then(() => sdk.client.session.unrevert({ sessionID }))
        : halt(sessionID).then(() =>
            sdk.client.session.revert({
              sessionID,
              messageID: next.id,
            }),
          )

      await task
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (archived()) return
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (archived()) return
    if (!params.id || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const timelineActions = createMemo(() => (archived() ? undefined : { revert }))

  // Snapshot the server queue on session change so the dock paints
  // immediately, then rely on the SSE event stream to keep it fresh. The
  // snapshot races with the bus events: the reducer is idempotent (drop
  // duplicate Created, treat unknown Updated as create) so the order
  // doesn't matter.
  createEffect(
    on(
      () => [sdk.directory, params.id] as const,
      ([dir, id]) => {
        if (!id) return
        const startedDir = dir
        const startedID = id
        void sdk.client.session.queue
          .list({ sessionID: id })
          .then((res) => {
            if (sdk.directory !== startedDir || params.id !== startedID) return
            if (!res.data) return
            sync.set("prompt_queue", id, reconcile(res.data))
          })
          .catch(() => {
            // Snapshot failed (e.g. session not yet visible on server) —
            // bus events will fill in as soon as the first enqueue lands.
          })
      },
    ),
  )

  // Defensive periodic refresh while the session is busy. The reducer
  // already handles `session.queue.*` events, and explicit control
  // commands trigger a refresh — but if an SSE event drops silently
  // (network blip, mid-flight reconnect), the dock can drift from the
  // server's actual queue and items appear "stuck" or fail to remove
  // after they complete. A 3s poll while busy guarantees convergence
  // without thrashing the server: idle sessions don't poll at all.
  createEffect(() => {
    const id = params.id
    if (!id) return
    if (!busy(id)) return
    const dir = sdk.directory
    const interval = window.setInterval(() => {
      void refreshQueue(id, dir)
    }, 3_000)
    onCleanup(() => window.clearInterval(interval))
  })

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      pendingDockHeight = Math.ceil(height)
      if (promptResizeFrame !== undefined) return
      promptResizeFrame = requestAnimationFrame(() => {
        promptResizeFrame = undefined
        const next = pendingDockHeight

        if (next === dockHeight) return

        const el = scroller
        const delta = next - dockHeight
        const stick = el
          ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
          : false

        dockHeight = next

        if (stick) autoScroll.forceScrollToBottom()

        if (el) scheduleScrollState(el)
        fill()
      })
    },
  )

  onCleanup(() => {
    if (contentResizeFrame !== undefined) cancelAnimationFrame(contentResizeFrame)
    if (promptResizeFrame !== undefined) cancelAnimationFrame(promptResizeFrame)
  })

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    turnStart: historyWindow.turnStart,
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setActiveMessage,
    setTurnStart: historyWindow.setTurnStart,
    autoScroll,
    scroller: () => scroller,
    anchor,
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) requestAnimationFrame(() => inputRef?.focus())
      },
    ),
  )

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
  })

  onCleanup(() => {
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (workingResyncTimer !== undefined) window.clearTimeout(workingResyncTimer)
    if (idleResyncTimer !== undefined) window.clearTimeout(idleResyncTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  return (
    <FileReferenceProvider open={openChatFileReference}>
      <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
        {sessionSync() ?? ""}
        <SessionHeader />
        <div class="flex-1 min-h-0 flex flex-col md:flex-row">
          <Show when={!isWide() && !!params.id}>
            <Tabs value={store.mobileTab} class="h-auto">
              <Tabs.List>
                <Tabs.Trigger
                  value="session"
                  class="!w-1/3 !max-w-none"
                  classes={{ button: "w-full" }}
                  onClick={() => setStore("mobileTab", "session")}
                >
                  {language.t("session.tab.session")}
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="changes"
                  class="!w-1/3 !max-w-none"
                  classes={{ button: "w-full" }}
                  onClick={() => setStore("mobileTab", "changes")}
                >
                  {reviewCount() > 0
                    ? reviewCount() +
                      " " +
                      language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")
                    : language.t("session.review.change.other")}
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="activity"
                  class="!w-1/3 !max-w-none !border-r-0"
                  classes={{ button: "w-full" }}
                  onClick={() => setStore("mobileTab", "activity")}
                >
                  {language.t("session.activity.timeline.title")}
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </Show>

          {/* Session panel */}
          <div
            classList={{
              "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger flex-1 md:flex-none": true,
              "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !size.active() && !ui.reviewSnap,
            }}
            style={{
              width: sessionPanelWidth(),
            }}
          >
            <div class="flex-1 min-h-0 overflow-hidden">
              <Switch>
                <Match when={params.id}>
                  <Show when={messagesReady()} fallback={sessionLoading()}>
                    <MessageTimeline
                      mobileChanges={mobilePanel()}
                      mobileFallback={
                        mobileActivity()
                          ? activityContent({ root: "h-full overflow-y-auto pb-8", section: "px-4" })
                          : reviewContent({
                              diffStyle: "unified",
                              classes: {
                                root: "pb-8",
                                header: "px-4",
                                container: "px-4",
                              },
                              loadingClass: "px-4 py-4 text-text-weak",
                              emptyClass:
                                "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                            })
                      }
                      actions={timelineActions()}
                      scroll={ui.scroll}
                      onResumeScroll={resumeScroll}
                      setScrollRef={setScrollRef}
                      onScheduleScrollState={scheduleScrollState}
                      onAutoScrollHandleScroll={autoScroll.handleScroll}
                      onMarkScrollGesture={markScrollGesture}
                      hasScrollGesture={hasScrollGesture}
                      onUserScroll={markUserScroll}
                      onTurnBackfillScroll={historyWindow.onScrollerScroll}
                      onAutoScrollInteraction={autoScroll.handleInteraction}
                      centered={centered()}
                      setContentRef={(el) => {
                        content = el
                        autoScroll.contentRef(el)

                        const root = scroller
                        if (root) scheduleScrollState(root)
                      }}
                      turnStart={historyWindow.turnStart()}
                      historyMore={historyMore()}
                      historyLoading={historyLoading()}
                      onLoadEarlier={() => {
                        void historyWindow.loadAndReveal()
                      }}
                      renderedUserMessages={historyWindow.renderedUserMessages()}
                      anchor={anchor}
                    />
                  </Show>
                </Match>
                <Match when={true}>
                  <NewSessionView worktree={newSessionWorktree()} />
                </Match>
              </Switch>
            </div>

            <SessionComposerRegion
              state={composer}
              ready={!store.deferRender && messagesReady()}
              centered={centered()}
              inputRef={(el) => {
                inputRef = el
              }}
              newSessionWorktree={newSessionWorktree()}
              onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
              onSubmit={() => {
                comments.clear()
                resumeScroll()
              }}
              onResponseSubmit={resumeScroll}
              followup={
                params.id && !isChildSession() && !archived()
                  ? {
                      queue: queueEnabled,
                      items: followupDock(),
                      sending: sendingFollowup(),
                      edit: editingFollowup(),
                      onQueue: queueFollowup,
                      // With the server-authoritative queue, there's no
                      // client-side dispatch loop to pause. We map abort to
                      // a session-wide cancel: stops the in-flight turn AND
                      // drops every pending queued job, matching the user's
                      // intent of "stop everything".
                      onAbort: () => {
                        const id = params.id
                        if (!id) return
                        void sdk.client.session.abort({ sessionID: id }).catch((err) => fail(err))
                      },
                      onSend: (id) => {
                        void sendFollowup(params.id!, id, { manual: true })
                      },
                      onEdit: editFollowup,
                      onDelete: deleteFollowup,
                      onReorder: (ids) => {
                        const id = params.id
                        if (!id) return
                        reorderFollowup(id, ids)
                      },
                      onEditLoaded: clearFollowupEdit,
                    }
                  : undefined
              }
              revert={
                !archived() && rolled().length > 0
                  ? {
                      items: rolled(),
                      restoring: restoring(),
                      disabled: reverting(),
                      onRestore: restore,
                    }
                  : undefined
              }
              setPromptDockRef={(el) => {
                promptDock = el
              }}
            />

            <Show when={wideReviewOpen()}>
              <div onPointerDown={() => size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  size={layout.session.width()}
                  min={450}
                  max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
                  onResize={(width) => {
                    size.touch()
                    layout.session.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>

          <SessionSidePanel
            canReview={canReview}
            diffs={reviewDiffs}
            diffsReady={reviewReady}
            empty={reviewEmptyText}
            hasReview={hasReview}
            reviewCount={reviewCount}
            activityPanel={activityPanel}
            reviewPanel={reviewPanel}
            activeDiff={tree.activeDiff}
            focusReviewDiff={focusReviewDiff}
            reviewSnap={ui.reviewSnap}
            size={size}
          />
        </div>

        <TerminalPanel />
      </div>
    </FileReferenceProvider>
  )
}
