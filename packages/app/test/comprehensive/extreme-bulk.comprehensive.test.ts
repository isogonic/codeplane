import { describe, expect, test } from "bun:test"
import { agentColor } from "../../src/utils/agent"
import {
  attachmentInput,
  modelSupportsAttachment,
  modelSupportsInput,
} from "../../src/utils/model-capabilities"
import { same } from "../../src/utils/same"
import { isResizeObserverNoise } from "../../src/utils/silence-resize-observer"
import {
  describeSessionError,
  isIgnorableSessionError,
} from "../../src/utils/session-error"
import { Worktree } from "../../src/utils/worktree"
import {
  isDisposable,
  hasSetOption,
  setOptionIfSupported,
} from "../../src/utils/runtime-adapters"
import { formatServerError } from "../../src/utils/server-errors"
import { diffs } from "../../src/utils/diffs"
import { formatCommentNote, parseCommentNote } from "../../src/utils/comment-note"

describe("APP EXTREME - agentColor", () => {
  for (let i = 0; i < 200; i++) {
    test(`agent ${i} returns string`, () => {
      expect(typeof agentColor(`agent-${i}`)).toBe("string")
    })
  }
})

describe("APP EXTREME - attachmentInput images", () => {
  for (let i = 0; i < 100; i++) {
    test(`image ${i}`, () => expect(attachmentInput(`image/type-${i}`)).toBe("image"))
  }
})

describe("APP EXTREME - attachmentInput audio", () => {
  for (let i = 0; i < 100; i++) {
    test(`audio ${i}`, () => expect(attachmentInput(`audio/type-${i}`)).toBe("audio"))
  }
})

describe("APP EXTREME - attachmentInput video", () => {
  for (let i = 0; i < 100; i++) {
    test(`video ${i}`, () => expect(attachmentInput(`video/type-${i}`)).toBe("video"))
  }
})

describe("APP EXTREME - same array equality", () => {
  for (let len = 0; len < 100; len++) {
    test(`same length ${len}`, () => {
      const a = Array.from({ length: len }, (_, i) => i)
      const b = Array.from({ length: len }, (_, i) => i)
      expect(same(a, b)).toBe(true)
    })
  }
})

describe("APP EXTREME - resize observer noise", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk match #${i}`, () =>
      expect(isResizeObserverNoise(`ResizeObserver loop ${i}`)).toBe(true))
    test(`bulk no match #${i}`, () =>
      expect(isResizeObserverNoise(`other-${i}`)).toBe(false))
  }
})

describe("APP EXTREME - session error description", () => {
  for (let i = 0; i < 100; i++) {
    test(`error name #${i}`, () =>
      expect(describeSessionError({ name: `Err-${i}` } as never)).toBe(`Err-${i}`))
  }
  for (let i = 0; i < 100; i++) {
    test(`error message #${i}`, () =>
      expect(
        describeSessionError({ name: "X", data: { message: `msg-${i}` } } as never),
      ).toBe(`msg-${i}`))
  }
})

describe("APP EXTREME - session error ignorable", () => {
  for (let i = 0; i < 100; i++) {
    test(`other-${i} not ignorable`, () =>
      expect(isIgnorableSessionError({ name: `Err-${i}` } as never)).toBe(false))
  }
})

describe("APP EXTREME - worktree state", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk pending->ready #${i}`, () => {
      const dir = `/dir-extreme-${i}-${Math.random()}`
      Worktree.pending(dir)
      Worktree.ready(dir)
      expect(Worktree.get(dir)?.status).toBe("ready")
    })
  }
})

describe("APP EXTREME - runtime-adapters disposable", () => {
  for (let i = 0; i < 100; i++) {
    test(`disposable #${i}`, () => {
      expect(isDisposable({ dispose: () => i })).toBe(true)
    })
  }
})

describe("APP EXTREME - runtime-adapters hasSetOption", () => {
  for (let i = 0; i < 100; i++) {
    test(`setOption #${i}`, () => {
      expect(hasSetOption({ setOption: () => i })).toBe(true)
    })
  }
})

describe("APP EXTREME - setOptionIfSupported", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk setOption call ${i}`, () => {
      let last: unknown
      setOptionIfSupported(
        {
          setOption: (_k: string, v: unknown) => {
            last = v
          },
        },
        `k-${i}`,
        i,
      )
      expect(last).toBe(i)
    })
  }
})

describe("APP EXTREME - formatServerError Errors", () => {
  for (let i = 0; i < 100; i++) {
    test(`Error ${i}`, () => expect(formatServerError(new Error(`oops-${i}`))).toBe(`oops-${i}`))
  }
})

describe("APP EXTREME - diffs valid", () => {
  for (let n = 1; n < 100; n++) {
    test(`array of ${n}`, () => {
      const arr = Array.from({ length: n }, (_, i) => ({
        file: `f${i}.ts`,
        patch: "diff",
        additions: 1,
        deletions: 0,
      }))
      expect(diffs(arr)).toHaveLength(n)
    })
  }
})

describe("APP EXTREME - comment note round-trip single line", () => {
  for (let i = 0; i < 100; i++) {
    test(`single-line ${i}`, () => {
      const note = formatCommentNote({
        path: `f-${i}.ts`,
        selection: { startLine: i, startChar: 0, endLine: i, endChar: 0 },
        comment: `c-${i}`,
      })
      const parsed = parseCommentNote(note)
      expect(parsed?.path).toBe(`f-${i}.ts`)
    })
  }
})

describe("APP EXTREME - modelSupportsAttachment defaults", () => {
  for (let i = 0; i < 100; i++) {
    test(`text mime ${i}`, () =>
      expect(modelSupportsAttachment(undefined, `text/plain-${i}`)).toBe(true))
  }
})

describe("APP EXTREME - modelSupportsInput undefined", () => {
  for (const input of ["text", "image", "audio", "video", "pdf"] as const) {
    for (let i = 0; i < 30; i++) {
      test(`undefined ${input} ${i}`, () =>
        expect(modelSupportsInput(undefined, input)).toBe(false))
    }
  }
})
