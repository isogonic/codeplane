import { describe, expect, test } from "bun:test"
import { findListeningPort, resolveLocalTarget } from "../src/main/local-instance"

describe("EXTREME desktop findListeningPort", () => {
  for (let port = 1024; port < 1224; port++) {
    test(`http port ${port}`, () =>
      expect(findListeningPort(`listening on http://127.0.0.1:${port}`)).toBe(port))
  }
  for (let port = 8000; port < 8100; port++) {
    test(`https port ${port}`, () =>
      expect(findListeningPort(`listening at https://0.0.0.0:${port}`)).toBe(port))
  }
  for (let port = 4000; port < 4100; port++) {
    test(`server started port ${port}`, () =>
      expect(findListeningPort(`server started on http://localhost:${port}`)).toBe(port))
  }
  for (let port = 5000; port < 5050; port++) {
    test(`server ready port ${port}`, () =>
      expect(findListeningPort(`server ready on http://localhost:${port}`)).toBe(port))
  }
})

describe("EXTREME desktop resolveLocalTarget consistency", () => {
  for (let i = 0; i < 200; i++) {
    test(`target call #${i} consistent`, () => {
      const a = resolveLocalTarget()
      const b = resolveLocalTarget()
      expect(a.os).toBe(b.os)
      expect(a.arch).toBe(b.arch)
      expect(a.binaryName).toBe(b.binaryName)
      expect(a.archiveName).toBe(b.archiveName)
      expect(a.archiveExt).toBe(b.archiveExt)
      expect(a.packageName).toBe(b.packageName)
    })
  }
})
