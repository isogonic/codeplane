import { expect, test } from "bun:test"
import { shouldUseCopilotResponsesApi } from "@/provider/provider"

// Locks the chat-vs-responses routing contract against the live Copilot model
// lineup. Codex + gpt-5/6+ families use /responses; gpt-5-mini, gpt-4.x,
// gemini and claude use /chat/completions (claude additionally takes the
// anthropic /v1/messages path, decided elsewhere).
test.each([
  ["gpt-5.2", true],
  ["gpt-5.4", true],
  ["gpt-5.5", true],
  ["gpt-5.2-codex", true],
  ["gpt-5.3-codex", true],
  ["gpt-5.4-mini", true],
  ["gpt-6", true],
  // codex is responses-only regardless of family prefix
  ["gpt-4.1-codex", true],
  // explicitly kept on chat completions
  ["gpt-5-mini", false],
  ["gpt-4.1", false],
  ["gpt-4o", false],
  ["gemini-2.5-pro", false],
  ["gemini-3.5-flash", false],
  ["claude-sonnet-4.6", false],
])("routes %s to responses=%p", (modelID, expected) => {
  expect(shouldUseCopilotResponsesApi(modelID)).toBe(expected)
})
