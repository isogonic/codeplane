// TUI-local compat for @/plugin/loader. Broadens `PluginKind` to include
// "tui" (our core only models "server") and re-types `loadExternal` so
// the TUI's runtime can pass `kind: "tui"` and a `finish` callback that
// returns the richer per-load record.
import { PluginLoader as CorePluginLoader } from "@/plugin/loader"
import type { ConfigPlugin } from "@/config/plugin"

export type PluginKind = "server" | "tui"

export type Loaded = CorePluginLoader.Loaded
export type Missing = CorePluginLoader.Missing

// Mirror of the (private) Candidate + Report types in @/plugin/loader so we
// can give the runtime's `report.start/missing/error` callbacks real types.
export type Candidate = { origin: ConfigPlugin.Origin; plan: { spec: string } }
export type Report = {
  start?: (candidate: Candidate, retry: boolean) => void
  missing?: (candidate: Candidate, retry: boolean, message: string, resolved: Missing) => void
  error?: (
    candidate: Candidate,
    retry: boolean,
    stage: "install" | "entry" | "compatibility" | "load",
    error: unknown,
    // 5th param present in newer upstream — exposes the partially-resolved
    // load candidate so callers can pull the final entry path out of the
    // failure for richer diagnostics. Optional here to stay back-compatible.
    resolved?: { entry?: string } & Partial<Loaded>,
  ) => void
}

export type LoadExternalInput<R> = {
  items: ConfigPlugin.Origin[]
  kind: PluginKind
  wait?: () => Promise<void>
  finish?: (load: Loaded, origin: ConfigPlugin.Origin, retry: boolean) => Promise<R | undefined>
  missing?: (value: Missing, origin: ConfigPlugin.Origin, retry: boolean) => Promise<R | undefined>
  report?: Report
}

export const PluginLoader = {
  ...CorePluginLoader,
  loadExternal<R = Loaded>(input: LoadExternalInput<R>): Promise<R[]> {
    // Forward as-is; the kind broadening is purely a TS-side relaxation,
    // the loader itself doesn't constrain kind values at runtime.
    return CorePluginLoader.loadExternal<R>(input as Parameters<typeof CorePluginLoader.loadExternal<R>>[0])
  },
} as const

export namespace PluginLoader {
  export type Loaded = CorePluginLoader.Loaded
  export type Missing = CorePluginLoader.Missing
}
