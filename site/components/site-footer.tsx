import Link from "next/link"
import { Logo } from "./logo"
import { latestCliVersion } from "@/lib/releases"

/*
 * Full-width footer. Published version is resolved at build time from
 * the npm registry so it never drifts from the real release. The fork
 * disclosure stays prominent — anyone who scrolled past it on the
 * homepage meets it again here.
 */
export async function SiteFooter() {
  const version = await latestCliVersion()
  return (
    <footer className="mt-28 border-t border-line">
      <div className="shell flex flex-col gap-8 py-14 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center text-ink">
          <Logo size={20} />
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-3 text-[13px] text-ink-2">
          <a className="transition-colors hover:text-ink" href="https://github.com/isogonic/codeplane">
            GitHub
          </a>
          <Link className="transition-colors hover:text-ink" href="/docs/">Docs</Link>
          <Link className="transition-colors hover:text-ink" href="/docs/install/">Install</Link>
          <Link className="transition-colors hover:text-ink" href="/docs/changelog/">Changelog</Link>
          <a className="transition-colors hover:text-ink" href="https://opencode.ai">Upstream</a>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="shell flex flex-col gap-2 py-7 text-[12px] leading-relaxed text-ink-muted">
          <div>
            ©2026 Codeplane · MIT licensed · An experimental fork of{" "}
            <a className="link" href="https://opencode.ai">opencode</a>{" "}
            for personal use — not affiliated with Anomaly.
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span>
              Built by{" "}
              <a className="link" href="https://github.com/isogonic" rel="author">Isogonic</a>.
            </span>
            <a className="transition-colors hover:text-ink" href="https://github.com/isogonic/codeplane">
              github.com/isogonic/codeplane
            </a>
            <Link className="transition-colors hover:text-ink" href="/docs/changelog/">v{version}</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
