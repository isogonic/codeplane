import type { CronTask } from "@/utils/cron-client"
import { directoryContains, directoryKey } from "@/context/global-sync/utils"

export type CronProjectScope = {
  id?: string
  worktree: string
  sandboxes?: string[]
}

export function cronProjectDirectories(project: CronProjectScope | undefined) {
  if (!project) return []
  const seen = new Set<string>()
  return [project.worktree, ...(project.sandboxes ?? [])].filter((directory) => {
    if (!directory) return false
    const key = directoryKey(directory)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function cronDirectoryInScope(directory: string, roots: string[]) {
  return roots.some((root) => directoryContains(root, directory))
}

function cronProjectDirectoryScore(directory: string, project: CronProjectScope) {
  return cronProjectDirectories(project).reduce((score, root) => {
    if (!directoryContains(root, directory)) return score
    return Math.max(score, directoryKey(root).length)
  }, -1)
}

export function cronProjectForDirectory(
  directory: string | undefined,
  projects: CronProjectScope[],
  routeProjectID?: string,
): CronProjectScope | undefined {
  if (!directory) return undefined
  const routeProject = routeProjectID ? projects.find((project) => project.id === routeProjectID) : undefined
  if (routeProject && cronProjectDirectoryScore(directory, routeProject) >= 0) return routeProject
  const match = projects
    .map((project, index) => ({ project, index, score: cronProjectDirectoryScore(directory, project) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.project
  if (match) return match
  return routeProjectID ? { id: routeProjectID, worktree: directory } : { worktree: directory }
}

export function cronProjectIDForRoute(project: CronProjectScope | undefined, routeProjectID?: string) {
  return project?.id ?? routeProjectID
}

export function cronTaskInScope(
  task: Pick<CronTask, "projectID" | "directory">,
  scope: { projectID?: string; project?: CronProjectScope; directory?: string },
) {
  if (scope.projectID) return task.projectID === scope.projectID
  const roots = scope.project ? cronProjectDirectories(scope.project) : scope.directory ? [scope.directory] : []
  return cronDirectoryInScope(task.directory, roots)
}
