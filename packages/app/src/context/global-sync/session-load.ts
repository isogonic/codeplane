import type { RootLoadArgs } from "./types"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  if (input.limit === undefined) {
    const result = await input.list({ directory: input.directory, roots: true })
    return {
      data: result.data,
      limited: false,
    } as const
  }

  try {
    const result = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    const result = await input.list({ directory: input.directory, roots: true })
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit?: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.limit === undefined) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
