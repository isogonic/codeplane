import type { Config } from "tailwindcss"

/*
 * Monochrome OpenAI-style palette. Every brand colour lives in CSS
 * variables on :root + .dark so we get prefers-color-scheme + manual
 * override out of the box. Tailwind classes (e.g. `text-ink`) resolve
 * to `var(--ink)` so the same class works in both modes.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1120px" },
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
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SF Mono", "JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.035em",
        tighter: "-0.025em",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
      },
      maxWidth: {
        prose: "760px",
      },
    },
  },
  plugins: [],
}

export default config
