import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  BrainIcon,
  BubbleChatIcon,
  CodeIcon,
  Download01Icon,
  EyeIcon,
  GlobeIcon,
  McpServerIcon,
  SmartPhone01Icon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* Hero ---------------------------------------------------------- */}
      <section className="py-24 sm:py-32">
        <div className="container">
          <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">
            Open-source · MIT
          </div>
          <h1 className="text-[clamp(40px,7vw,72px)] leading-[1.02] tracking-tightest font-semibold text-ink">
            A coding agent that lives<br />
            everywhere you code.
          </h1>
          <p className="mt-6 max-w-[38em] text-[clamp(18px,1.8vw,22px)] leading-[1.45] text-ink-muted">
            Codeplane is one server, four front-ends — terminal, desktop, web, mobile.
            Plug in your model, point it at your repo, and pick up the same session
            from any device. Self-hosted, open, fast.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/docs/install/"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-4 text-base font-medium text-surface hover:opacity-85 transition-opacity"
            >
              <HugeiconsIcon icon={Download01Icon} size={18} strokeWidth={1.5} />
              Install Codeplane
            </Link>
            <Link
              href="/docs/"
              className="inline-flex items-center gap-2 rounded-full border border-ink px-6 py-4 text-base font-medium text-ink hover:bg-ink hover:text-surface transition-colors"
            >
              Read the docs
            </Link>
          </div>

          {/* Terminal mock — informational, not interactive. */}
          <div className="mt-16 overflow-x-auto rounded-lg bg-[var(--code-bg)] p-6 font-mono text-[13px] leading-[1.7] text-[var(--code-fg)] shadow-2xl shadow-black/15">
            <div className="mb-4 flex gap-[6px] opacity-50">
              <span className="block h-3 w-3 rounded-full bg-[var(--code-muted)]" />
              <span className="block h-3 w-3 rounded-full bg-[var(--code-muted)]" />
              <span className="block h-3 w-3 rounded-full bg-[var(--code-muted)]" />
            </div>
            <div><span className="text-[var(--code-muted)]">$</span> curl -fsSL https://codeplane.cc/install | bash</div>
            <div className="text-[var(--code-muted)]"># Detecting platform: darwin-arm64</div>
            <div className="text-[var(--code-muted)]"># Downloading codeplane v28.2.4 (94 MB)</div>
            <div className="text-[var(--code-muted)]"># Installing to ~/.codeplane/bin</div>
            <div className="text-[var(--code-muted)]"># Symlinking → /usr/local/bin/codeplane</div>
            <div>&nbsp;</div>
            <div><span className="text-[var(--code-muted)]">$</span> codeplane web</div>
            <div className="text-[var(--code-muted)]"># Started server on http://localhost:4096</div>
            <div className="text-[var(--code-muted)]"># Open browser at http://localhost:4096</div>
          </div>
        </div>
      </section>

      {/* Surfaces ------------------------------------------------------ */}
      <section className="py-24">
        <div className="container">
          <div className="mb-12 max-w-[720px]">
            <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">
              One agent. Four surfaces.
            </div>
            <h2 className="text-[clamp(28px,3.5vw,42px)] leading-tight tracking-tighter font-semibold">
              Use it from anywhere.
            </h2>
            <p className="mt-3 text-[19px] leading-relaxed text-ink-muted">
              Codeplane runs as a server. Every front-end is a thin client that connects to
              it — pick the one that fits the moment.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <SurfaceCard href="/docs/tui/" icon={TerminalIcon} title="Terminal">
              Full-screen TUI in any shell. Zero-friction for SSH + ops work.
            </SurfaceCard>
            <SurfaceCard href="/docs/desktop/" icon={EyeIcon} title="Desktop">
              Native macOS, Windows, Linux app. Auto-updates via electron-updater.
            </SurfaceCard>
            <SurfaceCard href="/docs/web/" icon={GlobeIcon} title="Web">
              Open any browser at the server URL. Nothing to install.
            </SurfaceCard>
            <SurfaceCard href="/docs/mobile/" icon={SmartPhone01Icon} title="Mobile">
              iOS + Android shell that wraps the web UI. Live activities supported.
            </SurfaceCard>
          </div>
        </div>
      </section>

      {/* Features ------------------------------------------------------ */}
      <section className="py-24">
        <div className="container">
          <div className="mb-12 max-w-[720px]">
            <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">
              Why Codeplane
            </div>
            <h2 className="text-[clamp(28px,3.5vw,42px)] leading-tight tracking-tighter font-semibold">
              Built for the way you actually work.
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Feature icon={SparklesIcon} title="Any model">
              OpenAI, Anthropic, OpenRouter, Ollama, vLLM, custom OpenAI-compatible
              endpoints — switch providers per session.
            </Feature>
            <Feature icon={BrainIcon} title="Real reasoning">
              Streamed thinking summaries, queued follow-ups you can reorder by drag,
              per-session memory and rules.
            </Feature>
            <Feature icon={CodeIcon} title="Tool-rich">
              File edits, shell, search, git, ghostty-driven terminals, browser previews
              — all native, no MCP needed.
            </Feature>
            <Feature icon={McpServerIcon} title="MCP-ready">
              Plug in any Model Context Protocol server. Bundled with Filesystem, GitHub,
              Sequential Thinking out of the box.
            </Feature>
            <Feature icon={EyeIcon} title="Yours alone">
              Run locally or self-host. Codeplane never reports telemetry; your sessions
              never leave your hardware.
            </Feature>
            <Feature icon={BubbleChatIcon} title="Open source">
              MIT-licensed. Read the code, file an issue, ship a PR — every line is at{" "}
              <a className="border-b border-line hover:border-ink" href="https://github.com/devinoldenburg/codeplane">
                github.com/devinoldenburg/codeplane
              </a>
              .
            </Feature>
          </div>
        </div>
      </section>

      {/* Quick install ------------------------------------------------- */}
      <section className="py-24">
        <div className="container">
          <div className="mb-12 max-w-[720px]">
            <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-4">
              Sixty seconds to running
            </div>
            <h2 className="text-[clamp(28px,3.5vw,42px)] leading-tight tracking-tighter font-semibold">
              Install once. Use everywhere.
            </h2>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h4 className="mb-3 font-semibold">macOS &amp; Linux</h4>
              <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`curl -fsSL https://codeplane.cc/install | bash`}
              </pre>
              <p className="mt-3 text-sm text-ink-muted">
                Detects your platform automatically, installs into{" "}
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[0.9em]">~/.codeplane/bin</code>,
                symlinks the <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[0.9em]">codeplane</code> binary into your PATH.
              </p>
            </div>
            <div>
              <h4 className="mb-3 font-semibold">npm / Bun</h4>
              <pre className="rounded-md bg-[var(--code-bg)] p-5 font-mono text-[13.5px] leading-relaxed text-[var(--code-fg)] overflow-x-auto">
{`npm install -g codeplane
# or
bun install -g codeplane`}
              </pre>
              <p className="mt-3 text-sm text-ink-muted">
                Same binary, packaged for the Node ecosystem.
              </p>
            </div>
          </div>

          <p className="mt-8">
            <Link
              href="/docs/install/"
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-surface hover:opacity-85 transition-opacity"
            >
              All install options
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />
            </Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}

function SurfaceCard({
  href,
  icon,
  title,
  children,
}: {
  href: string
  icon: typeof TerminalIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-7 transition-colors hover:border-ink"
    >
      <HugeiconsIcon icon={icon} size={28} strokeWidth={1.5} className="mb-2 text-ink" />
      <h3 className="text-[17px] font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">{children}</p>
      <span className="mt-auto inline-flex items-center gap-2 text-[13px] font-medium text-ink-muted">
        Read more
        <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.5} />
      </span>
    </Link>
  )
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: typeof TerminalIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-line py-7">
      <HugeiconsIcon icon={icon} size={32} strokeWidth={1.5} className="mb-5 text-ink" />
      <h3 className="mb-3 text-[19px] font-semibold tracking-tight">{title}</h3>
      <p className="text-[15px] leading-relaxed text-ink-muted">{children}</p>
    </div>
  )
}
