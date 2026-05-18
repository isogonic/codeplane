import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

export const metadata = {
  title: "Changelog",
  description: "Notable changes per Codeplane release. Every entry maps to a tag at github.com/devinoldenburg/codeplane/releases.",
  alternates: { canonical: "/docs/changelog/" },
  openGraph: {
    title: "Changelog · Codeplane",
    description: "Notable changes per Codeplane release. Every entry maps to a tag at github.com/devinoldenburg/codeplane/releases.",
    url: "/docs/changelog/",
    type: "article",
  },
  twitter: {
    title: "Changelog · Codeplane",
    description: "Notable changes per Codeplane release. Every entry maps to a tag at github.com/devinoldenburg/codeplane/releases.",
    card: "summary_large_image",
  },
}

export default function Changelog() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/changelog/">
        <h1>Changelog</h1>
        <p className="lede">Notable changes per release. Every entry maps to a tag at <a href="https://github.com/devinoldenburg/codeplane/releases">github.com/devinoldenburg/codeplane/releases</a> where the source binaries + full git log live.</p>

        <h2>28.2.x</h2>

        <h3>v28.2.4 (current)</h3>
        <ul>
          <li>Docs site rebuilt in Next.js (App Router, static export), deployed via a GitHub Actions workflow.</li>
          <li>Build runs on every <code>site/**</code> change; <code>/install</code> bash one-liner is preserved.</li>
        </ul>

        <h3>v28.2.3</h3>
        <ul>
          <li>Docs site phase 2: plugins, sdk, instances, sessions, permissions, keybinds, themes, api, changelog pages.</li>
        </ul>

        <h3>v28.2.2</h3>
        <ul>
          <li>Release infrastructure: full GitLab CI port of the three GitHub release workflows.</li>
          <li>Site: <code>codeplane.cc</code> ported to a monochrome OpenAI-style docs site.</li>
        </ul>

        <h3>v28.1.24</h3>
        <ul>
          <li><strong>Fix:</strong> Settings → General <em>Auto-accept permissions</em> toggle now actually toggles. Added a real global auto-accept flag.</li>
        </ul>

        <h3>v28.1.22</h3>
        <ul>
          <li><strong>Fix:</strong> Queued follow-up drag was locked to horizontal — flipped the axis constraint so up/down reorder actually moves the row.</li>
        </ul>

        <h3>v28.1.21</h3>
        <ul>
          <li>Toast restyle: first action reads as a filled white CTA, secondary actions stay as quiet ghost text.</li>
        </ul>

        <h3>v28.1.12</h3>
        <ul>
          <li><strong>UI refactor:</strong> Logic <code>radix-nova</code> design language ported across the shared SolidJS UI.</li>
          <li>Real <code>@hugeicons/core-free-icons</code> glyphs replace the hand-rolled SVG path map.</li>
          <li>Strict light/dark switcher — 35-theme picker removed.</li>
          <li>Stronger contrast tokens; rounded composer with symmetric tray padding.</li>
          <li>Project avatars get a deterministic FNV-1a hash colour.</li>
          <li>New <code>.gitlab-ci.yml</code> + <code>GITLAB_CI.md</code> for the Linux release pipeline.</li>
        </ul>

        <h2>28.0.x</h2>
        <p>Highlights of the pre-design-language history:</p>
        <ul>
          <li>iOS Live Activities for long-running sessions.</li>
          <li>Multi-instance address book + remote server picker.</li>
          <li>Queued follow-ups with live reorder.</li>
          <li>Session revert / branch / share.</li>
          <li>Plugin SDK general availability.</li>
        </ul>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}
