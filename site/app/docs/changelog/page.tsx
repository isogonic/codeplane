import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"
import { allReleases, type Release } from "@/lib/releases"

/*
 * Changelog page — sourced straight from GitHub releases at build time.
 * Every Codeplane release (CLI, desktop, mobile) lives there with the
 * workflow-generated release notes; this page parses each entry's
 * markdown body into proper line-by-line blocks so headings, bullets,
 * and prose don't collapse into a wall of unspaced text.
 */
export const metadata = {
  title: "Changelog",
  description: "Notable changes per Codeplane release — pulled directly from GitHub Releases at build time.",
  alternates: { canonical: "/docs/changelog/" },
  openGraph: {
    title: "Changelog · Codeplane",
    description: "Notable changes per Codeplane release — pulled directly from GitHub Releases at build time.",
    url: "/docs/changelog/",
    type: "article",
  },
  twitter: {
    title: "Changelog · Codeplane",
    description: "Notable changes per Codeplane release — pulled directly from GitHub Releases at build time.",
    card: "summary_large_image",
  },
}

function shapeOf(tag: string): "cli" | "desktop" | "mobile" {
  if (tag.endsWith("-desktop")) return "desktop"
  if (tag.endsWith("-mobile")) return "mobile"
  return "cli"
}

function shortenBody(body: string | null): string {
  if (!body) return ""
  let out = body
  out = out.replace(/^##\s+What['']s\s+Changed\s*\n/i, "")
  out = out.replace(/\*\*Full Changelog\*\*:[^\n]*$/im, "")
  out = out.replace(/^\s+|\s+$/g, "")
  return out
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

/*
 * Light-touch inline markdown renderer. Handles only the constructs we
 * actually see in GitHub release notes:
 *
 *   - **bold** / __bold__       → <strong>
 *   - `code`                    → <code>
 *   - [text](url) / bare URL    → <a>
 *   - @user / #123              → linked to github
 *
 * Headings and bullets are handled at the line level (renderBody below),
 * since they only ever appear at the start of a line.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Tokenise — order matters. Codespans first (they swallow other syntax),
  // then bold, then markdown links, then bare URLs / #refs / @mentions.
  const out: React.ReactNode[] = []
  let i = 0
  let buf = ""
  let n = 0

  const flush = () => {
    if (buf) {
      out.push(buf)
      buf = ""
    }
  }

  while (i < text.length) {
    // `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1)
      if (end !== -1) {
        flush()
        out.push(
          <code key={`${keyPrefix}-c${n++}`} className="bg-surface-2 border border-line px-[5px] py-[1px] text-[12px]">
            {text.slice(i + 1, end)}
          </code>,
        )
        i = end + 1
        continue
      }
    }
    // **bold** or __bold__
    if ((text.startsWith("**", i) || text.startsWith("__", i))) {
      const tok = text.slice(i, i + 2)
      const end = text.indexOf(tok, i + 2)
      if (end !== -1) {
        flush()
        out.push(
          <strong key={`${keyPrefix}-b${n++}`} className="font-bold text-ink">
            {renderInline(text.slice(i + 2, end), `${keyPrefix}-b${n}`)}
          </strong>,
        )
        i = end + 2
        continue
      }
    }
    // [text](url)
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1)
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2)
        if (closeParen !== -1) {
          flush()
          const linkText = text.slice(i + 1, closeBracket)
          const linkHref = text.slice(closeBracket + 2, closeParen)
          out.push(
            <a key={`${keyPrefix}-l${n++}`} href={linkHref} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
              {linkText}
            </a>,
          )
          i = closeParen + 1
          continue
        }
      }
    }
    // bare URL
    if (text.startsWith("http://", i) || text.startsWith("https://", i)) {
      const match = text.slice(i).match(/^https?:\/\/[^\s)<>"']+/)
      if (match) {
        flush()
        out.push(
          <a key={`${keyPrefix}-u${n++}`} href={match[0]} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink break-all">
            {match[0]}
          </a>,
        )
        i += match[0].length
        continue
      }
    }
    // @user (only when preceded by start-of-string or whitespace)
    if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]))) {
      const match = text.slice(i).match(/^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)/)
      if (match) {
        flush()
        out.push(
          <a key={`${keyPrefix}-m${n++}`} href={`https://github.com/${match[1]}`} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
            {match[0]}
          </a>,
        )
        i += match[0].length
        continue
      }
    }
    // #123 (PR / issue ref)
    if (text[i] === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const match = text.slice(i).match(/^#(\d+)/)
      if (match) {
        flush()
        out.push(
          <a key={`${keyPrefix}-i${n++}`} href={`https://github.com/devinoldenburg/codeplane/pull/${match[1]}`} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
            {match[0]}
          </a>,
        )
        i += match[0].length
        continue
      }
    }
    buf += text[i]
    i++
  }
  flush()
  return out
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "para"; text: string }

function parseBlocks(body: string): Block[] {
  const lines = body.split("\n")
  const blocks: Block[] = []
  let paraBuf: string[] = []
  const flushPara = () => {
    if (paraBuf.length > 0) {
      blocks.push({ kind: "para", text: paraBuf.join(" ") })
      paraBuf = []
    }
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushPara()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushPara()
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] })
      continue
    }
    const bullet = line.match(/^[*\-+]\s+(.*)$/)
    if (bullet) {
      flushPara()
      blocks.push({ kind: "bullet", text: bullet[1] })
      continue
    }
    paraBuf.push(line)
  }
  flushPara()
  return blocks
}

function renderBody(body: string, keyPrefix: string): React.ReactNode {
  const blocks = parseBlocks(body)
  if (blocks.length === 0) return null
  return (
    <div className="mt-3 flex flex-col gap-2 text-[13.5px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        const k = `${keyPrefix}-${i}`
        if (b.kind === "heading") {
          return (
            <p key={k} className="mt-2 font-bold text-ink">
              {renderInline(b.text, k)}
            </p>
          )
        }
        if (b.kind === "bullet") {
          return (
            <div key={k} className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline">
              <span className="text-ink-muted">[*]</span>
              <span>{renderInline(b.text, k)}</span>
            </div>
          )
        }
        return (
          <p key={k}>
            {renderInline(b.text, k)}
          </p>
        )
      })}
    </div>
  )
}

export default async function ChangelogPage() {
  const releases = await allReleases()
  const visible = releases.filter((r) => !r.prerelease).slice(0, 30)

  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/changelog/">
        <h1>Changelog</h1>
        <p className="lede">
          Pulled directly from{" "}
          <a href="https://github.com/devinoldenburg/codeplane/releases">
            github.com/devinoldenburg/codeplane/releases
          </a>{" "}
          at site build time. Each release tag is linked to its GitHub page where the attached
          binaries and full commit history live.
        </p>

        {visible.length === 0 ? (
          <p className="text-ink-muted">
            (Couldn&apos;t reach the GitHub API at build time. Browse{" "}
            <a href="https://github.com/devinoldenburg/codeplane/releases">
              github.com/devinoldenburg/codeplane/releases
            </a>{" "}
            directly.)
          </p>
        ) : (
          <div className="!my-8 flex flex-col">
            {visible.map((r) => (
              <ReleaseEntry key={r.tag_name} release={r} />
            ))}
          </div>
        )}

        <h2>Older history</h2>
        <p>
          Every release before this changelog existed lives on the{" "}
          <a href="https://github.com/devinoldenburg/codeplane/releases?page=2">
            second page of /releases
          </a>{" "}
          on GitHub. The Codeplane project began at v28.0.0; nothing older exists in this fork.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}

function ReleaseEntry({ release }: { release: Release }) {
  const shape = shapeOf(release.tag_name)
  const body = shortenBody(release.body)
  const label = shape === "cli" ? "CLI" : shape === "desktop" ? "Desktop" : "Mobile"
  return (
    <div className="border-t border-line py-7 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <a
          href={release.html_url}
          className="font-bold !text-ink !decoration-line hover:!decoration-ink"
        >
          {release.tag_name}
        </a>
        <span className="border border-line bg-surface-2 px-2 py-[1px] text-[10px] font-bold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <span className="text-[12px] text-ink-muted">{formatDate(release.published_at)}</span>
      </div>
      {body ? renderBody(body, release.tag_name) : (
        <p className="mt-3 text-[13px] text-ink-muted">No release notes attached.</p>
      )}
    </div>
  )
}
