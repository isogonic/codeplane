import { mount, type TuiHarness } from "../harness/harness"
import { trimFrame, frameToHtml } from "../harness/snapshot"
import type { JSX } from "@opentui/solid"

/**
 * JSON-RPC 2.0 agent driver. Speaks line-delimited JSON over a Reader/Writer.
 *
 * Methods:
 *   mount   { fixture: string, width?, height? } -> { sessionId, cols, rows }
 *   press   { chord }                            -> { ok }
 *   type    { text }                             -> { ok }
 *   paste   { text }                             -> { ok }
 *   resize  { width, height }                    -> { ok, cols, rows }
 *   frame   {}                                   -> { text, html, cols, rows, cursor }
 *   find    { needle }                           -> FindResult | null
 *   findAll { needle }                           -> FindResult[]
 *   waitFor { text, timeoutMs? }                 -> { ok }
 *   unmount {}                                   -> { ok }
 *   list                                         -> { fixtures: string[] }
 *
 * On any thrown error, the response is { error: { code, message } } per JSON-RPC.
 */

export interface AgentServerOptions {
  /** Map of fixture name -> Solid component factory. */
  fixtures: Record<string, () => JSX.Element>
}

export interface JsonRpcRequest {
  jsonrpc?: "2.0"
  id?: string | number | null
  method: string
  params?: any
}
export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: string | number | null
  result?: any
  error?: { code: number; message: string; data?: any }
}

export class AgentServer {
  private harness: TuiHarness | null = null
  private fixtures: Record<string, () => JSX.Element>

  constructor(opts: AgentServerOptions) {
    this.fixtures = opts.fixtures
  }

  async dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id ?? null
    try {
      const result = await this.handle(req.method, req.params ?? {})
      return { jsonrpc: "2.0", id, result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { jsonrpc: "2.0", id, error: { code: -32000, message } }
    }
  }

  private async handle(method: string, params: any): Promise<any> {
    switch (method) {
      case "list":
        return { fixtures: Object.keys(this.fixtures) }
      case "mount": {
        const name = String(params.fixture)
        const factory = this.fixtures[name]
        if (!factory) throw new Error(`unknown fixture: ${name}`)
        if (this.harness) await this.harness.unmount()
        this.harness = await mount(factory, {
          width: typeof params.width === "number" ? params.width : 100,
          height: typeof params.height === "number" ? params.height : 30,
        })
        const f = this.harness.frame()
        return { ok: true, cols: f.cols, rows: f.rows }
      }
      case "press":
        await this.must().press(String(params.chord))
        return { ok: true }
      case "type":
        await this.must().type(String(params.text))
        return { ok: true }
      case "paste":
        await this.must().paste(String(params.text))
        return { ok: true }
      case "resize": {
        await this.must().resize(Number(params.width), Number(params.height))
        const f = this.must().frame()
        return { ok: true, cols: f.cols, rows: f.rows }
      }
      case "frame": {
        const f = this.must().frame()
        return {
          text: trimFrame(f),
          html: frameToHtml(f),
          cols: f.cols,
          rows: f.rows,
          cursor: f.cursor,
        }
      }
      case "find": {
        const needle = parseNeedle(params.needle)
        return this.must().find(needle)
      }
      case "findAll": {
        const needle = parseNeedle(params.needle)
        return this.must().findAll(needle)
      }
      case "waitFor": {
        const needle = parseNeedle(params.text)
        await this.must().waitForText(needle, Number(params.timeoutMs ?? 2000))
        return { ok: true }
      }
      case "unmount":
        if (this.harness) await this.harness.unmount()
        this.harness = null
        return { ok: true }
      default:
        throw new Error(`unknown method: ${method}`)
    }
  }

  private must(): TuiHarness {
    if (!this.harness) throw new Error("no harness mounted; call mount first")
    return this.harness
  }
}

function parseNeedle(input: any): string | RegExp {
  if (typeof input === "string") return input
  if (input && typeof input === "object" && typeof input.regex === "string") {
    return new RegExp(input.regex, typeof input.flags === "string" ? input.flags : "")
  }
  throw new Error("needle must be string or { regex, flags }")
}

/**
 * Run the JSON-RPC server over stdin/stdout. One request per line, one response per line.
 * Returns when stdin closes.
 */
export async function serveStdio(server: AgentServer): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of process.stdin as unknown as AsyncIterable<Buffer | string>) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk)
    let nl: number
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let req: JsonRpcRequest
      try {
        req = JSON.parse(line)
      } catch {
        const resp: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        }
        process.stdout.write(JSON.stringify(resp) + "\n")
        continue
      }
      const resp = await server.dispatch(req)
      process.stdout.write(JSON.stringify(resp) + "\n")
    }
  }
}
