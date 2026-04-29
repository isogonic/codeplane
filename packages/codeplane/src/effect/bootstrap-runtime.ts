import { Layer, ManagedRuntime } from "effect"

import { Plugin } from "@/plugin"
import { Bus } from "@/bus"
import { Config } from "@/config"
import * as Observability from "./observability"
import { memoMap } from "./memo-map"

export const BootstrapLayer = Layer.mergeAll(
  Config.defaultLayer,
  Plugin.defaultLayer,
  Bus.defaultLayer,
).pipe(Layer.provide(Observability.layer))

export const BootstrapRuntime = ManagedRuntime.make(BootstrapLayer, { memoMap })
