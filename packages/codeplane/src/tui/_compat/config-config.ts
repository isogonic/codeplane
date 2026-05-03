// TUI-local namespace barrel for @/config/config
import * as ConfigImpl from "@/config/config"

export const Config = {
  Info: ConfigImpl.Info,
  Server: ConfigImpl.Server,
  Layout: ConfigImpl.Layout,
  Service: ConfigImpl.Service,
} as const

export namespace Config {
  export type Info = ConfigImpl.Info
  export type Layout = ConfigImpl.Layout
  export type Service = ConfigImpl.Service
}
