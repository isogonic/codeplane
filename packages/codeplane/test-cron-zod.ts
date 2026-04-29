import { Cron } from "./src/cron/cron"
import { zodObject } from "./src/util/effect-zod"
import z from "zod"

// Test what the CREATE endpoint validates
const createSchema = Cron.CreateInput.zod
console.log("=== CREATE SCHEMA ===")
console.log(JSON.stringify((createSchema as any).shape ? 
  Object.keys((createSchema as any).shape) : "unknown", null, 2))

// Test what the hono-openapi validator would receive
const testCases = [
  // Happy path
  {
    label: "valid cron",
    body: {
      projectID: "global",
      directory: "/home/user/project",
      name: "My Daily Task",
      prompt: "Summarize yesterday's work",
      schedule: { kind: "cron", expression: "0 9 * * 1-5" },
      status: "active",
      timeoutMs: 1800000,
    }
  },
  // Missing required
  {
    label: "missing name",
    body: {
      projectID: "global",
      prompt: "Summarize",
      schedule: { kind: "cron", expression: "0 9 * * 1-5" },
    }
  },
  // With model 
  {
    label: "with model",
    body: {
      projectID: "global",
      name: "Task",
      prompt: "Do it",
      schedule: { kind: "cron", expression: "0 9 * * 1-5" },
      model: "anthropic/claude-3-5-sonnet-20241022",
      status: "active",
    }
  },
]

for (const tc of testCases) {
  const r = await (createSchema as any)["~standard"].validate(tc.body)
  if (r.issues) {
    console.log(`\n[FAIL] ${tc.label}:`)
    for (const issue of r.issues) {
      console.log(`  - [${issue.path?.join('.')}] ${issue.message}`)
    }
  } else {
    console.log(`\n[OK] ${tc.label}`)
  }
}

// Also test the UpdateInput body schema (without taskID)
console.log("\n=== UPDATE BODY SCHEMA ===")
const updateBodySchema = zodObject(Cron.UpdateInput).omit({ taskID: true })
const r = await (updateBodySchema as any)["~standard"].validate({
  name: "New name",
  schedule: { kind: "cron", expression: "0 9 * * 1-5" },
})
console.log("update valid:", !r.issues)
