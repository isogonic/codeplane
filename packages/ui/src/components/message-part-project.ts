const operationLabels: Record<string, string> = {
  info: "info",
  detect: "detect",
  commands: "commands",
  check: "check",
  run: "run",
  config_set: "save command",
  config_remove: "remove command",
  context: "context",
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : ""
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function unique(values: string[]) {
  return values.filter((value, index) => value.length > 0 && values.indexOf(value) === index)
}

export function projectToolOperation(input: Record<string, unknown>, metadata: Record<string, unknown>) {
  return stringValue(metadata.operation) || stringValue(input.operation) || "info"
}

export function projectToolOperationLabel(operation: string) {
  return operationLabels[operation] ?? operation.replace(/_/g, " ")
}

export function projectToolTitle(input: Record<string, unknown>, metadata: Record<string, unknown>) {
  const operation = projectToolOperation(input, metadata)
  if (operation === "config_set" || operation === "config_remove") return "Project command"
  return `Project ${projectToolOperationLabel(operation)}`
}

export function projectToolCommand(input: Record<string, unknown>, metadata: Record<string, unknown>) {
  return stringValue(metadata.command) || stringValue(input.command)
}

export function projectToolSubtitle(input: Record<string, unknown>, metadata: Record<string, unknown>) {
  const count = numericValue(metadata.count)
  const blocked = numericValue(metadata.blocked)
  const countLabel =
    count === undefined
      ? ""
      : `${count} command${count === 1 ? "" : "s"}${blocked && blocked > 0 ? `, ${blocked} blocked` : ""}`
  return unique([
    stringValue(metadata.name),
    stringValue(input.name),
    stringValue(input.label),
    stringValue(input.kind),
    countLabel,
    stringValue(metadata.cwd) || stringValue(input.cwd),
    projectToolCommand(input, metadata),
  ]).join(" · ")
}
