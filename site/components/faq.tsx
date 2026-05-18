"use client"

import { useState } from "react"

/*
 * opencode.ai-style FAQ accordion: each row is a `+`/`−` toggle, the
 * question text on the same baseline, and an inline answer when open.
 * `<details>` would handle this with zero JS, but the marker styling
 * we want (`[+]`/`[−]` instead of a triangle) is easier with a manual
 * client component.
 */
type Item = { q: string; a: React.ReactNode }

const ITEMS: Item[] = [
  {
    q: "What is Codeplane?",
    a: (
      <>
        Codeplane is an experimental fork of <a href="https://opencode.ai">opencode</a>, run as a
        personal project. It carries the same idea — one self-hosted server with terminal, desktop,
        web, and mobile front-ends — and adds tweaks the maintainer wants for their own daily flow.
      </>
    ),
  },
  {
    q: "Is this affiliated with opencode or Anomaly?",
    a: (
      <>
        No. Codeplane is an independent fork maintained at{" "}
        <a href="https://github.com/devinoldenburg/codeplane">github.com/devinoldenburg/codeplane</a>.
        It is not endorsed by, supported by, or aligned with the opencode team. The fork rebases on
        upstream releases as they ship.
      </>
    ),
  },
  {
    q: "Should I use Codeplane for production work?",
    a: (
      <>
        Probably not. This site says it on every page for a reason: Codeplane is experimental. APIs
        shift between point releases, the desktop signer is a personal Apple developer ID, and the
        mobile shell is iOS-TestFlight only. If you want a stable agent, run the upstream{" "}
        <a href="https://opencode.ai">opencode</a>.
      </>
    ),
  },
  {
    q: "Why fork instead of contributing upstream?",
    a: (
      <>
        Most of the changes Codeplane carries are personal-preference UI work — the radix-nova
        design language port, the strict light/dark switcher, the queued-follow-up drag direction.
        Forking lets the maintainer iterate without negotiating each tweak. Bug fixes that apply
        upstream are filed there too.
      </>
    ),
  },
  {
    q: "Which LLM providers work?",
    a: (
      <>
        Anything OpenAI-compatible: OpenAI, Anthropic, OpenRouter, Ollama, vLLM, custom self-hosted
        endpoints. Provider config lives in your <code>codeplane.json</code>. Per-session overrides
        let you switch models without restarting the server.
      </>
    ),
  },
  {
    q: "Where does my data go?",
    a: (
      <>
        Nowhere Codeplane controls. Codeplane runs as a server you host. There is no Codeplane
        cloud, no analytics endpoint, no telemetry. Sessions persist to the SQLite file inside your
        local config dir; you back it up the same way you back up your dotfiles.
      </>
    ),
  },
  {
    q: "Can I use it just in the terminal?",
    a: (
      <>
        Yes — <code>codeplane tui</code> launches the full-screen terminal interface, no other
        surface required. The desktop, web, and mobile apps connect to the same server, so you can
        start a session in the terminal and continue it on your phone.
      </>
    ),
  },
  {
    q: "How much does it cost?",
    a: (
      <>
        Codeplane itself is MIT-licensed and free. You bring your own model — pay your usual
        provider rates (OpenAI, Anthropic, etc.), or run a local model with no per-token cost.
      </>
    ),
  },
]

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <ul className="flex flex-col">
      {ITEMS.map((item, i) => {
        const isOpen = open === i
        return (
          <li key={i} className="border-t border-line first:border-t-0">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="grid w-full grid-cols-[auto_1fr] items-baseline gap-4 py-4 text-left text-[14.5px] text-ink"
            >
              <span aria-hidden className="text-ink-muted">{isOpen ? "[−]" : "[+]"}</span>
              <span className="font-medium">{item.q}</span>
            </button>
            {isOpen ? (
              <div className="grid grid-cols-[auto_1fr] gap-4 pb-5 text-[13.5px] leading-relaxed text-ink-2">
                <span aria-hidden className="invisible select-none">[+]</span>
                <div className="docs-prose-inline [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-line [&_a:hover]:decoration-ink [&_code]:bg-surface-2 [&_code]:px-1">
                  {item.a}
                </div>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
