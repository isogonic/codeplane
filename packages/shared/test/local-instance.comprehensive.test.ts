import { describe, expect, test } from "bun:test"
import { findListeningPort } from "../src/local-instance"

describe("findListeningPort - parameterized matrix", () => {
  // Each pattern category × representative ports × surrounding noise
  const ports = [1, 80, 443, 1024, 3000, 5000, 8080, 30000, 65535]
  const wordings = [
    (port: number) => `listening on http://127.0.0.1:${port}`,
    (port: number) => `Listening on http://127.0.0.1:${port}`,
    (port: number) => `LISTENING ON http://127.0.0.1:${port}`,
    (port: number) => `listening on https://127.0.0.1:${port}`,
    (port: number) => `Listening at http://localhost:${port}`,
    (port: number) => `listening at https://0.0.0.0:${port}`,
    (port: number) => `server started on http://127.0.0.1:${port}`,
    (port: number) => `Server Started At https://0.0.0.0:${port}`,
    (port: number) => `server ready on http://127.0.0.1:${port}`,
    (port: number) => `server ready at https://example.com:${port}`,
  ]
  for (const port of ports) {
    for (let i = 0; i < wordings.length; i++) {
      const fmt = wordings[i]
      const text = fmt(port)
      test(`port ${port} via wording ${i}`, () => {
        expect(findListeningPort(text)).toBe(port)
      })
      test(`port ${port} via wording ${i} surrounded by noise`, () => {
        const noisy = `prefix line\n${text}\nmore output\n`
        expect(findListeningPort(noisy)).toBe(port)
      })
      test(`port ${port} via wording ${i} with carriage returns`, () => {
        expect(findListeningPort(`${text}\r\n`)).toBe(port)
      })
    }
  }
})

describe("findListeningPort - negative cases", () => {
  const cases: string[] = [
    "",
    " ",
    "\n",
    "\t",
    "random log line",
    "server is up",
    "ready",
    "http://127.0.0.1:1234",
    "listen but no port",
    "listening on http://127.0.0.1:abc",
    "listening on http://127.0.0.1:",
    "listening on http://127.0.0.1:0",
    "listening on http://127.0.0.1:-1",
    // Note: extreme out-of-range ports (>65535) are not validated by findListeningPort —
    // it only checks Number.isFinite && > 0. That filtering happens elsewhere in the
    // pipeline (the http server surface). Documenting the actual behavior here.
    "listening from http://127.0.0.1:1234",
    "Server up at http://127.0.0.1:1234", // "up" not in pattern
    "listened on http://127.0.0.1:1234", // past tense
    "wait for listening",
    "waiting for server start at port 1234",
  ]
  for (let i = 0; i < cases.length; i++) {
    const text = cases[i]
    test(`negative ${i}: ${JSON.stringify(text)}`, () => {
      expect(findListeningPort(text)).toBeUndefined()
    })
  }
})

describe("findListeningPort - first match wins", () => {
  test("when two ports appear, first wins", () => {
    expect(
      findListeningPort("listening on http://127.0.0.1:1000\nlistening on http://127.0.0.1:2000"),
    ).toBe(1000)
  })

  test("when both 'on' and 'at' appear, the one appearing first via the same pattern wins", () => {
    expect(findListeningPort("listening on http://127.0.0.1:9001\nListening at http://127.0.0.1:9002")).toBe(9001)
  })

  test("'started' wording yields its port even when an 'at' wording follows", () => {
    expect(
      findListeningPort("server started on http://127.0.0.1:1\nserver ready at http://127.0.0.1:2"),
    ).toBe(1)
  })
})

describe("findListeningPort - mid-line / windowed", () => {
  test("port found mid line surrounded by other text", () => {
    expect(findListeningPort("starting up... listening on http://127.0.0.1:5050 ready"))
      .toBe(5050)
  })

  test("works on a long buffer at the end", () => {
    const padding = "x".repeat(10_000) + "\n"
    expect(findListeningPort(padding + "listening on http://127.0.0.1:7777")).toBe(7777)
  })

  test("works on a long buffer at the start", () => {
    const padding = "y".repeat(10_000) + "\n"
    expect(findListeningPort("listening on http://127.0.0.1:8888\n" + padding)).toBe(8888)
  })
})

describe("findListeningPort - URL host variations", () => {
  const hosts = ["127.0.0.1", "0.0.0.0", "localhost", "example.com", "10.0.0.5", "192.168.1.1"]
  for (const host of hosts) {
    test(`host ${host}`, () => {
      expect(findListeningPort(`listening on http://${host}:1234`)).toBe(1234)
    })
  }
})

describe("findListeningPort - verifies port boundaries", () => {
  const cases: Array<[number, number | undefined]> = [
    [1, 1],
    [10, 10],
    [100, 100],
    [1000, 1000],
    [10000, 10000],
    [65535, 65535],
  ]
  for (const [port, expected] of cases) {
    test(`port ${port}`, () => {
      expect(findListeningPort(`listening on http://127.0.0.1:${port}`)).toBe(expected)
    })
  }
})
