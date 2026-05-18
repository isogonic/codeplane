import Link from "next/link"
import { Logo } from "./logo"

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-line py-16 text-sm text-ink-muted">
      <div className="container">
        <div className="flex flex-wrap items-start justify-between gap-12">
          <Link href="/" className="inline-flex items-center gap-3 font-semibold text-ink">
            <Logo />
            Codeplane
          </Link>
          <div className="flex flex-wrap gap-12">
            <div className="flex flex-col gap-2">
              <h5 className="mb-3 text-[13px] font-semibold text-ink">Product</h5>
              <Link href="/docs/install/" className="hover:text-ink">Install</Link>
              <Link href="/docs/" className="hover:text-ink">Docs</Link>
              <Link href="/docs/changelog/" className="hover:text-ink">Changelog</Link>
            </div>
            <div className="flex flex-col gap-2">
              <h5 className="mb-3 text-[13px] font-semibold text-ink">Surfaces</h5>
              <Link href="/docs/tui/" className="hover:text-ink">Terminal</Link>
              <Link href="/docs/desktop/" className="hover:text-ink">Desktop</Link>
              <Link href="/docs/web/" className="hover:text-ink">Web</Link>
              <Link href="/docs/mobile/" className="hover:text-ink">Mobile</Link>
            </div>
            <div className="flex flex-col gap-2">
              <h5 className="mb-3 text-[13px] font-semibold text-ink">Community</h5>
              <a href="https://github.com/devinoldenburg/codeplane" className="hover:text-ink">GitHub</a>
              <a href="https://github.com/devinoldenburg/codeplane/issues" className="hover:text-ink">Issues</a>
              <a href="https://github.com/devinoldenburg/codeplane/releases" className="hover:text-ink">Releases</a>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap justify-between gap-6 border-t border-line pt-6 text-[13px]">
          <div>© 2026 Codeplane · MIT licensed</div>
          <a href="https://github.com/devinoldenburg/codeplane">github.com/devinoldenburg/codeplane</a>
        </div>
      </div>
    </footer>
  )
}
