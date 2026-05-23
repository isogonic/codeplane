import type { PlatformUpdateStatus } from "./platform"

function cleanVersion(input: string | null | undefined) {
  return (input ?? "").trim().replace(/^[vV]/, "")
}

function versionCore(input: string) {
  return cleanVersion(input)
    .replace(/-(desktop|mobile)$/i, "")
    .split(/[+-]/)[0]
}

function versionParts(input: string) {
  const core = versionCore(input)
  const parts = core.split(".").map((part) => Number.parseInt(part, 10))
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return
  return parts
}

export function compareUpdateVersions(a: string | null | undefined, b: string | null | undefined) {
  const leftClean = cleanVersion(a)
  const rightClean = cleanVersion(b)
  if (leftClean === rightClean) return 0

  const left = versionParts(leftClean)
  const right = versionParts(rightClean)
  if (!left || !right) return leftClean.localeCompare(rightClean)

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function isUpdateNewer(current: string | null | undefined, latest: string | null | undefined) {
  const cleanCurrent = cleanVersion(current)
  const cleanLatest = cleanVersion(latest)
  if (!cleanLatest) return false
  if (!cleanCurrent) return true
  if (cleanCurrent === "dev" || cleanCurrent === "local") return false
  return compareUpdateVersions(cleanLatest, cleanCurrent) > 0
}

export function normalizeUpdateStatus<T extends PlatformUpdateStatus>(
  status: T,
): Omit<T, "hasUpdate"> & { hasUpdate: boolean } {
  return {
    ...status,
    hasUpdate: isUpdateNewer(status.current, status.latest),
  }
}
