#!/usr/bin/env bun

import { createCodeplaneClient } from "../packages/sdk/js/src/v2/index.ts"

const SERVER_URL = process.env.CODEPLANE_SERVER_URL ?? "http://127.0.0.1:14097"
const DIRECTORY = process.env.CODEPLANE_DIRECTORY ?? "/workspace/codeplane"
const PROVIDER_ID = process.env.CODEPLANE_PROVIDER ?? "logicplanes"
const MODEL_FILTER = (process.env.CODEPLANE_MODELS ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
const TIMEOUT_MS = Number(process.env.CODEPLANE_TIMEOUT_MS ?? "180000")
const VARIANT_MODELS = new Set(["chatgpt-sub/gpt-5.4", "chatgpt-sub/gpt-5.5"])
const PASS = "\x1b[32mPASS\x1b[0m"
const FAIL = "\x1b[31mFAIL\x1b[0m"
const WARN = "\x1b[33mWARN\x1b[0m"

const IMAGE = `data:image/png;base64,${Buffer.from(
  await Bun.file(new URL("../packages/codeplane/test/tool/fixtures/large-image.png", import.meta.url)).arrayBuffer(),
).toString("base64")}`

const client = createCodeplaneClient({
  baseUrl: SERVER_URL,
  directory: DIRECTORY,
})

const providerPayload = await fetch(new URL("/config/providers", SERVER_URL)).then((x) => x.json() as any)
const provider = providerPayload.providers.find((item: any) => item.id === PROVIDER_ID)

if (!provider) {
  console.error(`Provider ${PROVIDER_ID} not found at ${SERVER_URL}`)
  process.exit(1)
}

const models = Object.entries(provider.models)
  .filter(([modelID]) => MODEL_FILTER.length === 0 || MODEL_FILTER.includes(modelID))
  .map(([modelID, model]) => ({
    modelID,
    model: model as any,
  }))

if (models.length === 0) {
  console.error("No models matched the current filter")
  process.exit(1)
}

console.log(`Testing ${models.length} ${PROVIDER_ID} models against ${SERVER_URL}`)
console.log(`Remote directory: ${DIRECTORY}`)

const results: Array<Record<string, unknown>> = []

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim().toUpperCase()
}

function textParts(parts: any[]) {
  return parts.filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n").trim()
}

function lastAssistant(messages: any[]) {
  return messages.filter((message) => message.info?.role === "assistant").at(-1)
}

function errorReason(error: any) {
  return error?.data?.message ?? error?.message ?? JSON.stringify(error)
}

async function withTimeout<T>(label: string, input: Promise<T>) {
  return Promise.race([
    input,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    }),
  ])
}

async function runCase(input: {
  name: string
  modelID: string
  variant?: string
  parts: any[]
  expect: string
  requireTool?: string
}) {
  const created = await client.session.create({
    title: `logicplanes smoke: ${input.name}`,
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
  if (created.error) throw created.error

  const sessionID = created.data.id

  try {
    const prompted = await withTimeout(
      input.name,
      client.session.prompt({
        sessionID,
        model: {
          providerID: PROVIDER_ID,
          modelID: input.modelID,
        },
        ...(input.variant ? { variant: input.variant } : {}),
        parts: input.parts,
      }),
    )

    if ((prompted as any).error) {
      return {
        ok: false,
        reason: errorReason((prompted as any).error),
        sessionID,
      }
    }

    const promptError = (prompted as any).data?.info?.error
    if (promptError) {
      return {
        ok: false,
        reason: errorReason(promptError),
        sessionID,
      }
    }

    const messages = await client.session.messages({ sessionID, limit: 20 })
    if (messages.error) {
      return {
        ok: false,
        reason: String(messages.error),
        sessionID,
      }
    }

    const assistantError = lastAssistant(messages.data)?.info?.error
    if (assistantError) {
      return {
        ok: false,
        reason: errorReason(assistantError),
        sessionID,
      }
    }

    const response = textParts((prompted as any).data?.parts ?? [])
    if (normalize(response) !== normalize(input.expect)) {
      return {
        ok: false,
        reason: `expected "${input.expect}" but got "${response}"`,
        sessionID,
      }
    }

    if (!input.requireTool) {
      return {
        ok: true,
        response,
        sessionID,
      }
    }

    const toolCalls = messages.data
      .filter((message: any) => message.info?.role === "assistant")
      .flatMap((message: any) => message.parts ?? [])
      .filter(
        (part: any) =>
          part.type === "tool" &&
          part.tool === input.requireTool &&
          part.state?.status === "completed",
      )

    if (toolCalls.length === 0) {
      return {
        ok: false,
        reason: `no completed ${input.requireTool} tool call found`,
        sessionID,
      }
    }

    return {
      ok: true,
      response,
      toolCalls: toolCalls.length,
      sessionID,
    }
  } catch (error) {
    await client.session.abort({ sessionID }).catch(() => undefined)
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      sessionID,
    }
  } finally {
    await client.session.delete({ sessionID }).catch(() => undefined)
  }
}

for (const item of models) {
  const text = await runCase({
    name: `${item.modelID} text`,
    modelID: item.modelID,
    parts: [{ type: "text", text: "Reply with exactly TEXT_OK." }],
    expect: "TEXT_OK",
  })
  results.push({
    type: "text",
    modelID: item.modelID,
    ok: text.ok,
    ...(item.model.variants ? { variants: Object.keys(item.model.variants) } : {}),
    ...(text.ok ? {} : { reason: text.reason }),
  })
  console.log(`${text.ok ? PASS : FAIL} text ${item.modelID}${text.ok ? "" : ` :: ${text.reason}`}`)

  if (item.model.capabilities?.toolcall) {
    const tool = await runCase({
      name: `${item.modelID} tool`,
      modelID: item.modelID,
      parts: [
        {
          type: "text",
          text: "You must call the bash tool with command printf TOOL_OK. After the tool succeeds, reply with exactly TOOL_OK.",
        },
      ],
      expect: "TOOL_OK",
      requireTool: "bash",
    })
    results.push({
      type: "tool",
      modelID: item.modelID,
      ok: tool.ok,
      ...(tool.ok ? {} : { reason: tool.reason }),
    })
    console.log(`${tool.ok ? PASS : FAIL} tool ${item.modelID}${tool.ok ? "" : ` :: ${tool.reason}`}`)
  } else {
    console.log(`${WARN} tool ${item.modelID} skipped by config`)
  }

  if (item.model.capabilities?.attachment) {
    const image = await runCase({
      name: `${item.modelID} image`,
      modelID: item.modelID,
      parts: [
        {
          type: "file",
          mime: "image/png",
          filename: "logicplanes-vision.png",
          url: IMAGE,
        },
        {
          type: "text",
          text: "Look at the attached image. What product name appears large in the middle of the dark window? Reply with exactly OPENCODE.",
        },
      ],
      expect: "OPENCODE",
    })
    results.push({
      type: "image",
      modelID: item.modelID,
      ok: image.ok,
      ...(image.ok ? {} : { reason: image.reason }),
    })
    console.log(`${image.ok ? PASS : FAIL} image ${item.modelID}${image.ok ? "" : ` :: ${image.reason}`}`)
  } else {
    console.log(`${WARN} image ${item.modelID} skipped by config`)
  }

  if (!VARIANT_MODELS.has(item.modelID)) continue

  for (const variant of Object.keys(item.model.variants ?? {})) {
    const variantResult = await runCase({
      name: `${item.modelID} variant ${variant}`,
      modelID: item.modelID,
      variant,
      parts: [{ type: "text", text: "Reply with exactly VARIANT_OK." }],
      expect: "VARIANT_OK",
    })
    results.push({
      type: "variant",
      modelID: item.modelID,
      variant,
      ok: variantResult.ok,
      ...(variantResult.ok ? {} : { reason: variantResult.reason }),
    })
    console.log(
      `${variantResult.ok ? PASS : FAIL} variant ${item.modelID}#${variant}${variantResult.ok ? "" : ` :: ${variantResult.reason}`}`,
    )
  }
}

const failures = results.filter((item) => item.ok !== true)

console.log()
console.log(
  JSON.stringify(
    {
      providerID: PROVIDER_ID,
      serverURL: SERVER_URL,
      directory: DIRECTORY,
      totals: {
        checks: results.length,
        failed: failures.length,
        passed: results.length - failures.length,
      },
      failures,
    },
    null,
    2,
  ),
)

if (failures.length > 0) process.exit(1)
