import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs"
import { formatPatch, parsePatch, structuredPatch } from "diff"
import type { SnapshotFileDiff, VcsFileDiff } from "@codeplane-ai/sdk/v2"

type LegacyDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

type ReviewDiff = SnapshotFileDiff | VcsFileDiff | LegacyDiff

export type ViewDiff = {
  file: string
  patch: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  fileDiff: FileDiffMetadata
}

const cache = new Map<string, FileDiffMetadata>()

function textField(diff: ReviewDiff, key: "before" | "after") {
  const value = (diff as Record<string, unknown>)[key]
  if (typeof value === "string") return value
  return ""
}

function matches(file: string, name: string | undefined) {
  if (!name || name === "/dev/null") return false
  return name === file || name === `a/${file}` || name === `b/${file}` || name.endsWith(`/${file}`)
}

function parsed(file: string, patch: string) {
  const list = parsePatch(patch)
  return (
    list.find((item) => matches(file, item.oldFileName) || matches(file, item.newFileName)) ??
    list.find((item) => item.hunks.length > 0) ??
    list[0]
  )
}

function fromPatch(diff: ReviewDiff) {
  const patch = parsed(diff.file, diff.patch ?? "")

  if (!patch?.hunks.length) {
    return {
      before: textField(diff, "before"),
      after: textField(diff, "after"),
      patch: diff.patch ?? "",
    }
  }

  const beforeLines = []
  const afterLines = []
  let beforeEndsWithNewline = true
  let afterEndsWithNewline = true
  let lastSide: "before" | "after" | "both" | undefined

  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        if (lastSide === "before" || lastSide === "both") beforeEndsWithNewline = false
        if (lastSide === "after" || lastSide === "both") afterEndsWithNewline = false
        continue
      }
      if (line.startsWith("-")) {
        beforeLines.push(line.slice(1))
        beforeEndsWithNewline = true
        lastSide = "before"
        continue
      }
      if (line.startsWith("+")) {
        afterLines.push(line.slice(1))
        afterEndsWithNewline = true
        lastSide = "after"
        continue
      }
      beforeLines.push(line.startsWith(" ") ? line.slice(1) : line)
      afterLines.push(line.startsWith(" ") ? line.slice(1) : line)
      beforeEndsWithNewline = true
      afterEndsWithNewline = true
      lastSide = "both"
    }
  }

  return {
    before: beforeLines.length ? beforeLines.join("\n") + (beforeEndsWithNewline ? "\n" : "") : "",
    after: afterLines.length ? afterLines.join("\n") + (afterEndsWithNewline ? "\n" : "") : "",
    patch: diff.patch ?? "",
  }
}

function patch(diff: ReviewDiff) {
  if (typeof diff.patch === "string") return fromPatch(diff)

  return {
    before: textField(diff, "before"),
    after: textField(diff, "after"),
    patch: formatPatch(
      structuredPatch(
        diff.file,
        diff.file,
        textField(diff, "before"),
        textField(diff, "after"),
        "",
        "",
        { context: Number.MAX_SAFE_INTEGER },
      ),
    ),
  }
}

function file(file: string, patch: string, before: string, after: string) {
  const key = `${file}\0${patch}`
  const hit = cache.get(key)
  if (hit) return hit

  const value = parseDiffFromFile({ name: file, contents: before }, { name: file, contents: after })
  cache.set(key, value)
  return value
}

export function normalize(diff: ReviewDiff): ViewDiff {
  const next = patch(diff)
  return {
    file: diff.file,
    patch: next.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
    fileDiff: file(diff.file, next.patch, next.before, next.after),
  }
}

export function text(diff: ViewDiff, side: "deletions" | "additions") {
  if (side === "deletions") return diff.fileDiff.deletionLines.join("")
  return diff.fileDiff.additionLines.join("")
}
