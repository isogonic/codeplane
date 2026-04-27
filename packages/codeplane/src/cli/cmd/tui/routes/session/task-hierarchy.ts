import { Locale } from "@/util"

export function formatTaskHierarchy(input: {
  currentTool?: {
    title?: string
    tool: string
  }
  description: string
  duration: number
  parentAgent: string
  status: "pending" | "running" | "completed" | "error"
  subagentType?: string
  toolCount: number
}) {
  return [
    `Main agent: ${Locale.titlecase(input.parentAgent)}`,
    `└─ Subagent: ${Locale.titlecase(input.subagentType ?? "General")} — ${input.description}`,
    `   └─ Toolcalls: ${input.toolCount}${
      input.status === "completed" && input.duration > 0 ? ` · ${Locale.duration(input.duration)}` : ""
    }`,
    input.currentTool
      ? `      └─ ${input.status === "running" ? "Active" : "Last"}: ${Locale.titlecase(input.currentTool.tool)}${
          input.currentTool.title ? ` ${input.currentTool.title}` : ""
        }`
      : undefined,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n")
}
