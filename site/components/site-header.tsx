import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download01Icon } from "@hugeicons/core-free-icons"
import { Logo } from "./logo"

/*
 * Sticky header — paper-plane mark on the left (no wordmark — the logo
 * stands alone), monospace nav links centre/right, black-on-white
 * "Download" CTA on the right.
 */
export function SiteHeader({ active }: { active?: "docs" | "install" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="container flex h-[76px] items-center gap-3 sm:gap-6 text-[14px]">
        <Link
          href="/"
          aria-label="Codeplane home"
          className="inline-flex items-center text-ink"
        >
          <Logo size={26} />
        </Link>
        <nav className="ml-auto flex items-center gap-5 sm:gap-7 text-ink-2">
          <a
            href="https://github.com/devinoldenburg/codeplane"
            className="hidden sm:inline transition-colors hover:text-ink"
          >
            GitHub <span className="text-ink-muted">[fork]</span>
          </a>
          <Link
            href="/docs/"
            className={`transition-colors hover:text-ink ${active === "docs" ? "text-ink" : ""}`}
          >
            Docs
          </Link>
          <a
            href="https://opencode.ai"
            className="hidden md:inline transition-colors hover:text-ink"
            title="Upstream — Codeplane is an experimental fork of opencode."
          >
            Upstream
          </a>
          <Link
            href="/docs/install/"
            className={`inline-flex items-center gap-2 border border-ink bg-ink px-3 py-2 font-bold text-surface transition-opacity hover:opacity-85 ${
              active === "install" ? "opacity-100" : ""
            }`}
          >
            <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.75} />
            Download
          </Link>
        </nav>
      </div>
    </header>
  )
}
