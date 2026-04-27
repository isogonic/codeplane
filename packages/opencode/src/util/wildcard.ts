import { sortBy, pipe } from "remeda"

const MAX_REGEX_CACHE = 4096
const regexCache = new Map<string, RegExp>()
const partsCache = new Map<string, string[]>()
const flags = process.platform === "win32" ? "si" : "s"

function normalize(value: string) {
  return value.includes("\\") ? value.replaceAll("\\", "/") : value
}

function regex(pattern: string) {
  const normalized = normalize(pattern)
  const cached = regexCache.get(normalized)
  if (cached) return cached

  let escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars
    .replace(/\*/g, ".*") // * becomes .*
    .replace(/\?/g, ".") // ? becomes .

  // If pattern ends with " *" (space + wildcard), make the trailing part optional
  // This allows "ls *" to match both "ls" and "ls -la"
  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }

  if (regexCache.size >= MAX_REGEX_CACHE) regexCache.clear()
  const result = new RegExp("^" + escaped + "$", flags)
  regexCache.set(normalized, result)
  return result
}

export function match(str: string, pattern: string) {
  return regex(pattern).test(normalize(str))
}

export function all(input: string, patterns: Record<string, any>) {
  const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
  let result = undefined
  for (const [pattern, value] of sorted) {
    if (match(input, pattern)) {
      result = value
      continue
    }
  }
  return result
}

export function allStructured(input: { head: string; tail: string[] }, patterns: Record<string, any>) {
  const sorted = pipe(patterns, Object.entries, sortBy([([key]) => key.length, "asc"], [([key]) => key, "asc"]))
  let result = undefined
  for (const [pattern, value] of sorted) {
    const parts = split(pattern)
    if (!match(input.head, parts[0])) continue
    if (parts.length === 1 || matchSequence(input.tail, parts, 0, 1)) {
      result = value
      continue
    }
  }
  return result
}

function split(pattern: string) {
  const cached = partsCache.get(pattern)
  if (cached) return cached
  if (partsCache.size >= MAX_REGEX_CACHE) partsCache.clear()
  const result = pattern.split(/\s+/)
  partsCache.set(pattern, result)
  return result
}

function matchSequence(items: string[], patterns: string[], itemIndex: number, patternIndex: number): boolean {
  if (patternIndex >= patterns.length) return true
  const pattern = patterns[patternIndex]
  if (pattern === "*") return matchSequence(items, patterns, itemIndex, patternIndex + 1)
  for (let i = itemIndex; i < items.length; i++) {
    if (match(items[i], pattern) && matchSequence(items, patterns, i + 1, patternIndex + 1)) {
      return true
    }
  }
  return false
}
