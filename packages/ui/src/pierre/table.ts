export type ParsedTable = {
  headers: string[]
  rows: string[][]
  truncated: boolean
}

const MAX_CELLS = 50_000

export function parseDelimited(input: string, delimiter: string): ParsedTable {
  if (!input) return { headers: [], rows: [], truncated: false }

  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let cells = 0
  let truncated = false

  const pushCell = () => {
    row.push(cell)
    cell = ""
    cells++
  }
  const pushRow = () => {
    pushCell()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < input.length; i++) {
    if (truncated) break
    const ch = input[i]

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i++
          continue
        }
        quoted = false
        continue
      }
      cell += ch
      continue
    }

    if (ch === '"' && cell.length === 0) {
      quoted = true
      continue
    }
    if (ch === delimiter) {
      pushCell()
      continue
    }
    if (ch === "\r") {
      if (input[i + 1] === "\n") i++
      pushRow()
      continue
    }
    if (ch === "\n") {
      pushRow()
      continue
    }

    cell += ch
    if (cells > MAX_CELLS) {
      truncated = true
      break
    }
  }

  if (!truncated && (cell.length > 0 || row.length > 0)) pushRow()

  if (rows.length === 0) return { headers: [], rows: [], truncated }

  const [headers, ...body] = rows
  return {
    headers: headers ?? [],
    rows: body,
    truncated,
  }
}

export function detectDelimiter(path: string | undefined, sample: string): string {
  if (path?.toLowerCase().endsWith(".tsv")) return "\t"
  if (path?.toLowerCase().endsWith(".csv")) return ","
  const head = sample.slice(0, 2_000)
  const tabs = (head.match(/\t/g) ?? []).length
  const commas = (head.match(/,/g) ?? []).length
  const semis = (head.match(/;/g) ?? []).length
  if (tabs > commas && tabs > semis) return "\t"
  if (semis > commas) return ";"
  return ","
}
