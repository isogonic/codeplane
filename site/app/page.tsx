import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Download01Icon } from "@hugeicons/core-free-icons"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { HeroInstall } from "@/components/hero-install"
import { Faq } from "@/components/faq"
import { StatsBoard } from "@/components/stats"

/*
 * Landing page. Layout intentionally mirrors opencode.ai end-to-end —
 * same column rails, same section order (announcement banner, hero,
 * install tabs, demo, "what is", stats, privacy, FAQ, fork notice,
 * footer). The wrapper <div class="rail"> draws the two vertical
 * column lines that frame every section.
 *
 * Codeplane is an experimental fork of opencode. That fact is called
 * out in the announcement banner, the "what is" section, the FAQ, and
 * the footer — anyone who arrives at codeplane.cc has to actively
 * ignore it to miss the disclosure.
 */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <div className="rail">

        {/* Announcement banner ----------------------------------------- */}
        <section className="container border-b border-line py-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-ink-2">
            <span className="inline-block border border-line bg-surface-2 px-2 py-[2px] text-[11px] font-bold uppercase tracking-wider text-ink">
              Fork
            </span>
            <span>
              Codeplane is an experimental fork of <a className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="https://opencode.ai">opencode</a> — personal use only.
            </span>
            <Link href="/docs/" className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
              Read the docs
            </Link>
          </div>
        </section>

        {/* Hero -------------------------------------------------------- */}
        <section className="container border-b border-line py-20 sm:py-24">
          <h1 className="text-[clamp(36px,6vw,64px)] leading-[1.05] font-bold tracking-tight text-ink">
            A self-hosted coding agent.
          </h1>
          <div className="mt-8 max-w-[44em] text-[15px] leading-relaxed text-ink-2 space-y-3">
            <p>Bring any model — Claude, GPT, Gemini, OpenRouter, Ollama, vLLM, custom.</p>
            <p>One server. Four front-ends — terminal, desktop, web, iOS.</p>
            <p>Sessions follow you across every device on your network.</p>
          </div>
          <HeroInstall />

          {/* Hero CTAs */}
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px]">
            <Link
              href="/docs/install/"
              className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 font-bold text-surface hover:opacity-85"
            >
              <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.75} />
              All install options
            </Link>
            <Link
              href="/docs/"
              className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-ink hover:border-ink"
            >
              Read the docs
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
            </Link>
          </div>
        </section>

        {/* Terminal demo mock ----------------------------------------- */}
        <section className="container border-b border-line py-10">
          <div className="border border-line bg-[var(--code-bg)] p-5 font-mono text-[12.5px] leading-[1.65] text-[var(--code-fg)] overflow-x-auto">
            <div className="text-[var(--code-muted)]"># codeplane web --port 4096</div>
            <div className="text-[var(--code-muted)]"># Loaded codeplane.json (3 providers, 2 MCP servers)</div>
            <div className="text-[var(--code-muted)]"># Listening on http://localhost:4096</div>
            <div>&nbsp;</div>
            <div className="text-[var(--code-fg)]">› implement age-validate on register, write a test</div>
            <div className="text-[var(--code-muted)]">  • Reading app/Models/User.php</div>
            <div className="text-[var(--code-muted)]">  • Reading database/factories/UserFactory.php</div>
            <div className="text-[var(--code-muted)]">  • Editing app/Actions/Fortify/PasswordValidationRules.php</div>
            <div className="text-[var(--code-muted)]">  • Running tests/Feature/Auth/RegistrationTest.php</div>
            <div>
              <span className="text-[var(--code-muted)]">  ✓ </span>
              43 passed (135 assertions) <span className="text-[var(--code-muted)]">in 1.37s</span>
            </div>
          </div>
        </section>

        {/* What is Codeplane ------------------------------------------ */}
        <section className="container border-b border-line py-20">
          <h3 className="text-[18px] font-bold text-ink mb-6">What is Codeplane?</h3>
          <p className="text-[15px] leading-relaxed text-ink-2 max-w-prose mb-10">
            Codeplane is an experimental fork of{" "}
            <a className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="https://opencode.ai">opencode</a>{" "}
            — an open-source AI coding agent that lives on your own hardware. It is maintained by
            one person for one workflow, and the fork iterates faster than upstream on UI work,
            mobile, and packaging. Stick with opencode if you need a stable agent; try Codeplane if
            you want to experiment.
          </p>
          <ul className="bullet-list text-[14px]">
            <li>
              <div>
                <span className="title">Self-hosted</span>
                Runs as a server on your machine, VPS, or homelab. Zero telemetry, no Codeplane cloud.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Any model</span>
                OpenAI, Anthropic, OpenRouter, Ollama, vLLM, custom OpenAI-compatible endpoints — per-session.
              </div>
            </li>
            <li>
              <div>
                <span className="title">MCP-native</span>
                Wire in any Model Context Protocol server. Filesystem, GitHub, Sequential Thinking bundled.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Multi-surface</span>
                Terminal, desktop (electron), web, iOS (TestFlight) — one server, every device on your network.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Queued follow-ups</span>
                Stack tasks and drag to reorder. Sessions branch, revert, and share by deep-link.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Plugin SDK</span>
                Custom tools, agents, prompts via <code className="bg-surface-2 px-1">@codeplane-ai/plugin</code>.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Permissioned</span>
                Per-directory + per-session approval rules. Global auto-accept toggle for chore sessions.
              </div>
            </li>
          </ul>
          <p className="mt-10 text-[14px]">
            <Link href="/docs/" className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
              Read docs
            </Link>
            {" "}or jump to{" "}
            <Link href="/docs/install/" className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
              Install
            </Link>.
          </p>
        </section>

        {/* Stats board ----------------------------------------------- */}
        <section className="container border-b border-line py-20">
          <h3 className="text-[18px] font-bold text-ink mb-4">The shape of the project</h3>
          <ul className="bullet-list text-[14px] mb-12">
            <li>
              <div>
                Codeplane runs across <strong>5 surfaces</strong>, supports <strong>75+ LLM providers</strong>{" "}
                via OpenAI-compatible config, and ships <strong>0 bytes of telemetry</strong>.
              </div>
            </li>
          </ul>
          <StatsBoard />
        </section>

        {/* Privacy --------------------------------------------------- */}
        <section className="container border-b border-line py-20">
          <h3 className="text-[18px] font-bold text-ink mb-6">Built for privacy first</h3>
          <ul className="bullet-list text-[14px]">
            <li>
              <div>
                Codeplane stores nothing outside your machine. Sessions live in a SQLite file in
                your config directory; backups are whatever you do with your dotfiles. There is no
                analytics endpoint and no "phone-home" feature flag.{" "}
                <Link className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="/docs/self-hosting/">
                  Self-hosting →
                </Link>
              </div>
            </li>
          </ul>
        </section>

        {/* FAQ ------------------------------------------------------- */}
        <section className="container border-b border-line py-20">
          <h3 className="text-[18px] font-bold text-ink mb-6">FAQ</h3>
          <Faq />
        </section>

        {/* Upstream callout ----------------------------------------- */}
        <section className="container border-b border-line py-20">
          <h2 className="text-[22px] font-bold text-ink mb-4">
            Want the stable version? Use opencode.
          </h2>
          <p className="max-w-prose text-[15px] leading-relaxed text-ink-2">
            Codeplane is a personal fork — useful if you want to play with experimental UI work, but
            not where you should run production agents. The upstream{" "}
            <a className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="https://opencode.ai">opencode</a>
            {" "}project ships a stable release on a regular cadence and is the project to bring
            issues, ideas, and contributions to.
          </p>
          <p className="mt-6">
            <a
              href="https://opencode.ai"
              className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-[13px] text-ink hover:border-ink"
            >
              Go to opencode.ai
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
            </a>
          </p>
        </section>

      </div>
      <SiteFooter />
    </>
  )
}
