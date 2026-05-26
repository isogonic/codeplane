const SUMMARY_KEYS = ["description", "query", "url", "filePath", "path", "pattern", "name", "command"]

const ACRONYMS = new Map([
  ["api", "API"],
  ["cpu", "CPU"],
  ["css", "CSS"],
  ["dns", "DNS"],
  ["gpu", "GPU"],
  ["html", "HTML"],
  ["http", "HTTP"],
  ["https", "HTTPS"],
  ["id", "ID"],
  ["json", "JSON"],
  ["mcp", "MCP"],
  ["sql", "SQL"],
  ["ssh", "SSH"],
  ["ui", "UI"],
  ["url", "URL"],
  ["xml", "XML"],
  ["yaml", "YAML"],
  ["yml", "YAML"],
])

const BRAND_NAMES = new Map([
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["unifi", "UniFi"],
])

export type GenericToolDisplay = {
  title: string
  subtitle?: string
  isMcp: boolean
}

function sanitizeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function tokens(value: string | undefined) {
  return (value ?? "")
    .split(/[:/_-]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function humanWord(value: string) {
  const lower = value.toLowerCase()
  if (BRAND_NAMES.has(lower)) return BRAND_NAMES.get(lower)!
  if (ACRONYMS.has(lower)) return ACRONYMS.get(lower)!
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function humanizeToolIdentifier(value: string) {
  const parts = tokens(value)
  if (parts.length === 0) return value
  return parts.map(humanWord).join(" ")
}

function firstNonEmptyString(values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)
}

function summaryValue(input: Record<string, unknown> | undefined, omit: Set<string>): string | undefined {
  if (!input) return undefined
  const value = firstNonEmptyString(SUMMARY_KEYS.filter((key) => !omit.has(key)).map((key) => input[key]))
  if (!value) return undefined
  return value.trim()
}

function stripSharedPrefix(words: string[], prefix: string[]) {
  let index = 0
  while (index < words.length && index < prefix.length && words[index]?.toLowerCase() === prefix[index]?.toLowerCase()) {
    index += 1
  }
  return index > 0 ? words.slice(index) : words
}

function mcpServerKey(tool: string, inputTool: string | undefined) {
  if (inputTool && tool.endsWith(`_${sanitizeKey(inputTool)}`)) {
    return tool.slice(0, -1 * (sanitizeKey(inputTool).length + 1))
  }

  if (tool.endsWith("_execute")) {
    let server = tool.slice(0, -"_execute".length)
    const firstToken = tokens(inputTool)[0]
    if (firstToken) {
      const suffix = `_${sanitizeKey(firstToken)}`
      if (server.endsWith(suffix)) server = server.slice(0, -suffix.length)
    }
    return server
  }

  const split = tool.indexOf("_")
  if (split === -1) return tool
  return tool.slice(0, split)
}

function mcpOperationKey(tool: string, inputTool: string | undefined) {
  if (inputTool) return inputTool
  if (tool.endsWith("_execute")) return "execute"
  const split = tool.indexOf("_")
  if (split === -1) return tool
  return tool.slice(split + 1)
}

export function describeGenericToolDisplay(input: {
  tool: string
  args?: Record<string, unknown>
  metadata?: Record<string, unknown>
  resolveKnownName?: (tool: string) => string | undefined
}) {
  const isMcp = input.metadata?.mcp === true
  const inputTool = typeof input.args?.tool === "string" && input.args.tool.trim().length > 0 ? input.args.tool.trim() : undefined
  const omit = new Set<string>(["tool"])
  const summary = summaryValue(input.args, omit)

  if (!isMcp) {
    return {
      title: input.resolveKnownName?.(input.tool) ?? humanizeToolIdentifier(input.tool),
      subtitle: summary,
      isMcp: false,
    } satisfies GenericToolDisplay
  }

  const serverKey = mcpServerKey(input.tool, inputTool)
  const operationKey = mcpOperationKey(input.tool, inputTool)
  const serverWords = tokens(serverKey)
  let operationWords = tokens(operationKey)

  if (serverWords.length > 0) {
    operationWords = stripSharedPrefix(operationWords, serverWords)
  }
  if (operationWords.at(-1)?.toLowerCase() === "execute" && operationWords.length > 1) {
    operationWords = operationWords.slice(0, -1)
  }

  const normalizedOperation = operationWords.join("_")
  const title =
    (normalizedOperation && input.resolveKnownName?.(normalizedOperation)) ||
    humanizeToolIdentifier(operationWords.length > 0 ? normalizedOperation : operationKey)

  const subtitleParts = [serverWords.length > 0 ? humanizeToolIdentifier(serverKey) : undefined, summary].filter(Boolean)

  return {
    title,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined,
    isMcp: true,
  } satisfies GenericToolDisplay
}
