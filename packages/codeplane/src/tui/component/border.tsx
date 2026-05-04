export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
}

// Lighter-weight variant used for assistant turn framing. The thicker
// `┃` from SplitBorder belongs to the user (high-emphasis prompt) so
// the eye knows where each prompt ended; assistant content uses the
// thin `│` to feel calmer and visually subordinate to the question
// it's answering, while still being framed as a single coherent
// turn instead of a wall of bare text.
export const ThinBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "│",
  },
}
