import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Themes",
  description: "Strict light and dark themes for Codeplane — and how the monochrome OKLCH palette is wired through the shared UI.",
  alternates: { canonical: "/docs/themes/" },
  openGraph: {
    title: "Themes · Codeplane",
    description: "Strict light and dark themes for Codeplane — and how the monochrome OKLCH palette is wired through the shared UI.",
    url: "/docs/themes/",
    type: "article",
  },
  twitter: {
    title: "Themes · Codeplane",
    description: "Strict light and dark themes for Codeplane — and how the monochrome OKLCH palette is wired through the shared UI.",
    card: "summary_large_image",
  },
}

export default function Themes() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/themes/">
        <h1>Themes</h1>
        <p className="lede">Codeplane ships one bundled UI theme, <code>oc-2</code>, plus three color-scheme modes: light, dark, and system. The old multi-theme picker remains as a compatibility API, but it always resolves to the single bundled theme.</p>

        <h2>Switching</h2>
        <p>Settings → Appearance → Color scheme.</p>
        <ul>
          <li><strong>System</strong> — follow the OS preference (<code>prefers-color-scheme</code>).</li>
          <li><strong>Light</strong> — off-white canvas (oklch 0.985), pure-white elevated surfaces, near-black ink.</li>
          <li><strong>Dark</strong> — deep canvas (oklch 0.115), clearly-lifted cards (oklch 0.185), near-white ink.</li>
        </ul>
        <p>Keyboard: <span className="kbd">Mod+Shift+S</span> cycles through the three.</p>

        <h2>Why no theme picker</h2>
        <p>Earlier Codeplane versions shipped 35 themes (Dracula, Tokyonight, Catppuccin, etc.). They were dropped in v28.2.0 — every additional palette is one more permutation to test, and they fought with the design language.</p>

        <h2>Implementation files</h2>
        <table>
          <thead><tr><th>File</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code>packages/ui/src/theme/context.tsx</code></td><td>Single-theme compatibility context, color-scheme state, localStorage cleanup.</td></tr>
            <tr><td><code>packages/ui/src/theme/themes/oc-2.json</code></td><td>Bundled theme definition.</td></tr>
            <tr><td><code>packages/ui/src/theme/resolve.ts</code></td><td>Resolve compact theme tokens to CSS variables.</td></tr>
            <tr><td><code>packages/ui/src/theme/loader.ts</code></td><td>Runtime theme CSS loader kept for compatibility.</td></tr>
            <tr><td><code>packages/app/src/pages/layout.tsx</code></td><td>Color-scheme commands and UI integration.</td></tr>
          </tbody>
        </table>

        <h2>Plugin theme metadata</h2>
        <p>
          Plugin metadata can still record theme definitions for compatibility with older plugin
          APIs, but the active app theme is the bundled <code>oc-2</code> theme. Treat custom theme
          injection as internal/experimental unless a future release exposes a stable picker again.
        </p>

        <h2>Syntax highlighting</h2>
        <p>Code blocks use highlight.js with a GitHub-style palette tuned for OKLCH contrast in both modes. The TUI uses its own ANSI palette tied to the surrounding theme.</p>

        <h2>Accessibility</h2>
        <p>Both modes ship 7:1 contrast on body text and 4.5:1 on muted text (WCAG AAA / AA respectively). Focus rings use <code>--ring</code> at 50% opacity with a 3px halo.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
