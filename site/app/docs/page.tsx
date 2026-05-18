import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  BrainIcon,
  CodeIcon,
  Download01Icon,
  EyeIcon,
  GlobeIcon,
  KeyboardIcon,
  McpServerIcon,
  Notification01Icon,
  Settings02Icon,
  SmartPhone01Icon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

export const metadata = { title: "Docs" }

export default function DocsIndex() {
  return (
    <>
      <SiteHeader active="docs" />
      <section className="py-20">
        <div className="container max-w-prose">
          <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">Documentation</div>
          <h1 className="text-[clamp(40px,5vw,56px)] leading-[1.05] tracking-tightest font-semibold mb-6">
            Everything Codeplane.
          </h1>
          <p className="text-[19px] leading-relaxed text-ink-muted">
            From your first install to writing your own plugin. Every CLI flag, every
            config knob, every surface (terminal, desktop, web, mobile) — fully
            documented and kept in sync with the code.
          </p>
        </div>
      </section>

      <Section title="Get started">
        <Card href="/docs/install/" icon={Download01Icon} title="Install" body="Get the binary or the desktop app on macOS, Linux, Windows, iOS, Android." />
        <Card href="/docs/quickstart/" icon={SparklesIcon} title="Quick start" body="From `codeplane web` to your first agent reply, in under a minute." />
        <Card href="/docs/configuration/" icon={Settings02Icon} title="Configuration" body="The codeplane.json reference — every key, every default." />
      </Section>

      <Section title="Surfaces" cols={4}>
        <Card href="/docs/tui/" icon={TerminalIcon} title="TUI" body="Full-screen terminal interface." />
        <Card href="/docs/desktop/" icon={EyeIcon} title="Desktop" body="Native macOS / Windows / Linux." />
        <Card href="/docs/web/" icon={GlobeIcon} title="Web" body="Same UI in your browser." />
        <Card href="/docs/mobile/" icon={SmartPhone01Icon} title="Mobile" body="iOS + Android shells." />
      </Section>

      <Section title="Reference">
        <Card href="/docs/cli/" icon={TerminalIcon} title="CLI" body="codeplane serve, web, tui, instance, upgrade, completion." />
        <Card href="/docs/configuration/" icon={Settings02Icon} title="Config schema" body="Every key in codeplane.json — provider, model, MCP, permission rules, agents." />
        <Card href="/docs/instances/" icon={CodeIcon} title="Instances" body="Manage multiple Codeplane servers from one client." />
        <Card href="/docs/sessions/" icon={BrainIcon} title="Sessions" body="Threads, branches, archives, sharing, queued follow-ups, revert." />
        <Card href="/docs/permissions/" icon={EyeIcon} title="Permissions" body="Per-directory + per-session approval rules. Global auto-accept toggle." />
        <Card href="/docs/keybinds/" icon={KeyboardIcon} title="Keybinds" body="Every shortcut across web, desktop, TUI. Custom bindings." />
      </Section>

      <Section title="Extend">
        <Card href="/docs/mcp/" icon={McpServerIcon} title="MCP servers" body="Wire any Model Context Protocol server into your sessions." />
        <Card href="/docs/plugins/" icon={Notification01Icon} title="Plugins" body="Custom tools, agents, prompts via @codeplane-ai/plugin." />
        <Card href="/docs/sdk/" icon={CodeIcon} title="TypeScript SDK" body="Drive Codeplane from your own code — sessions, messages, streaming." />
        <Card href="/docs/self-hosting/" icon={GlobeIcon} title="Self-hosting" body="Run a server on your VPS / homelab. systemd, Docker, reverse proxies, auth." />
        <Card href="/docs/themes/" icon={EyeIcon} title="Themes" body="Light, dark, system — and how the monochrome palette is wired." />
        <Card href="/docs/api/" icon={TerminalIcon} title="HTTP API" body="Every endpoint the front-ends talk to — drive Codeplane from anywhere." />
      </Section>

      <section className="py-16">
        <div className="container max-w-prose">
          <h2 className="text-[28px] leading-tight tracking-tighter font-semibold mb-2">Need help?</h2>
          <p className="text-ink-muted mb-8">A few useful links.</p>
          <ul className="grid gap-3 text-ink-muted">
            <li>· <a className="border-b border-line hover:border-ink" href="https://github.com/devinoldenburg/codeplane/issues/new">File an issue</a> on GitHub</li>
            <li>· <a className="border-b border-line hover:border-ink" href="https://github.com/devinoldenburg/codeplane/discussions">Discussions board</a> for questions + feature ideas</li>
            <li>· <a className="border-b border-line hover:border-ink" href="https://github.com/devinoldenburg/codeplane/releases">Release notes</a> for every version since v28.0.0</li>
            <li>· <Link className="border-b border-line hover:border-ink" href="/docs/changelog/">Changelog</Link> — what changed, when</li>
          </ul>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}

function Section({ title, children, cols = 3 }: { title: string; children: React.ReactNode; cols?: 3 | 4 }) {
  const grid =
    cols === 4
      ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
      : "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
  return (
    <section className="py-12">
      <div className="container">
        <h2 className="mb-8 text-[28px] leading-tight tracking-tighter font-semibold">{title}</h2>
        <div className={grid}>{children}</div>
      </div>
    </section>
  )
}

function Card({
  href,
  icon,
  title,
  body,
}: {
  href: string
  icon: typeof TerminalIcon
  title: string
  body: string
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 transition-colors hover:border-ink"
    >
      <HugeiconsIcon icon={icon} size={26} strokeWidth={1.5} className="mb-2 text-ink" />
      <h3 className="text-[17px] font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
      <span className="mt-auto inline-flex items-center gap-2 text-[13px] font-medium text-ink-muted">
        Read <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.5} />
      </span>
    </Link>
  )
}
