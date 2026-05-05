// Codeplane brand mark, rendered as block art for the CLI banner and the
// TUI splash. Right-pointing chevron / wing silhouette — top-bottom
// symmetric across the middle row (was: notched on the lower half, which
// broke the symmetry and read as a glitch rather than a logo).
export const logo = {
  left: ["██        ", "██████    ", "██████████", "██████    ", "██        "],
  right: ["", "", "", "", ""],
}

// Smaller variant used for the TUI go-mark / bg-pulse origin. Same
// symmetric chevron, sized down by one column.
export const go = {
  left: ["██      ", "█████   ", "████████", "█████   ", "██      "],
  right: ["", "", "", "", ""],
}

export const marks = "_^~,"
