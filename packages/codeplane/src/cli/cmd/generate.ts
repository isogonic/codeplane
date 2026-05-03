import { Server } from "../../server/server"
import type { CommandModule } from "yargs"

// Internal-only command. Hidden from `codeplane --help` (describe: false).
// Used by packages/sdk/js/script/build.ts to regenerate the OpenAPI spec
// (`bun dev generate > openapi.json` → hey-api → typed SDK clients).
//
// Restored after the v27.4.24 strict-4-surface refactor removed it; the SDK
// build pipeline depends on it but it is not part of the user-visible
// product surface.
export const GenerateCommand = {
  command: "generate",
  describe: false,
  handler: async () => {
    const specs = await Server.openapi()
    for (const item of Object.values(specs.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        if (!operation?.operationId) continue
        ;(operation as Record<string, unknown>)["x-codeSamples"] = [
          {
            lang: "js",
            source: [
              `import { createCodeplaneClient } from "@codeplane-ai/sdk"`,
              ``,
              `const client = createCodeplaneClient()`,
              `await client.${operation.operationId}({`,
              `  ...`,
              `})`,
            ].join("\n"),
          },
        ]
      }
    }
    const raw = JSON.stringify(specs, null, 2)

    // Format through prettier so output is byte-identical to committed file
    // regardless of whether ./script/format.ts runs afterward.
    const prettier = await import("prettier")
    const babel = await import("prettier/plugins/babel")
    const estree = await import("prettier/plugins/estree")
    const format = prettier.format ?? (prettier.default as { format?: typeof prettier.format })?.format
    if (!format) throw new Error("prettier.format is not available")
    const json = await format(raw, {
      parser: "json",
      plugins: [babel.default ?? babel, estree.default ?? estree],
      printWidth: 120,
    })

    // Wait for stdout to finish writing before process.exit() is called.
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule
