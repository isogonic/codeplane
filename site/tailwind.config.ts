import type { Config } from "tailwindcss"

/*
 * opencode.ai-style palette + typography. The site is monospace-first;
 * every "font-sans" Tailwind utility aliases back to the same mono
 * stack so a page author can use either class without surprise.
 * Container caps at 1040px to match the centred column on opencode.ai.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1040px" },
    },
    extend: {
      colors: {
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-muted": "var(--ink-muted)",
        "ink-soft": "var(--ink-soft)",
        line: "var(--line)",
        "line-soft": "var(--line-soft)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        "code-bg": "var(--code-bg)",
        "code-fg": "var(--code-fg)",
        "code-muted": "var(--code-muted)",
        accent: "var(--accent)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      letterSpacing: {
        tightest: "-0.03em",
        tighter: "-0.02em",
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
        "2xl": "18px",
      },
      maxWidth: {
        prose: "720px",
        column: "1040px",
      },
    },
  },
  plugins: [],
}

export default config
