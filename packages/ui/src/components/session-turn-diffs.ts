import type { AssistantMessage, Part as PartType, SnapshotFileDiff } from "@codeplane-ai/sdk/v2/client"

const mutatingTools = new Set(["apply_patch", "edit", "write"])

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizePath(file: string, root?: string) {
  const value = file.replaceAll("\\", "/").replace(/^\.\//, "")
  const base = root?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!base) return value
  if (value === base) return ""
  if (value.startsWith(`${base}/`)) return value.slice(base.length + 1)
  return value
}

function metadataFilePath(value: unknown, root?: string): string | undefined {
  if (!record(value)) return undefined
  const file =
    typeof value.relativePath === "string"
      ? value.relativePath
      : typeof value.file === "string"
        ? value.file
        : typeof value.filePath === "string"
          ? value.filePath
          : undefined
  if (!file) return undefined
  return normalizePath(file, root)
}

function metadataDiffFiles(metadata: unknown, root?: string) {
  if (!record(metadata)) return []
  return [
    metadataFilePath(metadata.filediff, root),
    ...(Array.isArray(metadata.files) ? metadata.files.map((file) => metadataFilePath(file, root)) : []),
  ].filter((file): file is string => !!file)
}

export function turnChangedFiles(input: {
  assistants: AssistantMessage[]
  partsByMessageID: Record<string, PartType[] | undefined>
}) {
  const files = new Set<string>()
  for (const assistant of input.assistants) {
    const root = assistant.path.root
    for (const part of input.partsByMessageID[assistant.id] ?? []) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (!mutatingTools.has(part.tool)) continue
      for (const file of metadataDiffFiles(part.state.metadata, root)) {
        files.add(file)
      }
    }
  }
  return files
}

export function messageDiffs(input: {
  diffs: SnapshotFileDiff[] | undefined
  assistants: AssistantMessage[]
  partsByMessageID: Record<string, PartType[] | undefined>
}) {
  if (!input.diffs?.length) return []

  const allowed = turnChangedFiles({
    assistants: input.assistants,
    partsByMessageID: input.partsByMessageID,
  })
  if (allowed.size === 0) return []

  const seen = new Set<string>()
  return input.diffs
    .reduceRight<SnapshotFileDiff[]>((result, diff) => {
      const file = normalizePath(diff.file)
      if (!allowed.has(file)) return result
      if (seen.has(file)) return result
      seen.add(file)
      result.push(diff)
      return result
    }, [])
    .reverse()
}
