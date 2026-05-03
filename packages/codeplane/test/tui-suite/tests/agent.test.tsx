import { describe, expect, test } from "bun:test"
import { AgentServer, AgentClient } from "../agent"
import { FIXTURES } from "../fixtures"

describe("tui-suite/agent", () => {
  test("list returns registered fixtures", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    const { fixtures } = await client.list()
    expect(fixtures).toContain("list")
    expect(fixtures).toContain("dialog")
    expect(fixtures).toContain("input")
  })

  test("mount + frame returns rendered text", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("list")
    const f = await client.frame()
    expect(f.cols).toBe(100)
    expect(f.rows).toBe(30)
    expect(f.text).toContain("Alpha")
    await client.unmount()
  })

  test("press('down') advances list selection through agent", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("list")
    await client.press("down")
    await client.press("down")
    const found = await client.find("▸ Charlie")
    expect(found).not.toBeNull()
    await client.unmount()
  })

  test("type sends text into input fixture through agent", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("input")
    await client.type("hello")
    await client.press("enter")
    const f = await client.frame()
    expect(f.text).toContain("History (1)")
    await client.unmount()
  })

  test("waitFor resolves once text appears", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("list")
    await client.waitFor("Echo", 1000)
    await client.unmount()
  })

  test("resize updates frame dims", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("list")
    const r = await client.resize(50, 12)
    expect(r.cols).toBe(50)
    expect(r.rows).toBe(12)
    await client.unmount()
  })

  test("findAll returns multiple matches", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("scroll")
    const all = await client.findAll(/item \d+/)
    expect(all.length).toBeGreaterThan(5)
    await client.unmount()
  })

  test("unknown method returns error", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const resp = await server.dispatch({ jsonrpc: "2.0", id: 1, method: "frobnicate" })
    expect(resp.error).toBeDefined()
    expect(resp.error!.message).toContain("frobnicate")
  })

  test("calling press before mount errors", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await expect(client.press("a")).rejects.toThrow(/no harness mounted/)
  })

  test("unknown fixture errors", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await expect(client.mount("nonexistent")).rejects.toThrow(/unknown fixture/)
  })

  test("regex needle works through wire format", async () => {
    const server = new AgentServer({ fixtures: FIXTURES })
    const client = AgentClient.fromServer(server)
    await client.mount("list")
    const found = await client.find(/[A-E]\w+/)
    expect(found).not.toBeNull()
    await client.unmount()
  })
})
