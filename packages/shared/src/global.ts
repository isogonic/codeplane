import { Context, Effect, Layer } from "effect"
import { CodeplaneHome } from "./home"

export namespace Global {
  export class Service extends Context.Service<Service, Interface>()("@codeplane/Global") {}

  export interface Interface {
    readonly root: string
    readonly home: string
    readonly data: string
    readonly cache: string
    readonly config: string
    readonly state: string
    readonly bin: string
    readonly log: string
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      return Service.of({
        ...CodeplaneHome.paths(),
      })
    }),
  )
}
