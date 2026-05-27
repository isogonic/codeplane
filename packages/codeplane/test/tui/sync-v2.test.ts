import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { EventAugmented } from "@/tui/_compat/sdk-v2"
import { createSyncV2State } from "@/tui/context/sync-v2"

function createHarness() {
  let emit: ((event: EventAugmented) => void) | undefined
  const state = createRoot(() =>
    createSyncV2State({
      event: {
        subscribe(handler) {
          emit = handler
        },
      },
      sdk: {
        client: {
          session: {
            messages: async () => ({ data: { items: [] } }),
          },
        },
      },
    }),
  )

  return {
    state,
    emit(event: { id?: string; type: string; properties: Record<string, unknown> }) {
      if (!emit) throw new Error("sync-v2 event subscriber was not registered")
      emit(event as EventAugmented)
    },
  }
}

function event(type: string, properties: Record<string, unknown>, id = type) {
  return { id, type, properties }
}

describe("sync-v2 streaming deltas", () => {
  test("appends text, tool input, reasoning, and compaction deltas through direct store paths", () => {
    const { state, emit } = createHarness()

    emit(
      event("session.next.step.started", {
        sessionID: "s1",
        agent: "agent",
        model: { providerID: "test", modelID: "model" },
        timestamp: 1,
      }),
    )

    emit(event("session.next.text.started", { sessionID: "s1" }))
    emit(event("session.next.text.delta", { sessionID: "s1", delta: "hello" }))
    emit(event("session.next.text.delta", { sessionID: "s1", delta: " world" }))

    emit(event("session.next.tool.input.started", { sessionID: "s1", callID: "tool-1", name: "bash", timestamp: 2 }))
    emit(event("session.next.tool.input.delta", { sessionID: "s1", callID: "tool-1", delta: "npm" }))
    emit(event("session.next.tool.input.delta", { sessionID: "s1", callID: "tool-1", delta: " test" }))

    emit(event("session.next.reasoning.started", { sessionID: "s1", reasoningID: "r1" }))
    emit(event("session.next.reasoning.delta", { sessionID: "s1", reasoningID: "r1", delta: "think" }))
    emit(event("session.next.reasoning.delta", { sessionID: "s1", reasoningID: "r1", delta: " more" }))

    emit(event("session.next.compaction.started", { sessionID: "s1", reason: "manual", timestamp: 3 }))
    emit(event("session.next.compaction.delta", { sessionID: "s1", text: "summary" }))
    emit(event("session.next.compaction.delta", { sessionID: "s1", text: " text" }))

    const messages = state.session.message.fromSession("s1")
    const assistant = messages.find((message) => message.type === "assistant")
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") throw new Error("assistant message missing")

    const text = assistant.content.find((item) => item.type === "text")
    expect(text?.type).toBe("text")
    if (text?.type !== "text") throw new Error("text part missing")
    expect(text.text).toBe("hello world")
    const tool = assistant.content.find((item) => item.type === "tool" && item.id === "tool-1")
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") throw new Error("tool part missing")
    expect(tool.state.status).toBe("pending")
    if (tool.state.status !== "pending") throw new Error("tool should still be pending")
    expect(tool.state.input).toBe("npm test")
    const reasoning = assistant.content.find((item) => item.type === "reasoning" && item.id === "r1")
    expect(reasoning?.type).toBe("reasoning")
    if (reasoning?.type !== "reasoning") throw new Error("reasoning part missing")
    expect(reasoning.text).toBe("think more")

    const compaction = messages.find((message) => message.type === "compaction")
    expect(compaction?.type).toBe("compaction")
    if (compaction?.type !== "compaction") throw new Error("compaction message missing")
    expect(compaction.summary).toBe("summary text")
  })
})
