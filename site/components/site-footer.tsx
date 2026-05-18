import Link from "next/link"

/*
 * opencode.ai-style footer: a 5-cell horizontal nav grid with vertical
 * borders matching the column rails, then a centred copyright + minor
 * links strip. The "fork notice" line is the bridge that names the
 * upstream project so anyone landing here from a search has it called
 * out before reading anything else.
 */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="rail">
        <div className="container">
          <div className="grid grid-cols-2 border-line text-center text-[13px] text-ink-2 md:grid-cols-5">
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
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
              <a className="hover:text-ink" href="https://github.com/devinoldenburg/codeplane">github.com/devinoldenburg/codeplane</a>
              <Link className="hover:text-ink" href="/docs/changelog/">v28.4.1</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FootCell({ href, children }: { href: string; children: React.ReactNode }) {
  const className =
    "block border-line py-6 transition-colors hover:text-ink border-r last:border-r-0 max-md:nth-last-child-1:border-r-0"
  if (href.startsWith("/")) {
    return <Link href={href} className={className}>{children}</Link>
  }
  return <a href={href} className={className}>{children}</a>
}
