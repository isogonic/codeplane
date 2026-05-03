// TUI-local namespace barrel for @/tool/tool
import * as ToolImpl from "@/tool/tool"

export const Tool = ToolImpl

export namespace Tool {
  export type Context<M = unknown> = ToolImpl.Context<any>
  export type ExecuteResult<M = unknown> = ToolImpl.ExecuteResult<any>
  export type Def = ToolImpl.Def
  export type DefWithoutID = ToolImpl.DefWithoutID
  export type DynamicDescription = ToolImpl.DynamicDescription

  // The TUI uses these to derive parameter/metadata shapes from a tool
  // descriptor. Loose `any` so call sites that probe `.Parameters` / `.Metadata`
  // statically compile.
  export type InferParameters<T> = T extends { Parameters: infer P } ? P : any
  export type InferMetadata<T> = T extends { Metadata: infer M } ? M : any
}
