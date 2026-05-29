import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download01Icon } from "@hugeicons/core-free-icons"
import { Logo } from "./logo"

/*
 * Sticky full-width header. Paper-plane mark on the left, monospace nav
 * on the right, ink-filled "Download" CTA. The bottom hairline runs
 * edge-to-edge; content sits inside the shared `.shell`.
 */
export function SiteHeader({ active }: { active?: "docs" | "install" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface">
      <div className="shell flex h-[56px] items-center gap-3 text-[13px] sm:gap-6">
        <Link
          href="/"
          aria-label="Codeplane home"
          className="inline-flex items-center text-ink"
        >
          <Logo size={22} />
        </Link>
        <nav className="ml-auto flex items-center gap-5 text-ink-2 sm:gap-7">
          <a
            href="https://github.com/devinoldenburg/codeplane"
            className="hidden transition-colors hover:text-ink sm:inline"
          >
            GitHub
          </a>
          <Link
            href="/docs/"
            className={`transition-colors hover:text-ink ${active === "docs" ? "text-ink" : ""}`}
          >
            Docs
          </Link>
          <a
            href="https://opencode.ai"
            className="hidden transition-colors hover:text-ink md:inline"
            title="Upstream — Codeplane is an experimental fork of opencode."
          >
            Upstream
          </a>
          <Link
            href="/docs/install/"
            className={`btn btn-primary !py-2 !px-3.5 ${active === "install" ? "opacity-100" : ""}`}
          >
            <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.75} />
            Download
          </Link>
        </nav>
      </div>
    </header>
  )
}
