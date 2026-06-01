import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { CronClient } from "./cron-client"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

describe("CronClient.cancelRun", () => {
  test("posts to the cancel endpoint for one run", async () => {
    let request: Request | undefined
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init)
      return new Response(JSON.stringify(true), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    try {
      const result = await CronClient.cancelRun(server, "run/id with spaces")

      expect(result).toBe(true)
      expect(request?.method).toBe("POST")
      expect(request?.url).toBe("http://localhost:4096/global/cron/runs/run%2Fid%20with%20spaces/cancel")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
