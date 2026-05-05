// Codeplane wordmark / brand chevron, rendered as block art for the CLI
// banner and the TUI splash. Mirrors the desktop SVG icon (a single right-
// pointing wing chevron with an inner notch — the "code" + "plane" mark).
//
// Each glyph occupies 5 rows so it lines up with the existing layout in
// cli/ui.ts and tui/component/logo.tsx. The animation in logo.tsx walks
// the connected component formed by lit cells (anything that isn't a
// space / "_" / "~" / ",") so we use full + half blocks (█ ▀ ▄) to keep
// the silhouette as one continuous shape with diagonal edges instead of
// the boxy stair-step the previous all-█ design produced.
export const logo = {
  left: ["█▄        ", "████▄     ", "███████▄  ", "████▀     ", "█▀        "],
  right: ["█▄        ", "████▄     ", "███████▄  ", "████▀     ", "█▀        "],
}

// Smaller variant used for the TUI go-mark (status / breadcrumb style).
export const go = {
  left: ["█▄      ", "███▄    ", "█████▄  ", "███▀    ", "█▀      "],
  right: ["", "", "", "", ""],
}

export const marks = "_^~,"
