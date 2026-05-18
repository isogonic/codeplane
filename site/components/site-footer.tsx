import Link from "next/link"
import { latestCliVersion } from "@/lib/releases"

/*
 * Site footer. The published version label is resolved at build time
 * from the npm registry so it never drifts out of sync with the actual
 * release. The "fork notice" line stays prominent — anyone who scrolled
 * past it on the homepage sees it again here.
 */
export async function SiteFooter() {
  const version = await latestCliVersion()
  return (
    <footer className="mt-24 border-t border-line">
      <div className="rail">
        <div className="container">
          <div className="grid grid-cols-1 border-line text-center text-[13px] text-ink-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <FootCell href="https://github.com/devinoldenburg/codeplane">
              GitHub <span className="text-ink-muted">[fork]</span>
            </FootCell>
            <FootCell href="/docs/">Docs</FootCell>
            <FootCell href="/docs/changelog/">Changelog</FootCell>
            <FootCell href="https://github.com/devinoldenburg/codeplane/discussions">Discussions</FootCell>
            <FootCell href="https://opencode.ai">Upstream</FootCell>
          </div>
          <div className="flex flex-col items-center gap-2 border-t border-line py-7 text-center text-[12px] text-ink-muted">
            <div>
              ©2026 Codeplane · MIT licensed · Experimental fork of{" "}
              <a className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink" href="https://opencode.ai">
                opencode
              </a>
              {" "}for personal use — not affiliated with Anomaly.
            </div>
            <div>
              Built by{" "}
              <a
                className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink"
                href="https://devinoldenburg.com"
                rel="author"
              >
                Devin Oldenburg
              </a>
              .
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
              <a className="hover:text-ink" href="https://github.com/devinoldenburg/codeplane">github.com/devinoldenburg/codeplane</a>
              <Link className="hover:text-ink" href="/docs/changelog/">v{version}</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FootCell({ href, children }: { href: string; children: React.ReactNode }) {
  const className =
    "block border-line py-6 transition-colors hover:text-ink border-r last:border-r-0"
  if (href.startsWith("/")) {
    return <Link href={href} className={className}>{children}</Link>
  }
  return <a href={href} className={className}>{children}</a>
}
