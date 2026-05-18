"use client"

import { useState } from "react"

/*
 * Hero install tabs. Only methods that ACTUALLY exist are listed:
 *
 *   curl  → docs/install bash script, fetches the npm tarball
 *   npm   → published as `codeplane-ai` (the wrapper package). NOT
 *           `codeplane` — that name is taken by an unrelated package.
 *   bun   → same npm package via `bun install`.
 *
 * Homebrew tap, AUR (codeplane-bin), and pnpm-specific commands
 * deliberately omitted — none of them have a published artefact today.
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
