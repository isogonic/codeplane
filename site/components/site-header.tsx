import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { Logo } from "./logo"

/*
 * Sticky site header — translucent with backdrop blur so it floats over
 * long-form content without losing the underlying texture. Every page
 * embeds this once via the root layout; the `active` prop highlights the
 * active section in the nav.
 */
export function SiteHeader({ active }: { active?: "docs" | "install" }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/85 backdrop-blur-md backdrop-saturate-150">
      <div className="container flex h-16 items-center gap-6">
        <Link href="/" aria-label="Codeplane home" className="inline-flex items-center gap-3 font-semibold tracking-tight text-[15px] text-ink">
          <Logo />
          <span>Codeplane</span>
        </Link>
        <nav className="ml-auto flex items-center gap-6 text-sm text-ink-muted">
          <Link
            href="/docs/"
            className={`py-1 transition-colors hover:text-ink ${active === "docs" ? "text-ink" : ""}`}
          >
            Docs
          </Link>
          <Link
            href="/docs/install/"
            className={`hidden sm:inline py-1 transition-colors hover:text-ink ${active === "install" ? "text-ink" : ""}`}
          >
            Install
          </Link>
          <a
            href="https://github.com/devinoldenburg/codeplane"
            className="hidden sm:inline py-1 transition-colors hover:text-ink"
          >
            GitHub
          </a>
          <Link
            href="/docs/install/"
            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface hover:opacity-85 transition-opacity"
          >
            Get Codeplane
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={1.5} />
          </Link>
        </nav>
      </div>
    </header>
  )
}
