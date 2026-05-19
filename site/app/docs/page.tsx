import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

/*
 * Docs hub — opencode.ai-style index page. The colourful HugeIcons
 * card grid from the previous iteration didn't fit the cream/charcoal
 * monospace site, so this page now hosts five `[*]` link lists framed
 * by section dividers and the column rails. Same routes as before.
 */
export const metadata = {
  title: "Docs",
  description: "Documentation for Codeplane — install, CLI reference, configuration, surfaces (terminal, desktop, web, mobile), MCP, plugins, SDK, self-hosting.",
  alternates: { canonical: "/docs/" },
  openGraph: {
    title: "Docs · Codeplane",
    description: "Documentation for Codeplane — install, CLI reference, configuration, surfaces (terminal, desktop, web, mobile), MCP, plugins, SDK, self-hosting.",
    url: "/docs/",
    type: "article",
  },
  twitter: {
    title: "Docs · Codeplane",
    description: "Documentation for Codeplane — install, CLI reference, configuration, surfaces (terminal, desktop, web, mobile), MCP, plugins, SDK, self-hosting.",
    card: "summary_large_image",
  },
}

type Entry = { href: string; title: string; body: string }

const GET_STARTED: Entry[] = [
  { href: "/docs/install/",       title: "Install",       body: "Get the binary or desktop app on macOS, Linux, Windows. iOS via TestFlight; Android coming soon." },
  { href: "/docs/quickstart/",    title: "Quick start",   body: "From `codeplane web` to your first agent reply, in under a minute." },
  { href: "/docs/configuration/", title: "Configuration", body: "The codeplane.jsonc reference: providers, agents, permissions, MCP, server, runtime tuning." },
  { href: "/docs/providers/",     title: "Providers",     body: "Models, auth methods, OAuth flows, API-key setup, custom OpenAI-compatible endpoints." },
]

const SURFACES: Entry[] = [
  { href: "/docs/tui/",     title: "TUI",     body: "Full-screen terminal interface in any shell." },
  { href: "/docs/desktop/", title: "Desktop", body: "Native macOS, Linux, and Windows app. Auto-updates via electron-updater." },
  { href: "/docs/web/",     title: "Web",     body: "Same UI in any browser. Nothing to install client-side." },
  { href: "/docs/mobile/",  title: "Mobile",  body: "Native iOS shell on TestFlight. Android in development." },
]

const REFERENCE: Entry[] = [
  { href: "/docs/cli/",         title: "CLI",         body: "codeplane serve, web, tui, instance, upgrade, completion." },
  { href: "/docs/configuration/", title: "Config schema", body: "Every key in codeplane.json — provider, model, MCP, permission rules, agents." },
  { href: "/docs/instances/",   title: "Instances",   body: "Every running Codeplane is an instance — manage many on one device, switch from any client." },
  { href: "/docs/sessions/",    title: "Sessions",    body: "Threads, branches, archives, sharing, queued follow-ups, revert." },
  { href: "/docs/permissions/", title: "Permissions", body: "Per-directory and per-session approval rules. Global auto-accept toggle." },
  { href: "/docs/keybinds/",    title: "Keybinds",    body: "Every shortcut across web, desktop, TUI. Custom bindings." },
  { href: "/docs/api/",         title: "HTTP API",    body: "Every endpoint the front-ends talk to — drive Codeplane from anywhere." },
  { href: "/docs/architecture/", title: "Architecture", body: "Codeplane → Instance → workspaces/sessions. How clients (TUI, web, desktop, mobile) attach and what an instance owns." },
]

const EXTEND: Entry[] = [
  { href: "/docs/mcp/",          title: "MCP servers",     body: "Wire any Model Context Protocol server into your sessions." },
  { href: "/docs/plugins/",      title: "Plugins",         body: "Custom tools, agents, prompts via @codeplane-ai/plugin." },
  { href: "/docs/sdk/",          title: "TypeScript SDK",  body: "Drive Codeplane from your own code — sessions, messages, streaming." },
  { href: "/docs/self-hosting/", title: "Self-hosting",    body: "Run a long-lived Codeplane instance on your VPS or homelab. systemd, Docker, reverse proxies, auth." },
  { href: "/docs/themes/",       title: "Themes",          body: "Strict light + dark, and how the monochrome OKLCH palette is wired." },
  { href: "/docs/troubleshooting/", title: "Troubleshooting", body: "Install, server, auth, provider, MCP, desktop, mobile, and release failure playbooks." },
  { href: "/docs/release/",      title: "Release process", body: "Version sync, validation, GitHub release tags, npm, desktop, mobile, and Pages deploys." },
]

export default function DocsIndex() {
  return (
    <>
      <SiteHeader active="docs" />
      <div className="rail">

        <section className="container border-b border-line py-16">
          <div className="text-[12px] font-bold uppercase tracking-wider text-ink-muted mb-3">
            Documentation
          </div>
          <h1 className="text-[clamp(34px,5vw,52px)] leading-[1.05] font-bold text-ink">
            Everything Codeplane.
          </h1>
          <p className="mt-6 max-w-[44em] text-[15px] leading-relaxed text-ink-2">
            From your first install to writing your own plugin. Every CLI flag, every config knob,
            every surface (terminal, desktop, web, mobile) — kept in sync with the code.
          </p>
        </section>

        <DocSection title="Get started" entries={GET_STARTED} />
        <DocSection title="Surfaces" entries={SURFACES} />
        <DocSection title="Reference" entries={REFERENCE} />
        <DocSection title="Extend" entries={EXTEND} />

        <section className="container border-b border-line py-16">
          <h2 className="text-[18px] font-bold text-ink mb-6">Need help?</h2>
          <ul className="bullet-list text-[14px]">
            <li>
              <div>
                <a className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="https://github.com/devinoldenburg/codeplane/issues/new">
                  File an issue
                </a>{" "}
                on GitHub.
              </div>
            </li>
            <li>
              <div>
                <a className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="https://github.com/devinoldenburg/codeplane/releases">
                  Release notes
                </a>{" "}
                for every version since v28.0.0.
              </div>
            </li>
            <li>
              <div>
                <Link className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="/docs/changelog/">
                  Changelog
                </Link>{" "}
                — what changed, when.
              </div>
            </li>
          </ul>
        </section>

      </div>
      <SiteFooter />
    </>
  )
}

function DocSection({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section className="container border-b border-line py-14">
      <h2 className="text-[18px] font-bold text-ink mb-6">{title}</h2>
      <ul className="bullet-list text-[14px]">
        {entries.map((e) => (
          <li key={e.href}>
            <div>
              <Link
                href={e.href}
                className="title underline underline-offset-4 decoration-line hover:decoration-ink"
              >
                {e.title}
              </Link>
              {e.body}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
