import type { Agent, AgentConfig, Config } from "@codeplane-ai/sdk/v2/client"

export type CronAgentOption = { name: string; label: string }

const isAgentConfig = (value: unknown): value is AgentConfig =>
  !!value && typeof value === "object" && !Array.isArray(value)

export function cronAgentOptions(input: {
  agents?: readonly Agent[]
  config?: Pick<Config, "agent" | "mode">
  defaultLabel: string
}): CronAgentOption[] {
  const merged = new Map<string, CronAgentOption>()
  const config = new Map<string, AgentConfig>()

  for (const agent of input.agents ?? []) {
    if (!agent?.name) continue
    if (agent.hidden || agent.mode === "subagent") continue
    merged.set(agent.name, { name: agent.name, label: agent.name })
  }

  for (const [name, cfg] of Object.entries(input.config?.mode ?? {})) {
    if (!isAgentConfig(cfg)) continue
    config.set(name, cfg)
  }

  for (const [name, cfg] of Object.entries(input.config?.agent ?? {})) {
    if (!isAgentConfig(cfg)) continue
    config.set(name, cfg)
  }

  for (const [name, cfg] of config) {
    if (cfg.disable === true || cfg.hidden === true || cfg.mode === "subagent") {
      merged.delete(name)
      continue
    }
    merged.set(name, { name, label: name })
  }

  return [
    { name: "", label: input.defaultLabel },
    ...[...merged.values()].sort((a, b) => a.label.localeCompare(b.label)),
  ]
}
