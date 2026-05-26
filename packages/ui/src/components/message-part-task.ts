import type { Session } from "@codeplane-ai/sdk/v2"

const agentTones: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}

const agentPalette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

function tone(name: string) {
  return agentPalette[[...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % agentPalette.length]
}

export function taskAgent(
  raw: unknown,
  list?: readonly { name: string; color?: string }[],
): { name?: string; color?: string } {
  if (typeof raw !== "string" || !raw) return {}
  const key = raw.toLowerCase()
  const item = list?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  return {
    name: item?.name ?? `${raw[0]!.toUpperCase()}${raw.slice(1)}`,
    color: item?.color ?? agentTones[key] ?? tone(key),
  }
}

export function taskSubtitle(title: unknown, description: unknown) {
  if (typeof description !== "string") return undefined
  const trimmed = description.trim()
  if (!trimmed) return undefined
  if (typeof title !== "string") return trimmed

  const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (!escaped) return trimmed

  const deduped = trimmed.replace(new RegExp(`^${escaped}(?:\\s*[:\\-–—]\\s*|\\s+)`, "i"), "").trim()
  if (!deduped) return undefined
  if (deduped.toLowerCase() === title.trim().toLowerCase()) return undefined
  return deduped
}

function currentSession(path: string) {
  return path.match(/\/session\/([^/?#]+)/)?.[1]
}

function taskSession(
  input: Record<string, unknown>,
  path: string,
  sessions: Session[] | undefined,
  agents?: readonly { name: string; color?: string }[],
) {
  const parentID = currentSession(path)
  if (!parentID) return
  const description = typeof input.description === "string" ? input.description : ""
  const agent = taskAgent(input.subagent_type, agents).name
  return (sessions ?? [])
    .filter((session) => session.parentID === parentID && !session.time?.archived)
    .filter((session) => (description ? session.title.startsWith(description) : true))
    .filter((session) => (agent ? session.title.includes(`@${agent}`) : true))
    .sort((a, b) => (b.time.created ?? 0) - (a.time.created ?? 0))[0]?.id
}

export function taskChildSession(
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  path: string,
  sessions: Session[] | undefined,
  agents?: readonly { name: string; color?: string }[],
) {
  const value = metadata.sessionId
  if (typeof value === "string" && value) return value
  return taskSession(input, path, sessions, agents)
}
