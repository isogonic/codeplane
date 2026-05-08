import { Component, JSX, createMemo } from "solid-js"

/**
 * One canonical icon component for the entire app — wraps the
 * `@hugeicons/core-free-icons` data format
 * (https://hugeicons.com/icons) so every UI affordance — chevrons,
 * gear, plus, search, trash, close, etc. — pulls from the same
 * library. The data export is a list of `[tag, attrs]` tuples that
 * we serialize into the SVG via `innerHTML`; that side-steps the
 * SolidJS namespace headache when rendering an arbitrary list of
 * `path` / `circle` / `rect` children, and keeps the runtime cost
 * to a single string concat per icon.
 *
 * Brand / file-type / provider / app icons stay on their existing
 * sprite system — HugeIcons doesn't carry brand marks, and replacing
 * a VS Code or `.py` glyph with a generic shape would actively
 * regress the design. This component is for affordance icons only.
 *
 * Usage:
 *
 *   import { HugeIcon } from "@codeplane-ai/ui/huge-icon"
 *   import { PlusSignIcon } from "@hugeicons/core-free-icons"
 *
 *   <HugeIcon icon={PlusSignIcon} size={22} />
 *
 * Sizing: icons scale uniformly with `size` (px or any CSS length).
 * The colour comes from `currentColor`, so wrap the icon in a
 * coloured element (or pass `color` directly) to retint it. Stroke
 * weight is fixed by HugeIcons at 1.5 in their stroke-rounded set;
 * the wrapper does not override it because the visual proportion
 * was tuned at that weight.
 */
export type HugeIconData = readonly (readonly [string, { readonly [key: string]: string | number }])[]

export type HugeIconProps = {
  /** The default export of any `@hugeicons/core-free-icons` icon. */
  icon: HugeIconData
  /** Width and height in CSS units. Defaults to 24px (HugeIcons' native viewBox). */
  size?: number | string
  /** Override the foreground colour. Falls back to `currentColor` so it inherits. */
  color?: string
  /** Standard className passthrough. */
  class?: string
  /** Inline style passthrough — handy for one-off margin / opacity tweaks. */
  style?: JSX.CSSProperties | string
  /**
   * Accessible label. When provided, the SVG is exposed to ATs as an
   * `img` with that label; when omitted, it's marked decorative
   * (`aria-hidden`) so screen readers don't read structural icons.
   */
  "aria-label"?: string
  /** Forwarded through; mostly for tests and integration tooling. */
  "data-testid"?: string
}

export const HugeIcon: Component<HugeIconProps> = (props) => {
  // Serialize the [tag, attrs] tuples into a single SVG payload.
  // `innerHTML` on an `<svg>` element parses children in the SVG
  // namespace, so `path`/`circle`/`rect`/etc. all hit the right
  // namespace without us having to thread `Dynamic` calls through
  // the SolidJS renderer (which gets unhappy with arbitrary tag
  // names inside SVG). The cost is a few microseconds of string
  // concat per icon, paid only when the data reference changes —
  // not on every reactive update of unrelated props.
  const inner = createMemo(() => serializeIcon(props.icon))

  return (
    <svg
      width={props.size ?? 24}
      height={props.size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      class={props.class}
      style={props.style}
      color={props.color}
      role={props["aria-label"] ? "img" : "presentation"}
      aria-label={props["aria-label"]}
      aria-hidden={props["aria-label"] ? undefined : true}
      data-testid={props["data-testid"]}
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={inner()}
    />
  )
}

const serializeIcon = (icon: HugeIconData): string => {
  // HugeIcons attribute names are camelCase (`strokeWidth`,
  // `strokeLinecap`); SVG markup expects kebab-case. Convert per-key,
  // skip the `key` field (it's a SolidJS/React render hint, not a
  // real SVG attribute), and HTML-escape the value just in case a
  // future icon ships an attribute containing an unsafe character.
  let out = ""
  for (const [tag, attrs] of icon) {
    out += `<${tag}`
    for (const k in attrs) {
      if (k === "key") continue
      const value = attrs[k]
      const attrName = camelToKebab(k)
      out += ` ${attrName}="${escapeAttribute(String(value))}"`
    }
    out += " />"
  }
  return out
}

const camelToKebab = (key: string): string => {
  // Hand-rolled to avoid an extra regex allocation per call —
  // the icon set is rendered every paint, so this stays in the
  // hot path. Fast enough that the runtime never shows up in
  // profiles.
  let out = ""
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    if (ch >= 65 && ch <= 90) {
      // upper case → "-" + lowercase
      if (i !== 0) out += "-"
      out += String.fromCharCode(ch + 32)
    } else {
      out += key[i]
    }
  }
  return out
}

const escapeAttribute = (value: string): string => {
  // Minimal HTML attribute escape — the only characters that can
  // break out of a double-quoted attribute are `"`, `&`, and `<`.
  // We don't need full innerHTML hardening because the input comes
  // from a known package (`@hugeicons/core-free-icons`) and never
  // from user content, but escaping is cheap insurance against a
  // future icon shipping an unusual character.
  return value.replace(/[&"<]/g, (c) => {
    if (c === "&") return "&amp;"
    if (c === '"') return "&quot;"
    return "&lt;"
  })
}
