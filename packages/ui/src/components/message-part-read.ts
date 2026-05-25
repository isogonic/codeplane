function positiveInteger(value: unknown) {
  if (typeof value !== "number") return
  if (!Number.isInteger(value) || value <= 0) return
  return value
}

export function readToolLineRange(input: Record<string, unknown>) {
  const offset = positiveInteger(input.offset)
  const limit = positiveInteger(input.limit)
  if (offset === undefined && limit === undefined) return

  const start = offset ?? 1
  if (limit === undefined) return `L${start}+`
  if (limit === 1) return `L${start}`
  return `L${start}-${start + limit - 1}`
}

export function readToolFilePath(input: Record<string, unknown>) {
  const value = input.filePath
  return typeof value === "string" && value ? value : ""
}

export function readToolDirectoryLabel(value: string | undefined) {
  if (!value || value === "/" || value === ".") return ""
  return value.replace(/[\\/]+$/, "")
}
