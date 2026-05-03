import { AgentServer, type JsonRpcRequest, type JsonRpcResponse } from "./server"

/**
 * Client-side wrapper. Useful both for tests (call AgentServer directly without stdio)
 * and for spawning a child process and piping JSON-RPC over its stdio.
 */
export class AgentClient {
  private nextId = 1
  constructor(private send: (req: JsonRpcRequest) => Promise<JsonRpcResponse>) {}

  static fromServer(server: AgentServer): AgentClient {
    return new AgentClient((req) => server.dispatch(req))
  }

  private async call(method: string, params?: any): Promise<any> {
    const id = this.nextId++
    const resp = await this.send({ jsonrpc: "2.0", id, method, params })
    if (resp.error) throw new Error(`${resp.error.code} ${resp.error.message}`)
    return resp.result
  }

  list(): Promise<{ fixtures: string[] }> {
    return this.call("list")
  }
  mount(fixture: string, opts: { width?: number; height?: number } = {}): Promise<{ cols: number; rows: number }> {
    return this.call("mount", { fixture, ...opts })
  }
  press(chord: string): Promise<{ ok: true }> {
    return this.call("press", { chord })
  }
  type(text: string): Promise<{ ok: true }> {
    return this.call("type", { text })
  }
  paste(text: string): Promise<{ ok: true }> {
    return this.call("paste", { text })
  }
  resize(width: number, height: number): Promise<{ ok: true; cols: number; rows: number }> {
    return this.call("resize", { width, height })
  }
  frame(): Promise<{ text: string; html: string; cols: number; rows: number; cursor: [number, number] }> {
    return this.call("frame")
  }
  find(needle: string | RegExp): Promise<{ row: number; col: number; text: string } | null> {
    return this.call("find", { needle: serializeNeedle(needle) })
  }
  findAll(needle: string | RegExp): Promise<{ row: number; col: number; text: string }[]> {
    return this.call("findAll", { needle: serializeNeedle(needle) })
  }
  waitFor(text: string | RegExp, timeoutMs?: number): Promise<{ ok: true }> {
    return this.call("waitFor", { text: serializeNeedle(text), timeoutMs })
  }
  unmount(): Promise<{ ok: true }> {
    return this.call("unmount")
  }
}

function serializeNeedle(n: string | RegExp): any {
  return typeof n === "string" ? n : { regex: n.source, flags: n.flags }
}
