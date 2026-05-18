import type { AssistantMessage, Message, Session, SnapshotFileDiff } from "@codeplane-ai/sdk/v2/client"
import { diffs as listDiffs } from "@/utils/diffs"

export const DAY_MS = 24 * 60 * 60 * 1000

export type Range = "all" | "30d" | "7d"

export const RANGE_DAYS: Record<Range, number | undefined> = {
  all: undefined,
  "30d": 30,
  "7d": 7,
}

export const HEATMAP_DAYS = 364

export type ProjectInput = {
  directory: string
  name: string
  iconColor?: string
  worktree: string
  sessions: Session[]
  sessionDiffs?: Record<string, SnapshotFileDiff[] | undefined>
  sessionMessages?: Record<string, Message[] | undefined>
}

export type ProjectAggregate = {
  directory: string
  worktree: string
  name: string
  iconColor?: string
  sessions: number
  archived: number
  files: number
  additions: number
  deletions: number
  lastActivity?: number
}

export type PreferredModel = {
  modelID: string
  providerID?: string
  messages: number
}

export type Totals = {
  projects: number
  sessions: number
  archived: number
  files: number
  additions: number
  deletions: number
  thisWeek: number
  today: number
  lastActivity?: number
  messages: number
  tokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  peakHour?: number
  preferredModel?: PreferredModel
}

export type ModelStat = {
  modelID: string
  providerID?: string
  messages: number
  tokens: number
  sessions: number
}

export type DayBucket = {
  start: number
  count: number
}

export type RecentSession = {
  id: string
  title: string
  directory: string
  worktree: string
  projectName: string
  projectColor?: string
  updated: number
  files: number
  additions: number
  deletions: number
}

export type HomeStats = {
  totals: Totals
  projects: ProjectAggregate[]
  recent: RecentSession[]
  buckets: DayBucket[]
  models: ModelStat[]
}

type Diff = ReturnType<typeof listDiffs>[number]

const isVisible = (session: Session) => !session.parentID && !session.time?.archived

const sessionTime = (session: Session) => session.time.updated ?? session.time.created

const isAssistant = (message: Message): message is AssistantMessage => message.role === "assistant"

const messageTokens = (message: AssistantMessage) => {
  const t = message.tokens
  if (!t) return 0
  if (typeof t.total === "number" && t.total > 0) return t.total
  return (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
}

const patchStats = (patch: string) =>
  patch.split("\n").reduce(
    (total, line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return total
      if (line.startsWith("+")) return { additions: total.additions + 1, deletions: total.deletions }
      if (line.startsWith("-")) return { additions: total.additions, deletions: total.deletions + 1 }
      return total
    },
    { additions: 0, deletions: 0 },
  )

const lineStats = (diff: Diff) => {
  const stats = { additions: diff.additions ?? 0, deletions: diff.deletions ?? 0 }
  if (stats.additions + stats.deletions > 0 || diff.patch.trim().length === 0) return stats
  return patchStats(diff.patch)
}

const diffStats = (diffs: unknown) =>
  listDiffs(diffs).reduce(
    (total, diff) => {
      const stats = lineStats(diff)
      return {
        files:
          stats.additions + stats.deletions > 0 || diff.status || diff.patch.trim().length > 0
            ? total.files.add(diff.file)
            : total.files,
        additions: total.additions + stats.additions,
        deletions: total.deletions + stats.deletions,
      }
    },
    { files: new Set<string>(), additions: 0, deletions: 0 },
  )

const sessionChangeStats = (session: Session, sessionDiffs?: ProjectInput["sessionDiffs"]) => {
  const cached = listDiffs(sessionDiffs?.[session.id])
  const diff = diffStats(cached.length > 0 ? cached : session.summary?.diffs)
  const summaryLines = (session.summary?.additions ?? 0) + (session.summary?.deletions ?? 0)
  const summaryTotal =
    (session.summary?.files ?? 0) + (session.summary?.additions ?? 0) + (session.summary?.deletions ?? 0)
  if (summaryTotal > 0) {
    return {
      files: session.summary?.files || diff.files.size,
      additions: summaryLines > 0 ? (session.summary?.additions ?? 0) : diff.additions,
      deletions: summaryLines > 0 ? (session.summary?.deletions ?? 0) : diff.deletions,
    }
  }
  return {
    files: diff.files.size,
    additions: diff.additions,
    deletions: diff.deletions,
  }
}

export const startOfDay = (timestamp: number) => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const rangeStart = (now: number, range: Range): number | undefined => {
  const days = RANGE_DAYS[range]
  if (days === undefined) return undefined
  return startOfDay(now) - (days - 1) * DAY_MS
}

const inRange = (time: number, start?: number) => start === undefined || time >= start

export function aggregateProjects(input: ProjectInput[]): ProjectAggregate[] {
  return input
    .map((project) => {
      const visible = project.sessions.filter(isVisible)
      const archived = project.sessions.filter((session) => !session.parentID && !!session.time?.archived).length
      const lastActivity = visible.reduce<number | undefined>((max, session) => {
        const value = sessionTime(session)
        if (max === undefined) return value
        return value > max ? value : max
      }, undefined)
      const changes = visible.reduce(
        (total, session) => {
          const stats = sessionChangeStats(session, project.sessionDiffs)
          return {
            files: total.files + stats.files,
            additions: total.additions + stats.additions,
            deletions: total.deletions + stats.deletions,
          }
        },
        { files: 0, additions: 0, deletions: 0 },
      )
      return {
        directory: project.directory,
        worktree: project.worktree,
        name: project.name,
        iconColor: project.iconColor,
        sessions: visible.length,
        archived,
        files: changes.files,
        additions: changes.additions,
        deletions: changes.deletions,
        lastActivity,
      }
    })
    .sort((a, b) => {
      if (b.sessions !== a.sessions) return b.sessions - a.sessions
      const bAct = b.lastActivity ?? 0
      const aAct = a.lastActivity ?? 0
      if (bAct !== aAct) return bAct - aAct
      return a.name.localeCompare(b.name)
    })
}

export function streaks(activeDays: Set<number>, now: number) {
  if (activeDays.size === 0) return { current: 0, longest: 0 }
  const sorted = [...activeDays].sort((a, b) => a - b)
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! === DAY_MS) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 1
    }
  }
  let current = 0
  let day = startOfDay(now)
  if (!activeDays.has(day)) day -= DAY_MS
  while (activeDays.has(day)) {
    current += 1
    day -= DAY_MS
  }
  return { current, longest }
}

const collectMessages = (input: ProjectInput[]) => {
  const all: Array<{ message: Message; sessionID: string }> = []
  for (const project of input) {
    if (!project.sessionMessages) continue
    for (const session of project.sessions) {
      if (!isVisible(session)) continue
      const messages = project.sessionMessages[session.id]
      if (!messages) continue
      for (const message of messages) all.push({ message, sessionID: session.id })
    }
  }
  return all
}

export function aggregateTotals(
  projects: ProjectAggregate[],
  allSessions: Session[],
  allMessages: ReturnType<typeof collectMessages>,
  now: number,
  range: Range,
): Totals {
  const dayStart = startOfDay(now)
  const weekStart = dayStart - 6 * DAY_MS
  const start = rangeStart(now, range)
  const visible = allSessions.filter(isVisible).filter((session) => inRange(sessionTime(session), start))

  const activeDaySet = new Set<number>()
  const hourCounts = new Array<number>(24).fill(0)
  const modelMessages = new Map<string, { count: number; providerID?: string }>()
  let totalTokens = 0
  let messageCount = 0
  for (const { message } of allMessages) {
    const created = message.time.created
    if (!inRange(created, start)) continue
    messageCount += 1
    activeDaySet.add(startOfDay(created))
    hourCounts[new Date(created).getHours()] += 1
    if (isAssistant(message)) {
      totalTokens += messageTokens(message)
      const key = message.modelID || ""
      if (key) {
        const existing = modelMessages.get(key)
        if (existing) existing.count += 1
        else modelMessages.set(key, { count: 1, providerID: message.providerID })
      }
    }
  }

  const peakHour = hourCounts.reduce<{ hour: number; count: number }>(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: -1, count: 0 },
  )

  let preferred: PreferredModel | undefined
  for (const [modelID, info] of modelMessages) {
    if (!preferred || info.count > preferred.messages) {
      preferred = { modelID, providerID: info.providerID, messages: info.count }
    }
  }

  const { current, longest } = streaks(activeDaySet, now)

  return {
    projects: projects.length,
    sessions: visible.length,
    archived: projects.reduce((total, project) => total + project.archived, 0),
    files: projects.reduce((total, project) => total + project.files, 0),
    additions: projects.reduce((total, project) => total + project.additions, 0),
    deletions: projects.reduce((total, project) => total + project.deletions, 0),
    today: visible.filter((session) => sessionTime(session) >= dayStart).length,
    thisWeek: visible.filter((session) => sessionTime(session) >= weekStart).length,
    lastActivity: projects.reduce<number | undefined>((max, project) => {
      const value = project.lastActivity
      if (value === undefined) return max
      if (max === undefined) return value
      return value > max ? value : max
    }, undefined),
    messages: messageCount,
    tokens: totalTokens,
    activeDays: activeDaySet.size,
    currentStreak: current,
    longestStreak: longest,
    peakHour: peakHour.count > 0 ? peakHour.hour : undefined,
    preferredModel: preferred,
  }
}

export function aggregateModels(
  allMessages: ReturnType<typeof collectMessages>,
  now: number,
  range: Range,
): ModelStat[] {
  const start = rangeStart(now, range)
  const byModel = new Map<string, { providerID?: string; messages: number; tokens: number; sessions: Set<string> }>()
  for (const { message, sessionID } of allMessages) {
    if (!inRange(message.time.created, start)) continue
    if (!isAssistant(message)) continue
    const modelID = message.modelID || ""
    if (!modelID) continue
    let entry = byModel.get(modelID)
    if (!entry) {
      entry = { providerID: message.providerID, messages: 0, tokens: 0, sessions: new Set() }
      byModel.set(modelID, entry)
    }
    entry.messages += 1
    entry.tokens += messageTokens(message)
    entry.sessions.add(sessionID)
  }
  return [...byModel.entries()]
    .map(([modelID, info]) => ({
      modelID,
      providerID: info.providerID,
      messages: info.messages,
      tokens: info.tokens,
      sessions: info.sessions.size,
    }))
    .sort((a, b) => b.messages - a.messages)
}

export function dailyBuckets(messages: ReturnType<typeof collectMessages>, now: number): DayBucket[] {
  const days = HEATMAP_DAYS
  const today = startOfDay(now)
  const buckets: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    buckets.push({ start: today - i * DAY_MS, count: 0 })
  }
  if (buckets.length === 0) return buckets
  const start = buckets[0]!.start
  for (const { message } of messages) {
    const time = message.time.created
    if (time < start) continue
    const dayStart = startOfDay(time)
    const index = Math.round((dayStart - start) / DAY_MS)
    const bucket = buckets[index]
    if (!bucket) continue
    bucket.count += 1
  }
  return buckets
}

export function recentSessions(input: ProjectInput[], limit = 8): RecentSession[] {
  const all: RecentSession[] = []
  for (const project of input) {
    for (const session of project.sessions) {
      if (!isVisible(session)) continue
      const stats = sessionChangeStats(session, project.sessionDiffs)
      all.push({
        id: session.id,
        title: session.title || session.id,
        directory: project.directory,
        worktree: project.worktree,
        projectName: project.name,
        projectColor: project.iconColor,
        updated: sessionTime(session),
        files: stats.files,
        additions: stats.additions,
        deletions: stats.deletions,
      })
    }
  }
  return all.sort((a, b) => b.updated - a.updated).slice(0, limit)
}

export function buildHomeStats(input: ProjectInput[], now: number, range: Range = "all"): HomeStats {
  const projects = aggregateProjects(input)
  const allSessions = input.flatMap((project) => project.sessions)
  const allMessages = collectMessages(input)
  const totals = aggregateTotals(projects, allSessions, allMessages, now, range)
  const buckets = dailyBuckets(allMessages, now)
  const recent = recentSessions(input)
  const models = aggregateModels(allMessages, now, range)
  return { projects, totals, buckets, recent, models }
}
