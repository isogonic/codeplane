// TUI-local namespace barrel for @/util/rpc
import * as RpcImpl from "@/util/rpc"

export const Rpc = {
  listen: RpcImpl.listen,
  emit: RpcImpl.emit,
  client: RpcImpl.client,
} as const

export namespace Rpc {
  // Mirror of the (non-exported) `Definition` shape in @/util/rpc — enough
  // for callers that need to reference it as a type parameter constraint.
  export type Definition = Record<string, (...args: any[]) => unknown>
}
