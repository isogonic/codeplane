import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Download01Icon } from "@hugeicons/core-free-icons"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { HeroInstall } from "@/components/hero-install"
import { Faq } from "@/components/faq"
import { StatsBoard } from "@/components/stats"

/*
 * Landing page. Full-width, Inter for everything but code. The hero is
 * sized to fill the first viewport on any device (min-h: 100svh minus
 * the header), with the fork disclosure folded in so nothing pushes it
 * below the fold. Sections below are divided by edge-to-edge hairlines —
 * no rails, no cards, no badge chips.
 *
 * The fork disclosure repeats in the hero, "Why Codeplane", the FAQ, the
 * upstream callout, and the footer — you have to ignore it to miss it.
 */
export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* Hero — fills the first screen on every device ----------------- */}
      <section className="flex min-h-[calc(100svh_-_var(--header-h))] flex-col justify-center border-b border-line">
        <div className="shell py-12">
          <div className="eyebrow mb-4">Codeplane · self-hosted coding agent</div>
          <h1 className="display max-w-[15ch]">Your coding agent, everywhere you code.</h1>
          <p className="lede mt-5 max-w-xl">
            One server on your own hardware. Reach it from the terminal, desktop, browser, or your
            phone — same sessions, same keys, any model.
          </p>

          <div className="mt-8">
            <HeroInstall />
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/docs/install/" className="btn btn-primary">
              <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.75} />
              All install options
            </Link>
            <Link href="/docs/" className="btn btn-secondary">
              Read the docs
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
            </Link>
          </div>

          <p className="mt-8 text-[12.5px] leading-relaxed text-ink-muted">
            An experimental fork of{" "}
            <a className="link" href="https://opencode.ai">opencode</a> — personal use only.
          </p>
        </div>
      </section>

      {/* Why Codeplane + feature grid ---------------------------------- */}
      <section className="border-b border-line">
        <div className="shell py-16 sm:py-20">
          <div className="eyebrow mb-3">Why Codeplane</div>
          <h2 className="h-section max-w-[20ch]">A coding agent you own, end to end.</h2>
          <p className="body-copy measure-wide mt-5">
            Codeplane is an experimental fork of{" "}
            <a className="link" href="https://opencode.ai">opencode</a> — the open-source agent that
            runs on your own machine instead of someone else’s cloud. It’s maintained by one person
            for one workflow, and it iterates faster than upstream on interface, mobile, and
            packaging. Run opencode if you want a stable, production agent; run Codeplane if you want
            to live on the edge of the UI work.
          </p>

          <ul className="bullet-list cols-2 mt-11 text-[13.5px]">
            <li>
              <div>
                <span className="title">Self-hosted, zero telemetry</span>
                Runs as a server on your laptop, VPS, or homelab. Your code and provider keys never
                leave hardware you control. No Codeplane cloud, nothing phoning home.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Any model, per session</span>
                Claude, GPT, Gemini, OpenRouter, a local Ollama or vLLM endpoint — anything
                OpenAI-compatible. Switch models mid-project without restarting the server.
              </div>
            </li>
            <li>
              <div>
                <span className="title">One server, every surface</span>
                Terminal, desktop, web, and iOS all attach to the same instance. Start a session at
                your desk, keep typing from your phone on the couch.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Sessions that follow you</span>
                Threads branch, revert, and share by deep link. Queue follow-up tasks and drag to
                reorder while the agent is still working.
              </div>
            </li>
            <li>
              <div>
                <span className="title">MCP-native</span>
                Wire in any Model Context Protocol server. Filesystem, GitHub, and Sequential
                Thinking ship in the box — add your own in a line of config.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Plugin SDK</span>
                Add custom tools, agents, and prompts with{" "}
                <code className="bg-surface-3 px-1">@codeplane-ai/plugin</code> — the same API the
                built-ins are written against.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Permissioned by default</span>
                Per-directory and per-session rules gate every file write and shell command. Flip on
                auto-accept for the chore sessions you already trust.
              </div>
            </li>
            <li>
              <div>
                <span className="title">Honest about the trade-off</span>
                It’s a personal fork, not a product. APIs shift between point releases — that’s the
                price of moving fast, and it’s stated plainly on every page.
              </div>
            </li>
          </ul>

          <p className="mt-10 text-[13.5px]">
            <Link href="/docs/" className="link font-semibold text-ink-2">Read the docs</Link>
            {" "}or jump straight to{" "}
            <Link href="/docs/install/" className="link font-semibold text-ink-2">Install</Link>.
          </p>
        </div>
      </section>

      {/* Stats --------------------------------------------------------- */}
      <section className="border-b border-line">
        <div className="shell py-16 sm:py-20">
          <div className="eyebrow mb-3">The shape of the project</div>
          <h2 className="h-section max-w-[20ch]">Small, honest numbers.</h2>
          <p className="body-copy measure-wide mb-12 mt-5">
            Codeplane runs across five surfaces, speaks to <strong className="text-ink">75+ providers</strong>{" "}
            through OpenAI-compatible config, and ships exactly <strong className="text-ink">zero bytes</strong>{" "}
            of telemetry. This is a personal project — the figures are real, not a pitch deck.
          </p>
          <StatsBoard />
        </div>
      </section>

      {/* Privacy ------------------------------------------------------- */}
      <section className="border-b border-line">
        <div className="shell py-16 sm:py-20">
          <div className="eyebrow mb-3">Privacy first</div>
          <h2 className="h-section max-w-[20ch]">Nothing leaves your machine.</h2>
          <p className="body-copy measure-wide mt-5">
            Sessions live in a single SQLite file inside your config directory — back it up like any
            dotfile. There’s no analytics endpoint, no feature-flag service, no “anonymous usage”
            toggle buried in settings. The server fronts your provider keys, so it refuses to bind a
            public address without a password. Privacy isn’t a setting here; it’s the default you
            can’t turn off.
          </p>
          <p className="mt-6 text-[13.5px]">
            <Link className="link font-semibold text-ink-2" href="/docs/self-hosting/">
              Self-hosting guide →
            </Link>
          </p>
        </div>
      </section>

      {/* FAQ ----------------------------------------------------------- */}
      <section className="border-b border-line">
        <div className="shell py-16 sm:py-20">
          <div className="eyebrow mb-3">Questions</div>
          <h2 className="h-section mb-8 max-w-[20ch]">Before you install.</h2>
          <Faq />
        </div>
      </section>

      {/* Upstream callout ---------------------------------------------- */}
      <section className="border-b border-line">
        <div className="shell py-16 sm:py-20">
          <div className="eyebrow mb-3">A fair warning</div>
          <h2 className="h-section max-w-[24ch]">Want the stable version? Use opencode.</h2>
          <p className="body-copy measure-wide mt-5">
            Codeplane is a personal fork — the right tool if you enjoy experimental interface work,
            the wrong one for production agents. Upstream{" "}
            <a className="link" href="https://opencode.ai">opencode</a> ships stable releases on a
            steady cadence and is where issues, ideas, and contributions belong.
          </p>
          <p className="mt-7">
            <a href="https://opencode.ai" className="btn btn-secondary">
              Go to opencode.ai
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
            </a>
          </p>
        </div>
      </section>

      <SiteFooter />
    </>
  )
}
