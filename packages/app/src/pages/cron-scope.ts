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

export function cronTaskInScope(
  task: Pick<CronTask, "projectID" | "directory">,
  scope: { projectID?: string; project?: CronProjectScope; directory?: string },
) {
  if (scope.projectID) return task.projectID === scope.projectID
  const roots = scope.project ? cronProjectDirectories(scope.project) : scope.directory ? [scope.directory] : []
  return cronDirectoryInScope(task.directory, roots)
}
