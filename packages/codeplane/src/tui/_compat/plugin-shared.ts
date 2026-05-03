// TUI-local barrel for @/plugin/shared. Re-exports the core module and adds
// `readPackageThemes`, which is referenced by plugin/runtime.ts but not
// present in our codeplane plugin/shared. Also re-types `readV1Plugin` and
// `PluginKind` to include the "tui" kind that our core doesn't yet model.
export * from "@/plugin/shared"

import type { PluginPackage } from "@/plugin/shared"
import { readV1Plugin as coreReadV1Plugin, type PluginKind as CorePluginKind } from "@/plugin/shared"

// PluginMode isn't exported from core; mirror its literal union here.
type PluginMode = "strict" | "detect"

// Broaden kind to include the TUI target. The core function ignores any
// non-"server" kind beyond inserting the keyword in its error message, so
// this is a TS-only relaxation.
export type PluginKind = CorePluginKind | "tui"

export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,
  mode: PluginMode = "strict",
) {
  return coreReadV1Plugin(mod, spec, kind as CorePluginKind, mode)
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)
}

function resolvePackageFile(spec: string, raw: string, _field: string, pkg: PluginPackage): string {
  // Best-effort relative join — full plugin-resolution lives in core; this is
  // enough to keep the TUI loader happy for the theme-listing pass.
  const root = (pkg as unknown as { root?: string }).root ?? ""
  if (!root) return raw
  return `${root.replace(/\/+$/, "")}/${raw.replace(/^\.\/+/, "")}`
}

export function readPackageThemes(spec: string, pkg: PluginPackage): string[] {
  const json = (pkg as unknown as { json?: Record<string, unknown> }).json ?? {}
  const field = json["oc-themes"]
  if (field === undefined) return []
  if (!Array.isArray(field)) {
    throw new TypeError(`Plugin ${spec} has invalid oc-themes field`)
  }

  const list = field.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`Plugin ${spec} has invalid oc-themes entry`)
    }
    const raw = item.trim()
    if (!raw) {
      throw new TypeError(`Plugin ${spec} has empty oc-themes entry`)
    }
    if (raw.startsWith("file://") || isAbsolutePath(raw)) {
      throw new TypeError(`Plugin ${spec} oc-themes entry must be relative: ${item}`)
    }
    return resolvePackageFile(spec, raw, "oc-themes", pkg)
  })

  return Array.from(new Set(list))
}
