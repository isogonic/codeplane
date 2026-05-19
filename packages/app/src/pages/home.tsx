import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { DateTime } from "luxon"
import { useNavigate } from "@solidjs/router"
import { Avatar } from "@codeplane-ai/ui/avatar"
import { base64Encode } from "@codeplane-ai/shared/util/encode"
import { useGlobalSync } from "@/context/global-sync"
import { displayName } from "@/pages/layout/helpers"
import { useLayout, getAvatarColors } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { sessionTitle } from "@/utils/session-title"
import {
  aggregateProjects,
  recentSessions,
  type DayBucket,
  type ModelStat,
  type ProjectAggregate,
  type Range,
  type RecentSession,
  type Totals,
} from "./home/stats"
import { pickFunFact } from "./home/fun-facts"
import { createHomeCache } from "./home/cache"
import { combineAggregates, heatmapBuckets, modelBreakdown, preferredModel } from "./home/aggregate"
import { AnimatedNumber } from "./home/animated-number"

const RANGES: Range[] = ["all", "30d", "7d"]
const RANGE_LABEL_KEY = {
  all: "home.range.all",
  "30d": "home.range.30d",
  "7d": "home.range.7d",
} as const
const HEATMAP_ROWS = 7
const HEATMAP_COLS = 52
const HEATMAP_GAP_PX = 3

export default function Home() {
  const layout = useLayout()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const providers = useProviders()
  const cache = createHomeCache()

  const [range, setRange] = createSignal<Range>("all")
  const [tab, setTab] = createSignal<"overview" | "models">("overview")
  const [tick, setTick] = createSignal(0)

  // Re-tick every 30s so stats stay live even when nothing else triggers
  // re-render (counts shift when a long-running session writes a new message).
  const interval = setInterval(() => setTick((t) => t + 1), 30_000)
  onCleanup(() => clearInterval(interval))

  const formatNumber = createMemo(() => new Intl.NumberFormat(language.intl()))
  const formatRelative = (time: number) =>
    DateTime.fromMillis(time).setLocale(language.intl()).toRelative() ?? ""
  const formatHour = (hour: number) =>
    new Intl.DateTimeFormat(language.intl(), { hour: "numeric" }).format(new Date(2000, 0, 1, hour))

  const emptyDiffRefresh = new Set<string>()
  const diffRefreshKey = (worktree: string, session: { id: string; time: { created: number; updated?: number } }) =>
    `${worktree}\n${session.id}\n${session.time.updated ?? session.time.created}`
  const inflightMessageFetch = new Set<string>()

  // Sessions with their containing project, refreshed whenever the project list
  // or any project's session store changes.
  const projectInputs = createMemo(() => {
    tick()
    return layout.projects.list().map((project) => {
      const [child] = globalSync.child(project.worktree, { bootstrap: false })
      return {
        directory: project.worktree,
        worktree: project.worktree,
        name: displayName(project),
        iconColor: project.icon?.color,
        sessions: child.session ?? [],
        sessionDiffs: child.session_diff,
      }
    })
  })

  // Drop cached aggregates for sessions that no longer exist (deleted projects,
  // archived sessions). Runs whenever the session list changes.
  createEffect(() => {
    const alive: string[] = []
    for (const project of projectInputs()) {
      for (const session of project.sessions) {
        if (session.parentID || session.time?.archived) continue
        alive.push(session.id)
      }
    }
    cache.syncWithSessionList(alive)
  })

  // Fetch full message history for every stale session and write the
  // aggregate straight to cache. Uses a dedicated stats-only API path so the
  // session-detail page's paginated message store can never clobber the
  // home aggregates (and vice versa).
  createEffect(() => {
    for (const project of projectInputs()) {
      for (const session of project.sessions) {
        if (session.parentID || session.time?.archived) continue
        const updatedAt = session.time.updated ?? session.time.created
        const inflightKey = `${project.worktree}\n${session.id}\n${updatedAt}`
        if (inflightMessageFetch.has(inflightKey)) continue
        if (!cache.isStale(session.id, updatedAt)) continue
        inflightMessageFetch.add(inflightKey)
        const worktree = project.worktree
        const sessionID = session.id
        void (async () => {
          try {
            const messages = (await globalSync.project.fetchSessionMessagesForStats(worktree, sessionID)) as never
            cache.applyMessages(sessionID, updatedAt, messages)
          } catch {
            // Best-effort — leave the previous cached aggregate untouched and
            // retry on the next session.updated event tick.
          } finally {
            inflightMessageFetch.delete(inflightKey)
          }
        })()
      }
    }
  })

  // Diffs for sessions whose summary doesn't tell us about file changes.
  createEffect(() => {
    layout.projects.list().forEach((project) => {
      const [child] = globalSync.child(project.worktree, { bootstrap: false })
      const sessions = child.session
        .filter((session) => !session.parentID && !session.time?.archived)
        .filter(
          (session) =>
            (session.summary?.files ?? 0) === 0 ||
            (session.summary?.additions ?? 0) + (session.summary?.deletions ?? 0) === 0,
        )
        .filter((session) => {
          const cached = child.session_diff[session.id]
          if (cached === undefined) return true
          if (cached.length > 0) return false
          return !emptyDiffRefresh.has(diffRefreshKey(project.worktree, session))
        })
        .map((session) => ({ id: session.id, key: diffRefreshKey(project.worktree, session) }))
      if (sessions.length === 0) return
      sessions.forEach((session) => emptyDiffRefresh.add(session.key))
      void globalSync.project.loadSessionDiffs(
        project.worktree,
        sessions.map((session) => session.id),
        { force: true },
      )
    })
  })

  // Build stats from the cache. Recomputes whenever the cache store changes
  // (which happens after each aggregate.applyMessages call).
  const stats = createMemo(() => {
    tick()
    // Force dependency on the aggregate store so we re-run when it updates.
    const aggregates = Object.values(cache.store.aggregates)
    const now = Date.now()
    const r = range()

    const projects = projectInputs()
    const projectAggregates = aggregateProjects(
      projects.map((project) => ({
        directory: project.directory,
        worktree: project.worktree,
        name: project.name,
        iconColor: project.iconColor,
        sessions: project.sessions,
        sessionDiffs: project.sessionDiffs,
      })),
    )
    const visibleSessions = projects.flatMap((project) =>
      project.sessions.filter((session) => !session.parentID && !session.time?.archived),
    )
    const dayStart = (() => {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    })()
    const weekStart = dayStart - 6 * 24 * 60 * 60 * 1000
    const sessionTime = (session: { time: { created: number; updated?: number } }) =>
      session.time.updated ?? session.time.created

    const combined = combineAggregates(aggregates, now, r)
    const totals: Totals = {
      projects: projectAggregates.length,
      sessions: visibleSessions.length,
      archived: projectAggregates.reduce((total, project) => total + project.archived, 0),
      files: projectAggregates.reduce((total, project) => total + project.files, 0),
      additions: projectAggregates.reduce((total, project) => total + project.additions, 0),
      deletions: projectAggregates.reduce((total, project) => total + project.deletions, 0),
      today: visibleSessions.filter((session) => sessionTime(session) >= dayStart).length,
      thisWeek: visibleSessions.filter((session) => sessionTime(session) >= weekStart).length,
      lastActivity: projectAggregates.reduce<number | undefined>((max, project) => {
        const value = project.lastActivity
        if (value === undefined) return max
        if (max === undefined) return value
        return value > max ? value : max
      }, undefined),
      ...combined,
      preferredModel: preferredModel(aggregates, r, now),
    }
    const recent = recentSessions(
      projects.map((project) => ({
        directory: project.directory,
        worktree: project.worktree,
        name: project.name,
        iconColor: project.iconColor,
        sessions: project.sessions,
        sessionDiffs: project.sessionDiffs,
      })),
    )

    return {
      totals,
      projects: projectAggregates,
      recent,
      buckets: heatmapBuckets(aggregates, now),
      models: modelBreakdown(aggregates, r, now),
    }
  })


  const openProject = (worktree: string) => {
    navigate(`/${base64Encode(worktree)}`)
  }
  const openSession = (item: RecentSession) => {
    navigate(`/${base64Encode(item.worktree)}/session/${item.id}`)
  }

  const subtitleText = () => {
    const total = stats().totals.projects
    if (total === 0) return language.t("home.subtitle.zero")
    if (total === 1) return language.t("home.subtitle.one")
    return language.t("home.subtitle.other", { count: total })
  }
  const sessionsCountLabel = (count: number) =>
    count === 1
      ? language.t("home.projects.sessionsCount.one")
      : language.t("home.projects.sessionsCount.other", { count })
  const formattedDiff = (additions: number, deletions: number) =>
    language.t("home.projects.diff", {
      additions: formatNumber().format(additions),
      deletions: formatNumber().format(deletions),
    })

  const modelDisplayName = (modelID: string, providerID?: string) => {
    if (!modelID) return modelID
    const all = providers.all()
    if (providerID) {
      const provider = all.find((p) => p.id === providerID)
      const model = provider?.models[modelID]
      if (model?.name) return model.name
    }
    for (const provider of all) {
      const model = provider.models[modelID]
      if (model?.name) return model.name
    }
    return modelID
  }

  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:gap-6 sm:px-6 sm:py-8">
        <Header
          subtitleText={subtitleText}
          lastActivity={() => stats().totals.lastActivity}
          formatRelative={formatRelative}
        />

        <StatsPanel
          tab={tab}
          setTab={setTab}
          range={range}
          setRange={setRange}
          totals={() => stats().totals}
          buckets={() => stats().buckets}
          models={() => stats().models}
          formatNumber={formatNumber}
          formatHour={formatHour}
          modelDisplayName={modelDisplayName}
        />

        <div class="grid grid-cols-1 gap-6">
          <ProjectsSection
            projects={() => stats().projects}
            onSelect={openProject}
            tTitle={language.t("home.projects.title")}
            tEmpty={language.t("home.projects.empty")}
            tNever={language.t("home.projects.never")}
            sessionsCountLabel={sessionsCountLabel}
            formattedDiff={formattedDiff}
            formatNumber={formatNumber}
            formatRelative={formatRelative}
          />
          <RecentSection
            recent={() => stats().recent}
            onSelect={openSession}
            tTitle={language.t("home.recent.title")}
            tEmpty={language.t("home.recent.empty")}
            formatRelative={formatRelative}
          />
        </div>
      </div>
    </div>
  )
}

function Header(props: {
  subtitleText: () => string
  lastActivity: () => number | undefined
  formatRelative: (time: number) => string
}) {
  const language = useLanguage()
  return (
    <div class="shrink-0 flex items-center justify-between gap-4 border-b border-border-weak-base pb-4">
      <div class="min-w-0">
        <div class="text-20-medium text-text-strong truncate">{language.t("home.title")}</div>
        <div class="text-12-regular text-text-weak">{props.subtitleText()}</div>
      </div>
      <Show when={props.lastActivity()} keyed>
        {(time) => (
          <div class="shrink-0 text-12-regular text-text-weak">
            {language.t("home.subtitle.lastActivity", { time: props.formatRelative(time) })}
          </div>
        )}
      </Show>
    </div>
  )
}

function StatsPanel(props: {
  tab: () => "overview" | "models"
  setTab: (value: "overview" | "models") => void
  range: () => Range
  setRange: (value: Range) => void
  totals: () => Totals
  buckets: () => DayBucket[]
  models: () => ModelStat[]
  formatNumber: () => Intl.NumberFormat
  formatHour: (hour: number) => string
  modelDisplayName: (modelID: string, providerID?: string) => string
}) {
  const language = useLanguage()
  return (
    <section class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
      <div class="flex items-center justify-between gap-3 border-b border-border-weaker-base px-3 py-2 sm:px-4">
        <PillGroup
          value={props.tab()}
          onChange={(value) => props.setTab(value as "overview" | "models")}
          options={[
            { value: "overview", label: language.t("home.tab.overview") },
            { value: "models", label: language.t("home.tab.models") },
          ]}
        />
        <PillGroup
          value={props.range()}
          onChange={(value) => props.setRange(value as Range)}
          options={RANGES.map((r) => ({ value: r, label: language.t(RANGE_LABEL_KEY[r]) }))}
        />
      </div>
      <Show when={props.tab() === "overview"}>
        <OverviewTab
          totals={props.totals}
          buckets={props.buckets}
          formatNumber={props.formatNumber}
          formatHour={props.formatHour}
          modelDisplayName={props.modelDisplayName}
        />
      </Show>
      <Show when={props.tab() === "models"}>
        <ModelsTab models={props.models} formatNumber={props.formatNumber} modelDisplayName={props.modelDisplayName} />
      </Show>
    </section>
  )
}

function PillGroup<T extends string>(props: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div class="inline-flex items-center gap-0.5 rounded-md bg-surface-base p-0.5">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class="rounded px-2.5 py-1 text-12-medium tabular-nums transition-colors"
            classList={{
              "bg-background-base text-text-strong shadow-[var(--shadow-xs)]": props.value === option.value,
              "text-text-weak hover:text-text-base": props.value !== option.value,
            }}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

function OverviewTab(props: {
  totals: () => Totals
  buckets: () => DayBucket[]
  formatNumber: () => Intl.NumberFormat
  formatHour: (hour: number) => string
  modelDisplayName: (modelID: string, providerID?: string) => string
}) {
  const language = useLanguage()
  const tokenFormatter = createMemo(
    () => new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }),
  )
  const fact = createMemo(() => pickFunFact(props.totals(), Date.now()))

  return (
    <>
      <div class="grid grid-cols-2 gap-px bg-border-weaker-base sm:grid-cols-4">
        <NumericStat
          label={language.t("home.stat.sessions")}
          value={props.totals().sessions}
          format={(v) => props.formatNumber().format(Math.round(v))}
        />
        <NumericStat
          label={language.t("home.stat.messages")}
          value={props.totals().messages}
          format={(v) => props.formatNumber().format(Math.round(v))}
        />
        <NumericStat
          label={language.t("home.stat.tokens")}
          value={props.totals().tokens}
          format={(v) => tokenFormatter().format(Math.round(v))}
        />
        <NumericStat
          label={language.t("home.stat.activeDays")}
          value={props.totals().activeDays}
          format={(v) => props.formatNumber().format(Math.round(v))}
        />
        <NumericStat
          label={language.t("home.stat.streak.current")}
          value={props.totals().currentStreak}
          format={(v) => language.t("home.stat.streak.value", { count: Math.round(v) })}
        />
        <NumericStat
          label={language.t("home.stat.streak.longest")}
          value={props.totals().longestStreak}
          format={(v) => language.t("home.stat.streak.value", { count: Math.round(v) })}
        />
        <TextStat
          label={language.t("home.stat.peakHour")}
          value={props.totals().peakHour !== undefined ? props.formatHour(props.totals().peakHour!) : "—"}
        />
        <TextStat
          label={language.t("home.stat.preferredModel")}
          value={
            props.totals().preferredModel
              ? props.modelDisplayName(
                  props.totals().preferredModel!.modelID,
                  props.totals().preferredModel!.providerID,
                )
              : "—"
          }
        />
      </div>

      <div class="px-3 py-4 sm:px-4">
        <Heatmap buckets={props.buckets} formatNumber={props.formatNumber} />
      </div>

      <Show when={fact()} keyed>
        {(f) => (
          <div class="border-t border-border-weaker-base px-3 py-2 text-12-regular text-text-weak sm:px-4">
            {language.t(f.key as Parameters<typeof language.t>[0], f.params)}
          </div>
        )}
      </Show>
    </>
  )
}

function ModelsTab(props: {
  models: () => ModelStat[]
  formatNumber: () => Intl.NumberFormat
  modelDisplayName: (modelID: string, providerID?: string) => string
}) {
  const language = useLanguage()
  const tokenFormatter = createMemo(
    () => new Intl.NumberFormat(language.intl(), { notation: "compact", maximumFractionDigits: 1 }),
  )
  return (
    <Show
      when={props.models().length > 0}
      fallback={
        <div class="px-4 py-10 text-center text-12-regular text-text-weak">{language.t("home.models.empty")}</div>
      }
    >
      <div class="divide-y divide-border-weaker-base">
        <For each={props.models()}>
          {(model) => {
            const peak = props.models()[0]?.messages ?? 1
            return (
              <div class="flex items-center gap-3 px-3 py-3 sm:px-4">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-3">
                    <span class="truncate text-14-medium text-text-strong">
                      {props.modelDisplayName(model.modelID, model.providerID)}
                    </span>
                    <span class="shrink-0 text-12-regular text-text-base tabular-nums">
                      {language.t("home.models.messages", { count: props.formatNumber().format(model.messages) })}
                    </span>
                  </div>
                  <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-base">
                    <div
                      class="h-full rounded-full bg-[color-mix(in_srgb,var(--text-interactive-base)_55%,transparent)]"
                      style={{ width: `${Math.round((model.messages / Math.max(peak, 1)) * 100)}%` }}
                    />
                  </div>
                  <div class="mt-1.5 flex items-center justify-between gap-3 text-12-regular text-text-weak tabular-nums">
                    <span>
                      {language.t("home.models.sessions", { count: props.formatNumber().format(model.sessions) })}
                    </span>
                    <span>{language.t("home.models.tokens", { value: tokenFormatter().format(model.tokens) })}</span>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

function TextStat(props: { label: string; value: string }) {
  return (
    <div class="min-w-0 bg-background-base px-3 py-3 sm:px-4">
      <div class="truncate text-12-regular text-text-weak">{props.label}</div>
      <div class="pt-0.5 truncate text-18-medium text-text-strong tabular-nums">{props.value}</div>
    </div>
  )
}

function NumericStat(props: { label: string; value: number; format: (value: number) => string }) {
  return (
    <div class="min-w-0 bg-background-base px-3 py-3 sm:px-4">
      <div class="truncate text-12-regular text-text-weak">{props.label}</div>
      <div class="pt-0.5 truncate text-18-medium text-text-strong tabular-nums">
        <AnimatedNumber value={props.value} format={props.format} />
      </div>
    </div>
  )
}

function Heatmap(props: { buckets: () => DayBucket[]; formatNumber: () => Intl.NumberFormat }) {
  const language = useLanguage()
  const formatDay = createMemo(
    () => new Intl.DateTimeFormat(language.intl(), { day: "numeric", month: "short", year: "numeric" }),
  )
  const peak = createMemo(() => Math.max(1, ...props.buckets().map((bucket) => bucket.count)))
  const intensity = (count: number) => {
    if (count <= 0) return 0
    const ratio = count / peak()
    if (ratio < 0.25) return 1
    if (ratio < 0.5) return 2
    if (ratio < 0.75) return 3
    return 4
  }
  const cellSize = `calc((100cqi - ${(HEATMAP_COLS - 1) * HEATMAP_GAP_PX}px) / ${HEATMAP_COLS})`

  return (
    <Show
      when={props.buckets().length > 0}
      fallback={
        <div class="rounded-md border border-dashed border-border-weaker-base px-4 py-6 text-center text-12-regular text-text-weak">
          {language.t("home.activity.empty")}
        </div>
      }
    >
      <div class="w-full" style={{ "container-type": "inline-size", "--heatmap-cell": cellSize }}>
        <div
          class="grid"
          style={{
            "grid-template-columns": `repeat(${HEATMAP_COLS}, var(--heatmap-cell))`,
            "grid-template-rows": `repeat(${HEATMAP_ROWS}, var(--heatmap-cell))`,
            "grid-auto-flow": "column",
            gap: `${HEATMAP_GAP_PX}px`,
          }}
        >
          <For each={props.buckets()}>
            {(bucket) => (
              <div
                class="rounded-[2px]"
                style={{ width: "var(--heatmap-cell)", height: "var(--heatmap-cell)" }}
                classList={{
                  "bg-[color-mix(in_srgb,var(--text-weak)_15%,transparent)]": intensity(bucket.count) === 0,
                  "bg-[color-mix(in_srgb,var(--text-interactive-base)_25%,transparent)]":
                    intensity(bucket.count) === 1,
                  "bg-[color-mix(in_srgb,var(--text-interactive-base)_45%,transparent)]":
                    intensity(bucket.count) === 2,
                  "bg-[color-mix(in_srgb,var(--text-interactive-base)_70%,transparent)]":
                    intensity(bucket.count) === 3,
                  "bg-text-interactive-base": intensity(bucket.count) === 4,
                }}
                title={language.t("home.activity.dayLabel", {
                  count: bucket.count,
                  date: formatDay().format(new Date(bucket.start)),
                })}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

function ProjectsSection(props: {
  projects: () => ProjectAggregate[]
  onSelect: (worktree: string) => void
  tTitle: string
  tEmpty: string
  tNever: string
  sessionsCountLabel: (count: number) => string
  formattedDiff: (additions: number, deletions: number) => string
  formatNumber: () => Intl.NumberFormat
  formatRelative: (time: number) => string
}) {
  const peak = createMemo(() => Math.max(1, ...props.projects().map((project) => project.sessions)))
  const top = createMemo(() => props.projects().slice(0, 6))
  return (
    <section class="flex flex-col gap-3 min-w-0">
      <div class="text-14-medium text-text-strong">{props.tTitle}</div>
      <Show
        when={top().length > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-8 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {props.tEmpty}
          </div>
        }
      >
        <div class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
          <For each={top()}>
            {(project) => (
              <button
                type="button"
                class="group flex w-full min-w-0 items-center gap-3 border-b border-border-weaker-base px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-raised-base-hover focus:outline-none focus-visible:bg-surface-raised-base-hover"
                onClick={() => props.onSelect(project.worktree)}
              >
                <Avatar
                  fallback={project.name}
                  {...getAvatarColors(project.iconColor)}
                  size="small"
                  class="size-8 shrink-0 rounded"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-3">
                    <span class="truncate text-14-medium text-text-strong">{project.name}</span>
                    <span class="shrink-0 text-12-regular text-text-base tabular-nums">
                      {props.sessionsCountLabel(project.sessions)}
                    </span>
                  </div>
                  <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-base">
                    <div
                      class="h-full rounded-full bg-[color-mix(in_srgb,var(--text-interactive-base)_55%,transparent)]"
                      style={{ width: `${Math.round((project.sessions / peak()) * 100)}%` }}
                    />
                  </div>
                  <div class="mt-1.5 flex items-center justify-between gap-3 text-12-regular text-text-weak">
                    <span class="truncate">
                      <Show when={project.lastActivity} keyed fallback={props.tNever}>
                        {(time) => <span>{props.formatRelative(time)}</span>}
                      </Show>
                    </span>
                    <Show when={project.additions + project.deletions > 0}>
                      <span class="shrink-0 tabular-nums">
                        {props.formattedDiff(project.additions, project.deletions)}
                      </span>
                    </Show>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

function RecentSection(props: {
  recent: () => RecentSession[]
  onSelect: (item: RecentSession) => void
  tTitle: string
  tEmpty: string
  formatRelative: (time: number) => string
}) {
  return (
    <section class="flex flex-col gap-3 min-w-0">
      <div class="text-14-medium text-text-strong">{props.tTitle}</div>
      <Show
        when={props.recent().length > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-8 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {props.tEmpty}
          </div>
        }
      >
        <div class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
          <For each={props.recent()}>
            {(item) => (
              <button
                type="button"
                class="group flex w-full min-w-0 items-center gap-3 border-b border-border-weaker-base px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-raised-base-hover focus:outline-none focus-visible:bg-surface-raised-base-hover"
                onClick={() => props.onSelect(item)}
              >
                <Avatar
                  fallback={item.projectName}
                  {...getAvatarColors(item.projectColor)}
                  size="small"
                  class="size-8 shrink-0 rounded"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-14-medium text-text-strong">{sessionTitle(item.title) ?? item.title}</div>
                  <div class="mt-0.5 flex items-center gap-2 text-12-regular text-text-weak">
                    <span class="truncate">{item.projectName}</span>
                    <span class="shrink-0">·</span>
                    <span class="shrink-0 tabular-nums">{props.formatRelative(item.updated)}</span>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

