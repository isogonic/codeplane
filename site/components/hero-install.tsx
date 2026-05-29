"use client"

import { useState } from "react"

/*
 * Hero install picker. No card — a flat row of tabs over a single
 * command line framed by top/bottom hairlines. Only methods that
 * ACTUALLY exist are listed:
 *
 *   curl  → docs/install bash script, fetches the npm tarball
 *   npm   → published as `codeplane-ai` (the wrapper package)
 *   bun   → same npm package via `bun install`
 */
type TabId = "curl" | "npm" | "bun"

const COMMANDS: Record<TabId, string> = {
  curl: "curl -fsSL https://codeplane.cc/install | bash",
  npm: "npm install -g codeplane-ai",
  bun: "bun install -g codeplane-ai",
}

const TABS: TabId[] = ["curl", "npm", "bun"]

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
    <div className="w-full max-w-xl overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface-2 shadow-[var(--shadow-xs)]">
      <div role="tablist" aria-label="Install method" className="flex items-center gap-1 border-b border-line px-2">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            onClick={() => setActive(t)}
            className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors ${
              active === t ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t}
            {active === t ? (
              <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink" />
            ) : null}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 px-4 py-3 text-[13.5px]">
        <span aria-hidden className="select-none text-ink-soft">$</span>
        <code className="flex-1 overflow-x-auto whitespace-pre text-ink">{cmd}</code>
        <button
          onClick={copy}
          aria-label="Copy install command"
          className="shrink-0 rounded-[6px] px-2 py-1 text-[12px] font-semibold text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  )
}
