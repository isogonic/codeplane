import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"

/*
 * Docs hub. Same sidebar chrome as every other docs route (via
 * DocsLayout, prose=false). The main column carries an annotated
 * overview — each group rendered as a two-column [*] link list.
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
  { href: "/docs/install/",       title: "Install",       body: "Get the binary or desktop app on macOS, Linux, and Windows. iOS via TestFlight; Android coming soon." },
  { href: "/docs/quickstart/",    title: "Quick start",   body: "From codeplane web to your first agent reply, in under a minute." },
  { href: "/docs/configuration/", title: "Configuration", body: "The codeplane.jsonc reference: providers, agents, permissions, MCP, server, and runtime tuning." },
  { href: "/docs/providers/",     title: "Providers",     body: "Models, auth methods, OAuth flows, API-key setup, and custom OpenAI-compatible endpoints." },
]

const SURFACES: Entry[] = [
  { href: "/docs/tui/",     title: "Terminal (TUI)", body: "The full-screen terminal interface, in any shell." },
  { href: "/docs/desktop/", title: "Desktop",        body: "Native macOS, Linux, and Windows app. Self-updating from GitHub Releases." },
  { href: "/docs/web/",     title: "Web",            body: "The same UI in any browser. Nothing to install client-side." },
  { href: "/docs/mobile/",  title: "Mobile",         body: "Native iOS shell on TestFlight. Android in development." },
]

const REFERENCE: Entry[] = [
  { href: "/docs/cli/",          title: "CLI commands",  body: "serve, web, tui, instance, upgrade, completion — every flag." },
  { href: "/docs/instances/",    title: "Instances",     body: "Every running Codeplane is an instance. Run many on one device, switch from any client." },
  { href: "/docs/sessions/",     title: "Sessions",      body: "Threads, branches, archives, sharing, queued follow-ups, and revert." },
  { href: "/docs/permissions/",  title: "Permissions",   body: "Per-directory and per-session approval rules. Global auto-accept toggle." },
  { href: "/docs/keybinds/",     title: "Keybinds",      body: "Every shortcut across web, desktop, and TUI — plus custom bindings." },
  { href: "/docs/api/",          title: "HTTP API",      body: "Every endpoint the front-ends talk to. Drive Codeplane from anywhere." },
  { href: "/docs/architecture/", title: "Architecture",  body: "Codeplane → Instance → workspaces & sessions. How clients attach and what an instance owns." },
]

const EXTEND: Entry[] = [
  { href: "/docs/mcp/",             title: "MCP servers",     body: "Wire any Model Context Protocol server into your sessions." },
  { href: "/docs/plugins/",         title: "Plugins",         body: "Custom tools, agents, and prompts via @codeplane-ai/plugin." },
  { href: "/docs/sdk/",             title: "TypeScript SDK",  body: "Drive Codeplane from your own code — sessions, messages, streaming." },
  { href: "/docs/self-hosting/",    title: "Self-hosting",    body: "Run a long-lived instance on a VPS or homelab: systemd, Docker, reverse proxies, auth." },
  { href: "/docs/themes/",          title: "Themes",          body: "Strict light + dark, and how the warm OKLCH palette is wired." },
  { href: "/docs/troubleshooting/", title: "Troubleshooting", body: "Install, server, auth, provider, MCP, desktop, mobile, and release playbooks." },
  { href: "/docs/release/",         title: "Release process", body: "Version sync, validation, release tags, npm, desktop, mobile, and Pages deploys." },
]

export default function DocsIndex() {
  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/" prose={false}>
        <div className="eyebrow mb-4">Documentation</div>
        <h1 className="text-[clamp(30px,4vw,42px)] font-semibold leading-[1.08] tracking-[-0.015em] text-ink">
          Everything Codeplane.
        </h1>
        <p className="lede measure-wide mt-5">
          From your first install to writing your own plugin. Every CLI flag, every config knob,
          every surface — terminal, desktop, web, mobile — kept in sync with the code that ships.
        </p>

        <div className="mt-14 flex flex-col gap-14">
          <DocGroup title="Get started" entries={GET_STARTED} />
          <DocGroup title="Surfaces" entries={SURFACES} />
          <DocGroup title="Reference" entries={REFERENCE} />
          <DocGroup title="Extend" entries={EXTEND} />

          <div>
            <h2 className="mb-6 text-[17px] font-bold text-ink">Need a hand?</h2>
            <ul className="bullet-list text-[14px]">
              <li>
                <div>
                  <a className="link" href="https://github.com/isogonic/codeplane/issues/new">File an issue</a>{" "}
                  on GitHub — bugs, ideas, or a TestFlight invite request.
                </div>
              </li>
              <li>
                <div>
                  <a className="link" href="https://github.com/isogonic/codeplane/releases">Release notes</a>{" "}
                  for every version since v28.0.0.
                </div>
              </li>
              <li>
                <div>
                  <Link className="link" href="/docs/changelog/">Changelog</Link> — what changed, and when.
                </div>
              </li>
            </ul>
          </div>
        </div>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}

function DocGroup({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <div>
      <h2 className="mb-6 text-[17px] font-bold text-ink">{title}</h2>
      <ul className="bullet-list cols-2 text-[14px]">
        {entries.map((e) => (
          <li key={e.href}>
            <div>
              <Link href={e.href} className="title link">{e.title}</Link>
              {e.body}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
