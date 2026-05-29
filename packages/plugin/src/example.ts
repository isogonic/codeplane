import { Plugin } from "./index.js"
import { tool } from "./tool.js"

/**
 * Example plugin demonstrating the tool lifecycle hooks a plugin can use to
 * extend Codeplane: registering tools, gating which tools the model sees,
 * and observing/repairing tool failures.
 */
export const ExamplePlugin: Plugin = async (_ctx) => {
  return {
    // Register a custom tool the model can call.
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string().describe("foo"),
        },
        async execute(args) {
          return `Hello ${args.foo}!`
        },
      }),
    },

    // Gate which tools are exposed to the model. Here we enforce a read-only
    // mode for a "reviewer" agent by hiding mutating tools.
    "tool.list": async (input, output) => {
      if (input.agent === "reviewer") {
        const blocked = new Set(["write", "edit", "bash", "apply_patch"])
        output.tools = output.tools.filter((id) => !blocked.has(id))
      }
    },

    // Observe tool failures and rewrite the message the model sees so it can
    // recover instead of giving up.
    "tool.execute.error": async (input, output) => {
      console.error(`[example] tool ${input.tool} failed: ${output.error}`)
      if (input.tool === "webfetch") {
        output.output += "\n\nHint: the network may be offline — try `read` on a local file instead."
      }
    },
  }
}
