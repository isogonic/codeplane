import { describe, expect, test } from "bun:test"
import { startPreview } from "../preview/server"
import { ListFixture } from "../fixtures/list"

describe("tui-suite/preview", () => {
  test("serves index page", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/")
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain("tui-suite preview")
      expect(body).toContain("polls every")
    } finally {
      await handle.stop()
    }
  })

  test("serves frame.json with structured frame data", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/frame.json")
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.cols).toBe(100)
      expect(body.rows).toBe(30)
      expect(body.text).toContain("Alpha")
      expect(Array.isArray(body.cursor)).toBe(true)
    } finally {
      await handle.stop()
    }
  })

  test("serves frame.html with styled spans", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/frame.html")
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toContain("<pre id=\"frame\">")
      expect(body).toContain("<span")
    } finally {
      await handle.stop()
    }
  })

  test("POST /press advances list selection", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/press", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chord: "down" }),
      })
      expect(res.status).toBe(200)
      const json = await fetch(handle.url + "/frame.json").then((r) => r.json() as Promise<any>)
      expect(json.text).toContain("▸ Bravo")
    } finally {
      await handle.stop()
    }
  })

  test("POST /resize updates frame dims", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/resize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ width: 60, height: 18 }),
      })
      expect(res.status).toBe(200)
      const json = await fetch(handle.url + "/frame.json").then((r) => r.json() as Promise<any>)
      expect(json.cols).toBe(60)
      expect(json.rows).toBe(18)
    } finally {
      await handle.stop()
    }
  })

  test("404s on unknown path", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/does-not-exist")
      expect(res.status).toBe(404)
    } finally {
      await handle.stop()
    }
  })

  test("invalid chord returns 500", async () => {
    const handle = await startPreview({ factory: () => <ListFixture /> })
    try {
      const res = await fetch(handle.url + "/press", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chord: "this is not a chord!!!" }),
      })
      expect(res.status).toBe(500)
    } finally {
      await handle.stop()
    }
  })
})
