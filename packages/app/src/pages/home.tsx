import { createMemo, For, Show } from "solid-js"
import { DateTime } from "luxon"
import { useNavigate } from "@solidjs/router"
import { Avatar } from "@opencode-ai/ui/avatar"
import { base64Encode } from "@opencode-ai/shared/util/encode"
import { useGlobalSync } from "@/context/global-sync"
import { displayName } from "@/pages/layout/helpers"
import { useLayout, getAvatarColors } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { sessionTitle } from "@/utils/session-title"
import { buildHomeStats, type DayBucket, type RecentSession, type ProjectAggregate } from "./home/stats"

export default function Home() {
  const layout = useLayout()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()

  const formatNumber = createMemo(() => new Intl.NumberFormat(language.intl()))
  const formatDay = createMemo(
    () => new Intl.DateTimeFormat(language.intl(), { weekday: "short", day: "numeric", month: "short" }),
  )
  const formatRelative = (time: number) => DateTime.fromMillis(time).setLocale(language.intl()).toRelative() ?? ""

  const stats = createMemo(() => {
    const projects = layout.projects.list()
    const inputs = projects.map((project) => {
      const [child] = globalSync.child(project.worktree, { bootstrap: false })
      return {
        directory: project.worktree,
        worktree: project.worktree,
        name: displayName(project),
        iconColor: project.icon?.color,
        sessions: child.session ?? [],
      }
    })
    return buildHomeStats(inputs, Date.now())
  })

  const peakBucket = createMemo(() => {
    const max = stats().buckets.reduce((value, bucket) => Math.max(value, bucket.count), 0)
    return Math.max(1, max)
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

  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <Header
          subtitleText={subtitleText}
          lastActivity={() => stats().totals.lastActivity}
          formatRelative={formatRelative}
        />

        <HeroStats
          totals={() => stats().totals}
          formatNumber={formatNumber}
          tToday={(count) => language.t("home.stat.today", { count })}
          tArchived={(count) => language.t("home.stat.archived", { count })}
          labels={{
            sessions: language.t("home.stat.sessions"),
            files: language.t("home.stat.files"),
            lines: language.t("home.stat.lines"),
            thisWeek: language.t("home.stat.thisWeek"),
          }}
        />

        <ActivityChart
          buckets={() => stats().buckets}
          peak={peakBucket}
          totalThisWindow={() => stats().buckets.reduce((total, bucket) => total + bucket.count, 0)}
          formatDay={formatDay}
          formatNumber={formatNumber}
          tTitle={language.t("home.activity.title")}
          tSubtitle={language.t("home.activity.subtitle")}
          tEmpty={language.t("home.activity.empty")}
          tDayLabel={(count, date) => language.t("home.activity.dayLabel", { count, date })}
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
      <Show when={props.lastActivity()}>
        {(time) => (
          <div class="shrink-0 text-12-regular text-text-weak">
            {language.t("home.subtitle.lastActivity", { time: props.formatRelative(time()) })}
          </div>
        )}
      </Show>
    </div>
  )
}

function HeroStats(props: {
  totals: () => ReturnType<typeof buildHomeStats>["totals"]
  formatNumber: () => Intl.NumberFormat
  tToday: (count: number) => string
  tArchived: (count: number) => string
  labels: { sessions: string; files: string; lines: string; thisWeek: string }
}) {
  const lines = () => props.totals().additions + props.totals().deletions
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
      <Stat
        label={props.labels.sessions}
        value={props.formatNumber().format(props.totals().sessions)}
        hint={() => (props.totals().archived > 0 ? props.tArchived(props.totals().archived) : undefined)}
      />
      <Stat label={props.labels.files} value={props.formatNumber().format(props.totals().files)} />
      <Stat
        label={props.labels.lines}
        value={props.formatNumber().format(lines())}
        hint={() => {
          const t = props.totals()
          if (t.additions === 0 && t.deletions === 0) return undefined
          return `+${props.formatNumber().format(t.additions)} -${props.formatNumber().format(t.deletions)}`
        }}
      />
      <Stat
        label={props.labels.thisWeek}
        value={props.formatNumber().format(props.totals().thisWeek)}
        hint={() => (props.totals().today > 0 ? props.tToday(props.totals().today) : undefined)}
      />
    </div>
  )
}

function Stat(props: { label: string; value: string; hint?: () => string | undefined }) {
  return (
    <div class="min-w-0 border-b border-r border-border-weaker-base px-4 py-3 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r [&:nth-child(3)]:border-b-0 sm:[&:nth-child(3)]:border-b-0">
      <div class="text-20-medium text-text-strong tabular-nums">{props.value}</div>
      <div class="pt-0.5 text-12-regular text-text-weak truncate">{props.label}</div>
      <Show when={props.hint?.()}>
        {(hint) => <div class="pt-1 text-12-regular text-text-base tabular-nums truncate">{hint()}</div>}
      </Show>
    </div>
  )
}

function ActivityChart(props: {
  buckets: () => DayBucket[]
  peak: () => number
  totalThisWindow: () => number
  formatDay: () => Intl.DateTimeFormat
  formatNumber: () => Intl.NumberFormat
  tTitle: string
  tSubtitle: string
  tEmpty: string
  tDayLabel: (count: number, date: string) => string
}) {
  const barHeight = (count: number) => `${Math.max(count > 0 ? 8 : 2, Math.round((count / props.peak()) * 100))}%`
  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-3">
        <div class="text-14-medium text-text-strong">{props.tTitle}</div>
        <div class="text-12-regular text-text-weak">{props.tSubtitle}</div>
      </div>
      <Show
        when={props.totalThisWindow() > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-8 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {props.tEmpty}
          </div>
        }
      >
        <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 pt-4 pb-3 shadow-[var(--shadow-xs)]">
          <div class="flex h-28 items-end gap-1.5">
            <For each={props.buckets()}>
              {(bucket) => {
                const date = () => props.formatDay().format(new Date(bucket.start))
                const filled = () => bucket.count > 0
                return (
                  <div
                    class="group relative flex h-full flex-1 flex-col justify-end"
                    title={props.tDayLabel(bucket.count, date())}
                  >
                    <div
                      classList={{
                        "w-full rounded-sm transition-colors": true,
                        "bg-[color-mix(in_srgb,var(--text-interactive-base)_55%,transparent)] group-hover:bg-text-interactive-base":
                          filled(),
                        "bg-surface-base group-hover:bg-surface-base-hover": !filled(),
                      }}
                      style={{ height: barHeight(bucket.count) }}
                    />
                  </div>
                )
              }}
            </For>
          </div>
          <div class="mt-2 flex justify-between text-12-regular text-text-weak tabular-nums">
            <Show when={props.buckets()[0]} keyed>
              {(first) => <span>{props.formatDay().format(new Date(first.start))}</span>}
            </Show>
            <Show when={props.buckets().at(-1)} keyed>
              {(last) => <span>{props.formatDay().format(new Date(last.start))}</span>}
            </Show>
          </div>
        </div>
      </Show>
    </section>
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
                      <Show when={project.lastActivity} fallback={props.tNever}>
                        {(time) => <span>{props.formatRelative(time())}</span>}
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
