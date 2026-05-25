import { describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util"

void Log.init({ print: false })

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: string) {
  const decoder = new TextDecoder()
  let text = ""
  for (let i = 0; i < 10; i++) {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for ${pattern}`)), 500),
      ),
    ])
    if (result.done) break
    text += decoder.decode(result.value, { stream: true })
    if (text.includes(pattern)) return text
  }
  throw new Error(`did not receive ${pattern}: ${text}`)
}

describe("global event stream", () => {
  test("marks synthetic and live recovery events as global", async () => {
    const res = await Server.Default().app.request("/global/event")
    expect(res.status).toBe(200)
    expect(res.body).toBeDefined()

    const reader = res.body!.getReader()
    try {
      const connected = await readUntil(reader, "server.connected")
      expect(connected).toContain('"directory":"global"')

      GlobalBus.emit("event", {
        directory: "global",
        payload: { type: "server.dropped", properties: {} },
      })

      const dropped = await readUntil(reader, "server.dropped")
      expect(dropped).toContain('"directory":"global"')
    } finally {
      await reader.cancel().catch(() => {})
    }
  })
})
