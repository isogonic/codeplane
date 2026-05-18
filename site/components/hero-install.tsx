"use client"

import { useState } from "react"

/*
 * The hero install block on the landing page: a row of monospace tabs
 * (curl / npm / bun / brew) sat above a one-line install command. The
 * tabs aren't on the docs install page — that one has a full per-OS
 * panel set — these are the five quick paths a returning user copy/pastes.
 */
type TabId = "curl" | "npm" | "bun" | "brew" | "paru"

const COMMANDS: Record<TabId, string> = {
  curl: "curl -fsSL https://codeplane.cc/install | bash",
  npm: "npm install -g codeplane",
  bun: "bun install -g codeplane",
  brew: "brew install devinoldenburg/codeplane/codeplane",
  paru: "paru -S codeplane-bin",
}

const TABS: TabId[] = ["curl", "npm", "bun", "brew", "paru"]

export function HeroInstall() {
  const [active, setActive] = useState<TabId>("curl")
  const [copied, setCopied] = useState(false)
  const cmd = COMMANDS[active]

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable; the user can still select-all the text */
    }
  }

  return (
    <div className="mt-10 border border-line bg-surface">
      <div role="tablist" className="flex items-center border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            onClick={() => setActive(t)}
            className={`relative px-5 py-3 text-[13px] font-bold transition-colors ${
              active === t ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t}
            {active === t ? (
              <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] bg-ink" />
            ) : null}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 px-5 py-4 text-[13.5px] text-ink">
        <code className="flex-1 overflow-x-auto whitespace-pre">{cmd}</code>
        <button
          onClick={copy}
          aria-label="Copy install command"
          className="shrink-0 border border-line bg-surface-2 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted hover:text-ink"
        >
          {copied ? "OK" : "Copy"}
        </button>
      </div>
    </div>
  )
}
