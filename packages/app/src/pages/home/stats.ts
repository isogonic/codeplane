import type { Session } from "@opencode-ai/sdk/v2/client"

export const DAY_MS = 24 * 60 * 60 * 1000

export type ProjectInput = {
  directory: string
  name: string
  iconColor?: string
  worktree: string
  sessions: Session[]
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
}

const isVisible = (session: Session) => !session.parentID && !session.time?.archived

const sessionTime = (session: Session) => session.time.updated ?? session.time.created

const sessionAdditions = (session: Session) => session.summary?.additions ?? 0
const sessionDeletions = (session: Session) => session.summary?.deletions ?? 0
const sessionFiles = (session: Session) => session.summary?.files ?? 0

export const startOfDay = (timestamp: number) => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

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
      return {
        directory: project.directory,
        worktree: project.worktree,
        name: project.name,
        iconColor: project.iconColor,
        sessions: visible.length,
        archived,
        files: visible.reduce((total, session) => total + sessionFiles(session), 0),
        additions: visible.reduce((total, session) => total + sessionAdditions(session), 0),
        deletions: visible.reduce((total, session) => total + sessionDeletions(session), 0),
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

export function aggregateTotals(projects: ProjectAggregate[], allSessions: Session[], now: number): Totals {
  const dayStart = startOfDay(now)
  const weekStart = dayStart - 6 * DAY_MS
  const visible = allSessions.filter(isVisible)
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
  }
}

export function dailyBuckets(sessions: Session[], now: number, days = 14): DayBucket[] {
  const today = startOfDay(now)
  const buckets: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    buckets.push({ start: today - i * DAY_MS, count: 0 })
  }
  const start = buckets[0]!.start
  for (const session of sessions) {
    if (!isVisible(session)) continue
    const time = sessionTime(session)
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
      all.push({
        id: session.id,
        title: session.title || session.id,
        directory: project.directory,
        worktree: project.worktree,
        projectName: project.name,
        projectColor: project.iconColor,
        updated: sessionTime(session),
        files: sessionFiles(session),
        additions: sessionAdditions(session),
        deletions: sessionDeletions(session),
      })
    }
  }
  return all.sort((a, b) => b.updated - a.updated).slice(0, limit)
}

export function buildHomeStats(input: ProjectInput[], now: number): HomeStats {
  const projects = aggregateProjects(input)
  const allSessions = input.flatMap((project) => project.sessions)
  const totals = aggregateTotals(projects, allSessions, now)
  const buckets = dailyBuckets(allSessions, now)
  const recent = recentSessions(input)
  return { projects, totals, buckets, recent }
}
