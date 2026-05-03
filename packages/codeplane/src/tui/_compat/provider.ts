// TUI-local namespace barrel for @/provider/provider
import * as ProviderImpl from "@/provider/provider"

export const Provider = {
  parseModel: ProviderImpl.parseModel,
  Model: ProviderImpl.Model,
  Info: ProviderImpl.Info,
  ListResult: ProviderImpl.ListResult,
} as const

export namespace Provider {
  export type Model = ProviderImpl.Model
  export type Info = ProviderImpl.Info
}
