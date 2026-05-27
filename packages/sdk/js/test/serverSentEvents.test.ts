import { describe, expect, test } from "bun:test"
import { createSseClient as createSseClientV1 } from "../src/gen/core/serverSentEvents.gen"
import { createSseClient as createSseClientV2 } from "../src/v2/gen/core/serverSentEvents.gen"

type CreateSseClient = typeof createSseClientV2

function responseFromChunks(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    { status: 200, statusText: "OK" },
  )
}

async function collect(stream: AsyncGenerator<unknown>) {
  const items: unknown[] = []
  for await (const item of stream) {
    items.push(item)
  }
  return items
}

for (const item of [
  { name: "v1", createSseClient: createSseClientV1 as CreateSseClient },
  { name: "v2", createSseClient: createSseClientV2 },
]) {
  describe(`${item.name} createSseClient`, () => {
    test("normalizes CRLF/CR chunks and yields parsed events", async () => {
      const seen: Array<{ data: unknown; event?: string; id?: string; retry?: number }> = []
      const result = item.createSseClient({
        url: "https://example.test/events",
        fetch: async () =>
          responseFromChunks([
            'id: 1\r\nevent: update\r\ndata: {"ok":',
            "true}\r\nretry: 123\r\n\r\n",
            "data: plain\r\r",
          ]),
        onSseEvent: (event) => seen.push(event),
      })

      await expect(collect(result.stream)).resolves.toEqual([{ ok: true }, "plain"])
      expect(seen).toEqual([
        { data: { ok: true }, event: "update", id: "1", retry: 123 },
        { data: "plain", event: undefined, id: "1", retry: 123 },
      ])
    })

    test("reports errors and retries with backoff", async () => {
      const errors: unknown[] = []
      const sleeps: number[] = []
      const requests: Request[] = []
      let calls = 0
      const result = item.createSseClient({
        url: "https://example.test/events",
        fetch: async (request) => {
          calls++
          requests.push(request as Request)
          if (calls === 1) throw new Error("network down")
          return responseFromChunks(['data: {"ok":true}\n\n'])
        },
        onSseError: (error) => errors.push(error),
        sseDefaultRetryDelay: 20,
        sseMaxRetryAttempts: 2,
        sseSleepFn: async (ms) => {
          sleeps.push(ms)
        },
      })

      await expect(collect(result.stream)).resolves.toEqual([{ ok: true }])
      expect(calls).toBe(2)
      expect(requests).toHaveLength(2)
      expect(errors).toHaveLength(1)
      expect(sleeps).toHaveLength(1)
      expect(sleeps[0]).toBeGreaterThanOrEqual(10)
      expect(sleeps[0]).toBeLessThanOrEqual(20)
    })
  })
}
