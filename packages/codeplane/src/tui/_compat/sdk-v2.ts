// TUI-local SDK alias. Their TUI imports `createOpencodeClient` from
// `@opencode-ai/sdk/v2`. Our SDK exposes the same factory under
// `createCodeplaneClient`. We also fill in v2 SessionMessage* types that
// their TUI references but our SDK doesn't currently export.
//
// Plus an `EventAugmented` union: their newer SDK puts `id: string` on every
// event and adds `EventSessionNext{Agent,Model,Shell}*` variants ours doesn't.
// We layer those on top of the SDK's `Event` so the TUI's strict event handlers
// (sync-v2.tsx, etc.) get correct types without us touching the SDK package.

export * from "@codeplane-ai/sdk/v2"
export { createCodeplaneClient as createOpencodeClient } from "@codeplane-ai/sdk/v2"

// ---- Augmented event types (additive over @codeplane-ai/sdk/v2's Event) ----
import type {
  Event as SdkEvent,
  EventSessionNextStepStarted as SdkStepStarted,
  EventSessionNextStepEnded as SdkStepEnded,
  EventSessionNextToolSuccess as SdkToolSuccess,
  EventSessionNextToolError as SdkToolError,
  EventSessionNextToolProgress as SdkToolProgress,
} from "@codeplane-ai/sdk/v2"

// Distributive: adds `id: string` to every member of the SDK Event union.
type WithId<T> = T extends object ? T & { id: string } : never

// ---- Type discriminators that shadow SDK shapes whose `properties` are
// richer in the newer upstream. We DON'T re-export under the SDK names (would
// collide with `export *`). The augmented `EventAugmented` union below
// composes with these instead of the SDK versions for the matching `type`s.

type AugStepStarted = WithId<Omit<SdkStepStarted, "properties">> & {
  properties: SdkStepStarted["properties"] & { agent: string; snapshot?: string }
}

type AugStepEnded = WithId<Omit<SdkStepEnded, "properties">> & {
  properties: Omit<SdkStepEnded["properties"], "reason"> & { finish: string; snapshot?: string }
}

type AugToolProgress = WithId<Omit<SdkToolProgress, "properties">> & {
  properties: Omit<SdkToolProgress["properties"], "details"> & {
    structured: { [key: string]: unknown }
    content: Array<ToolTextContent | ToolFileContent>
  }
}

type AugToolSuccess = WithId<Omit<SdkToolSuccess, "properties">> & {
  properties: Omit<SdkToolSuccess["properties"], "output" | "attachments" | "details"> & {
    structured: { [key: string]: unknown }
    content: Array<ToolTextContent | ToolFileContent>
  }
}

type AugToolError = WithId<Omit<SdkToolError, "properties">> & {
  properties: Omit<SdkToolError["properties"], "error"> & {
    error: { type: string; message: string }
  }
}

// ---- New event types (not in our SDK at all) ----
export type EventSessionNextAgentSwitched = {
  id: string
  type: "session.next.agent.switched"
  properties: { timestamp: number; sessionID: string; agent: string }
}

export type EventSessionNextModelSwitched = {
  id: string
  type: "session.next.model.switched"
  properties: { timestamp: number; sessionID: string; id: string; providerID: string; variant?: string }
}

export type EventSessionNextShellStarted = {
  id: string
  type: "session.next.shell.started"
  properties: { timestamp: number; sessionID: string; callID: string; command: string }
}

export type EventSessionNextShellEnded = {
  id: string
  type: "session.next.shell.ended"
  properties: { timestamp: number; sessionID: string; callID: string; output: string }
}

export type EventSessionNextCompactionStarted = {
  id: string
  type: "session.next.compaction.started"
  properties: { timestamp: number; sessionID: string; reason: "auto" | "manual" }
}

export type EventSessionNextCompactionDelta = {
  id: string
  type: "session.next.compaction.delta"
  properties: { timestamp: number; sessionID: string; text: string }
}

export type EventSessionNextCompactionEnded = {
  id: string
  type: "session.next.compaction.ended"
  properties: { timestamp: number; sessionID: string; text: string; include?: string }
}

// Members of the SDK Event union we're shadowing — exclude their original
// shape from the augmented union so the `type`-discriminated cases pick up
// the augmented shape instead of the SDK shape.
type ShadowedTypes =
  | "session.next.step.started"
  | "session.next.step.ended"
  | "session.next.tool.progress"
  | "session.next.tool.success"
  | "session.next.tool.error"

type SdkEventNonShadowed = SdkEvent extends infer E ? (E extends { type: ShadowedTypes } ? never : E) : never

export type EventAugmented =
  | WithId<SdkEventNonShadowed>
  | AugStepStarted
  | AugStepEnded
  | AugToolProgress
  | AugToolSuccess
  | AugToolError
  | EventSessionNextAgentSwitched
  | EventSessionNextModelSwitched
  | EventSessionNextShellStarted
  | EventSessionNextShellEnded
  | EventSessionNextCompactionStarted
  | EventSessionNextCompactionDelta
  | EventSessionNextCompactionEnded

// --- Compat type aliases (richer Session message types from their SDK) ---
// These are needed by sync-v2.tsx and session-v2.tsx. They mirror the shape
// of the corresponding types in their newer SDK so TUI logic compiles.

import type { PromptFileAttachment, PromptAgentAttachment } from "@codeplane-ai/sdk/v2"

export type ToolTextContent = {
  type: "text"
  text: string
}

export type ToolFileContent = {
  type: "file"
  uri: string
  mime: string
  name?: string
}

export type SessionMessageAgentSwitched = {
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number }
  type: "agent-switched"
  agent: string
}

export type SessionMessageModelSwitched = {
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number }
  type: "model-switched"
  model: { id: string; providerID: string; variant?: string }
}

export type SessionMessageUser = {
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number }
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  type: "user"
}

export type SessionMessageSynthetic = {
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number }
  sessionID: string
  text: string
  type: "synthetic"
}

export type SessionMessageShell = {
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number; completed?: number }
  type: "shell"
  callID: string
  command: string
  output: string
}

export type SessionMessageAssistantText = {
  type: "text"
  text: string
}

export type SessionMessageAssistantReasoning = {
  type: "reasoning"
  id: string
  text: string
}

export type SessionMessageToolStatePending = {
  status: "pending"
  input: string
}

export type SessionMessageToolStateRunning = {
  status: "running"
  input: { [key: string]: unknown }
  structured: { [key: string]: unknown }
  content: Array<ToolTextContent | ToolFileContent>
}

export type SessionMessageToolStateCompleted = {
  status: "completed"
  input: { [key: string]: unknown }
  attachments?: Array<PromptFileAttachment>
  content: Array<ToolTextContent | ToolFileContent>
  structured: { [key: string]: unknown }
}

export type SessionMessageToolStateError = {
  status: "error"
  input: { [key: string]: unknown }
  content: Array<ToolTextContent | ToolFileContent>
  structured: { [key: string]: unknown }
  error: { type: string; message: string }
}

export type SessionMessageAssistantTool = {
  type: "tool"
  id: string
  name: string
  provider?: { executed: boolean; metadata?: { [key: string]: unknown } }
  state:
    | SessionMessageToolStatePending
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError
  time: { created: number; ran?: number; completed?: number; pruned?: number }
}

export type SessionMessageAssistant = {
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number; completed?: number }
  type: "assistant"
  agent: string
  model: { id: string; providerID: string; variant?: string }
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  snapshot?: { start?: string; end?: string }
  finish?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  error?: string
}

export type SessionMessageCompaction = {
  type: "compaction"
  reason: "auto" | "manual"
  summary: string
  include?: string
  id: string
  metadata?: { [key: string]: unknown }
  time: { created: number }
}

export type SessionMessage =
  | SessionMessageAgentSwitched
  | SessionMessageModelSwitched
  | SessionMessageUser
  | SessionMessageSynthetic
  | SessionMessageShell
  | SessionMessageAssistant
  | SessionMessageCompaction
