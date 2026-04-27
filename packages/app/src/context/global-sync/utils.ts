import type { Agent, Project, ProviderListResponse } from "@codeplane-ai/sdk/v2/client"

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export const directoryKey = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1]}/`
  if (/^\/+$/i.test(value)) return "/"
  return value.replace(/\/+$/, "")
}

export const directoryContains = (parent: string, child: string) => {
  const root = directoryKey(parent)
  const value = directoryKey(child)
  if (root === value) return true
  if (!root) return !value
  if (root === "/") return value.startsWith("/")
  const drive = root.match(/^([A-Za-z]:)(?:\/|$)/)
  const base = drive ? root.toLowerCase() : root
  const target = drive ? value.toLowerCase() : value
  return target.startsWith(base.endsWith("/") ? base : `${base}/`)
}

function projectDirectoryScore(directory: string, project: Project) {
  if (project.id === "global") return -1
  return [project.worktree, ...(project.sandboxes ?? [])].reduce((score, root) => {
    if (!root) return score
    if (!directoryContains(root, directory)) return score
    return Math.max(score, directoryKey(root).length)
  }, -1)
}

export function projectForDirectory(directory: string, projects: Project[]) {
  return projects
    .map((project, index) => ({ project, index, score: projectDirectoryScore(directory, project) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.project
}

function isAgent(input: unknown): input is Agent {
  if (!input || typeof input !== "object") return false
  const item = input as { name?: unknown; mode?: unknown }
  if (typeof item.name !== "string") return false
  return item.mode === "subagent" || item.mode === "primary" || item.mode === "all"
}

export function normalizeAgentList(input: unknown): Agent[] {
  if (Array.isArray(input)) return input.filter(isAgent)
  if (isAgent(input)) return [input]
  if (!input || typeof input !== "object") return []
  return Object.values(input).filter(isAgent)
}

export function normalizeProviderList(input: ProviderListResponse): ProviderListResponse {
  const normalize = (providers: ProviderListResponse["all"]) =>
    providers.map((provider) => ({
      ...provider,
      models: Object.fromEntries(Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated")),
    }))

  return {
    ...input,
    all: normalize(input.all),
    catalog: normalize(input.catalog ?? input.all),
  }
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url) return project
  const icon = {
    ...project.icon,
    url: undefined,
  }
  if (!icon.override && !icon.color) {
    return {
      ...project,
      icon: undefined,
    }
  }
  return {
    ...project,
    icon,
  }
}
