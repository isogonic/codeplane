import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = { title: "Themes" }

export default function Themes() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/themes/">
        <h1>Themes</h1>
        <p className="lede">Codeplane ships a single, intentional palette — monochrome OKLCH, ported from Logic&apos;s shadcn <code>radix-nova</code>. Light, dark, and system are the three options.</p>

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

        <h2>Custom CSS</h2>
        <p>The web UI loads <code>$CODEPLANE_HOME/custom.css</code> after every other stylesheet.</p>
        <pre><code>{`:root {
  --primary:    oklch(0.55 0.2 264);   /* tint the CTAs blue */
  --ring:       oklch(0.55 0.2 264);
}

.dark {
  --primary:    oklch(0.75 0.18 264);  /* lighter blue on dark */
  --ring:       oklch(0.75 0.18 264);
}`}</code></pre>
        <p>Full token reference is at <code>packages/ui/src/styles/shadcn.css</code> in the repo.</p>

        <h2>Syntax highlighting</h2>
        <p>Code blocks use highlight.js with a GitHub-style palette tuned for OKLCH contrast in both modes. The TUI uses its own ANSI palette tied to the surrounding theme.</p>

        <h2>Accessibility</h2>
        <p>Both modes ship 7:1 contrast on body text and 4.5:1 on muted text (WCAG AAA / AA respectively). Focus rings use <code>--ring</code> at 50% opacity with a 3px halo.</p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
