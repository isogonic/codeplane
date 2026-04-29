#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const openapi = path.resolve(dir, "../openapi.json")
const outputs = ["./src/gen", "./src/v2/gen"] as const

await $`bun dev generate > ${openapi}`.cwd(path.resolve(dir, "../../codeplane"))

await Promise.all(
  outputs.map((output) =>
    createClient({
      input: openapi,
      output: {
        path: output,
        tsConfigPath: path.join(dir, "tsconfig.json"),
        clean: true,
      },
      plugins: [
        {
          name: "@hey-api/typescript",
          exportFromIndex: false,
        },
        {
          name: "@hey-api/sdk",
          instance: "CodeplaneClient",
          exportFromIndex: false,
          auth: false,
          paramsStructure: "flat",
        },
        {
          name: "@hey-api/client-fetch",
          exportFromIndex: false,
          baseUrl: "http://localhost:4096",
        },
      ],
    }),
  ),
)

await $`bun prettier --write src/gen src/v2`
await $`rm -rf dist`
await $`bun tsc`
