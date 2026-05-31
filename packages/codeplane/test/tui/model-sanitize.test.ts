import { describe, expect, test } from "bun:test"
import { displayName, name, sanitizeInline } from "../../src/tui/util/model"
import type { Provider } from "../../src/tui/_compat/sdk-v2"

describe("model sanitizeInline", () => {
  test("strips a leading regional-indicator flag emoji", () => {
    // The exact case from the reported sidebar bug: a flag emoji glued to the
    // model name breaks the TUI row width and bleeds into the sidebar column.
    expect(sanitizeInline("🇹🇭Step 3.7 Flash (ORDIS)")).toBe("Step 3.7 Flash (ORDIS)")
    expect(sanitizeInline("🇹🇭 Step 3.7 Flash")).toBe("Step 3.7 Flash")
  })

  test("strips pictographs, ZWJ sequences, and variation selectors", () => {
    expect(sanitizeInline("GPT-4o 🚀")).toBe("GPT-4o")
    expect(sanitizeInline("👨‍👩‍👧 family")).toBe("family")
    expect(sanitizeInline("Model ❤️ ⚠️")).toBe("Model")
  })

  test("leaves ordinary model names untouched", () => {
    expect(sanitizeInline("Claude Sonnet 4.5")).toBe("Claude Sonnet 4.5")
    expect(sanitizeInline("deepseek/v3")).toBe("deepseek/v3")
    expect(sanitizeInline("GPT-4o (2024-08-06)")).toBe("GPT-4o (2024-08-06)")
  })

  test("collapses whitespace left behind by removed emoji", () => {
    expect(sanitizeInline("Model 🚀  ❤️  v2")).toBe("Model v2")
  })
})

describe("model displayName vs name", () => {
  // A minimal provider list shaped like the SDK Provider type. Only the fields
  // `get()` reads (id + models[modelID].name) are populated.
  const providers = [
    {
      id: "ordis",
      models: {
        "step-3.7-flash": { name: "🇹🇭Step 3.7 Flash (ORDIS)" },
      },
    },
  ] as unknown as Provider[]

  test("name preserves the raw provider name (used by plain-text exports)", () => {
    expect(name(providers, "ordis", "step-3.7-flash")).toBe("🇹🇭Step 3.7 Flash (ORDIS)")
  })

  test("displayName strips emoji for safe single-row TUI rendering", () => {
    expect(displayName(providers, "ordis", "step-3.7-flash")).toBe("Step 3.7 Flash (ORDIS)")
  })

  test("displayName falls back to the model id when the model is unknown", () => {
    expect(displayName(providers, "ordis", "unknown")).toBe("unknown")
    expect(displayName(providers, "missing", "some-model")).toBe("some-model")
    expect(displayName(undefined, "missing", "some-model")).toBe("some-model")
  })
})
