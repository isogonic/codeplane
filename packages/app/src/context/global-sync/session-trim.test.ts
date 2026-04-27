import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@codeplane-ai/sdk/v2/client"
import { trimSessions } from "./session-trim"

const session = (input: { id: string; parentID?: string; created: number; updated?: number; archived?: number }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    time: {
      created: input.created,
      updated: input.updated,
      archived: input.archived,
    },
  }) as Session

describe("trimSessions", () => {
  test("keeps fetched roots beyond the visible page limit", () => {
    const now = 1_000_000
    const list = [
      session({ id: "a", created: now - 100_000 }),
      session({ id: "b", created: now - 90_000 }),
      session({ id: "c", created: now - 80_000, updated: now - 10_000_000 }),
      session({ id: "d", created: now - 70_000, updated: now - 1_000 }),
      session({ id: "e", created: now - 60_000, archived: now - 10 }),
    ]

    const result = trimSessions(list, { limit: 2, permission: {}, now })
    expect(result.map((x) => x.id)).toEqual(["a", "b", "c", "d"])
  })

  test("caps roots at the loaded-session window", () => {
    const now = 100_000_000
    const result = trimSessions(
      Array.from({ length: 60 }, (_, index) =>
        session({
          id: `s-${index.toString().padStart(2, "0")}`,
          created: index,
          updated: index,
        }),
      ),
      { limit: 2, permission: {}, now },
    )

    expect(result).toHaveLength(52)
    expect(result.map((x) => x.id)).not.toContain("s-00")
    expect(result.map((x) => x.id)).toContain("s-59")
  })

  test("keeps preserved old roots outside the loaded-session window", () => {
    const now = 100_000_000
    const result = trimSessions(
      [
        session({ id: "active-old", created: 1, updated: 1 }),
        ...Array.from({ length: 60 }, (_, index) =>
          session({
            id: `s-${index.toString().padStart(2, "0")}`,
            created: now + index,
            updated: now + index,
          }),
        ),
      ],
      { limit: 2, permission: {}, now, preserve: ["active-old"] },
    )

    expect(result.map((x) => x.id)).toContain("active-old")
    expect(result.map((x) => x.id)).not.toContain("s-00")
  })

  test("keeps preserved archived roots for read-only archive views", () => {
    const now = 100_000_000
    const result = trimSessions(
      [
        session({ id: "archived-old", created: 1, updated: 1, archived: now }),
        ...Array.from({ length: 2 }, (_, index) =>
          session({
            id: `s-${index.toString().padStart(2, "0")}`,
            created: now + index,
            updated: now + index,
          }),
        ),
      ],
      { limit: 2, permission: {}, now, preserve: ["archived-old"] },
    )

    expect(result.map((x) => x.id)).toContain("archived-old")
  })

  test("drops unpreserved archived roots", () => {
    const now = 100_000_000
    const result = trimSessions(
      [
        session({ id: "archived-old", created: 1, updated: 1, archived: now }),
        session({ id: "active", created: now, updated: now }),
      ],
      { limit: 2, permission: {}, now },
    )

    expect(result.map((x) => x.id)).not.toContain("archived-old")
  })

  test("keeps children when root is kept, permission exists, or child is recent", () => {
    const now = 1_000_000
    const list = [
      session({ id: "root-1", created: now - 1000 }),
      session({ id: "root-2", created: now - 2000 }),
      ...Array.from({ length: 52 }, (_, index) =>
        session({ id: `filler-${index.toString().padStart(2, "0")}`, created: now - 3000 - index }),
      ),
      session({ id: "z-root", created: now - 30_000_000 }),
      session({ id: "child-kept-by-root", parentID: "root-1", created: now - 20_000_000 }),
      session({ id: "child-kept-by-permission", parentID: "z-root", created: now - 20_000_000 }),
      session({ id: "child-kept-by-recency", parentID: "z-root", created: now - 500 }),
      session({ id: "child-trimmed", parentID: "z-root", created: now - 20_000_000 }),
    ]

    const result = trimSessions(list, {
      limit: 2,
      permission: {
        "child-kept-by-permission": [{ id: "perm-1" } as PermissionRequest],
      },
      now,
    })

    const ids = result.map((x) => x.id)
    expect(ids).toContain("child-kept-by-root")
    expect(ids).toContain("child-kept-by-permission")
    expect(ids).toContain("child-kept-by-recency")
    expect(ids).not.toContain("child-trimmed")
    expect(ids).not.toContain("z-root")
  })
})
