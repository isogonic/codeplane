import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

let PacedMarkdown: typeof import("./paced-markdown").PacedMarkdown
let seen: string[] = []
let readStreaming: (() => boolean) | undefined
let mounts = 0

beforeAll(async () => {
  void mock.module("./markdown", () => ({
    Markdown: (props: { text: string }) => {
      mounts++
      seen.push(props.text)
      readStreaming = () => (props as unknown as { streaming: boolean }).streaming
      return null
    },
  }))
  PacedMarkdown = (await import("./paced-markdown")).PacedMarkdown
})

describe("PacedMarkdown", () => {
  test("passes streamed text directly into Markdown without typewriter lag", () => {
    seen = []
    mounts = 0
    createRoot(() => {
      PacedMarkdown({ text: "hello world", cacheKey: "msg", streaming: true })
    })
    expect(seen).toEqual(["hello world"])
    expect(mounts).toBe(1)
  })

  test("keeps streaming prop reactive when final text is unchanged", async () => {
    mounts = 0
    readStreaming = () => {
      throw new Error("Markdown was not rendered")
    }
    createRoot(() => {
      const [streaming, setStreaming] = createSignal(true)
      PacedMarkdown({
        text: "hello world",
        cacheKey: "msg",
        get streaming() {
          return streaming()
        },
      })
      setStreaming(false)
    })

    await Promise.resolve()
    expect(readStreaming()).toBe(false)
    expect(mounts).toBe(1)
  })

  test("does not remount Markdown for each streamed text delta", async () => {
    mounts = 0
    createRoot(() => {
      const [text, setText] = createSignal("hel")
      PacedMarkdown({
        get text() {
          return text()
        },
        cacheKey: "msg",
        streaming: true,
      })
      setText("hello")
      setText("hello world")
    })

    await Promise.resolve()
    expect(mounts).toBe(1)
  })
})
