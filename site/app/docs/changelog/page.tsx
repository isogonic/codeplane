import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"
import { allReleases, type Release } from "@/lib/releases"

/*
 * Changelog page — sourced straight from GitHub releases at build time
 * and grouped by base version (e.g. v28.21.22). Within each group the
 * CLI release body is shown by default; the platform-specific
 * `-desktop` and `-mobile` sub-records nest underneath as collapsible
 * <details> elements so the page reads as one entry per version
 * without losing the per-platform notes.
 */
export const metadata = {
  title: "Changelog",
  description: "Notable changes per Codeplane release — pulled directly from GitHub Releases at build time, grouped by base version.",
  alternates: { canonical: "/docs/changelog/" },
  openGraph: {
    title: "Changelog · Codeplane",
    description: "Notable changes per Codeplane release — pulled directly from GitHub Releases at build time, grouped by base version.",
    url: "/docs/changelog/",
    type: "article",
  },
  twitter: {
    title: "Changelog · Codeplane",
    description: "Notable changes per Codeplane release — pulled directly from GitHub Releases at build time, grouped by base version.",
    card: "summary_large_image",
  },
}

function shapeOf(tag: string): "cli" | "desktop" | "mobile" {
  if (tag.endsWith("-desktop")) return "desktop"
  if (tag.endsWith("-mobile")) return "mobile"
  return "cli"
}

function baseTagOf(tag: string): string {
  return tag.replace(/-desktop$|-mobile$/, "")
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
 * Light-touch inline markdown renderer — handles only the constructs
 * GitHub release notes actually use: **bold**, `code`, [text](url),
 * bare URLs, @user, #123. Headings and bullets are line-level and
 * handled in renderBody below.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
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
    if (text.startsWith("**", i) || text.startsWith("__", i)) {
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
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1)
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2)
        if (closeParen !== -1) {
          flush()
          out.push(
            <a key={`${keyPrefix}-l${n++}`} href={text.slice(closeBracket + 2, closeParen)} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
              {text.slice(i + 1, closeBracket)}
            </a>,
          )
          i = closeParen + 1
          continue
        }
      }
    }
    if (text.startsWith("http://", i) || text.startsWith("https://", i)) {
      const m = text.slice(i).match(/^https?:\/\/[^\s)<>"']+/)
      if (m) {
        flush()
        out.push(
          <a key={`${keyPrefix}-u${n++}`} href={m[0]} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink break-all">
            {m[0]}
          </a>,
        )
        i += m[0].length
        continue
      }
    }
    if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]))) {
      const m = text.slice(i).match(/^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)/)
      if (m) {
        flush()
        out.push(
          <a key={`${keyPrefix}-m${n++}`} href={`https://github.com/${m[1]}`} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
            {m[0]}
          </a>,
        )
        i += m[0].length
        continue
      }
    }
    if (text[i] === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const m = text.slice(i).match(/^#(\d+)/)
      if (m) {
        flush()
        out.push(
          <a key={`${keyPrefix}-i${n++}`} href={`https://github.com/devinoldenburg/codeplane/pull/${m[1]}`} className="underline underline-offset-4 decoration-line hover:decoration-ink hover:text-ink">
            {m[0]}
          </a>,
        )
        i += m[0].length
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
        return <p key={k}>{renderInline(b.text, k)}</p>
      })}
    </div>
  )
}

type Group = {
  base: string
  cli?: Release
  desktop?: Release
  mobile?: Release
  newestDate: string
}

function parseSemver(base: string): [number, number, number] {
  const m = base.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!m) return [0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function groupReleases(releases: Release[]): Group[] {
  const map = new Map<string, Group>()
  for (const r of releases) {
    const base = baseTagOf(r.tag_name)
    const shape = shapeOf(r.tag_name)
    let g = map.get(base)
    if (!g) {
      g = { base, newestDate: r.published_at ?? "" }
      map.set(base, g)
    }
    if (shape === "cli") g.cli = r
    else if (shape === "desktop") g.desktop = r
    else if (shape === "mobile") g.mobile = r
    if ((r.published_at ?? "") > g.newestDate) g.newestDate = r.published_at ?? ""
  }
  // Sort by semver descending — published_at can lie when a workflow
   // is re-triggered for an older version, putting v28.21.21 above v28.21.22.
  return Array.from(map.values()).sort((a, b) => {
    const va = parseSemver(a.base)
    const vb = parseSemver(b.base)
    for (let i = 0; i < 3; i++) {
      if (vb[i] !== va[i]) return vb[i] - va[i]
    }
    return b.newestDate.localeCompare(a.newestDate)
  })
}

export default async function ChangelogPage() {
  const releases = await allReleases()
  const groups = groupReleases(releases.filter((r) => !r.prerelease)).slice(0, 25)

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
          at build time. Each row is one Codeplane version; the per-platform notes (Desktop /
          Mobile) are collapsed under their parent and expand inline when you click them.
        </p>

        {groups.length === 0 ? (
          <p className="text-ink-muted">
            (Couldn&apos;t reach the GitHub API at build time. Browse{" "}
            <a href="https://github.com/devinoldenburg/codeplane/releases">
              github.com/devinoldenburg/codeplane/releases
            </a>{" "}
            directly.)
          </p>
        ) : (
          <div className="!my-8 flex flex-col">
            {groups.map((g) => (
              <ReleaseGroup key={g.base} group={g} />
            ))}
          </div>
        )}

        <h2>Older history</h2>
        <p>
          Every release before this page existed lives on{" "}
          <a href="https://github.com/devinoldenburg/codeplane/releases?page=2">
            github.com/devinoldenburg/codeplane/releases?page=2
          </a>
          . The Codeplane project began at v28.0.0; nothing older exists in this fork.
        </p>
      </DocsLayout>
      <SiteFooter />
    </>
  )
}

function ReleaseGroup({ group }: { group: Group }) {
  const headerRelease = group.cli ?? group.desktop ?? group.mobile
  if (!headerRelease) return null

  // The general (CLI) release is always the headline. Its body is shown
  // inline; both Desktop and Mobile are rendered as collapsed <details>
  // below as separate per-platform changelogs.
  const generalBody = group.cli ? shortenBody(group.cli.body) : ""

  return (
    <div className="border-t border-line py-7 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <a
          href={headerRelease.html_url}
          className="text-[15px] font-bold !text-ink !decoration-line hover:!decoration-ink"
        >
          {group.base}
        </a>
        <span className="text-[12px] text-ink-muted">{formatDate(group.newestDate)}</span>
      </div>

      {generalBody
        ? renderBody(generalBody, group.base)
        : (
          <p className="mt-3 text-[13px] text-ink-muted">
            No general (CLI) release notes for this version — see the platform changelogs below.
          </p>
        )}

      <div className="mt-4 flex flex-col gap-2">
        {group.desktop ? <PlatformDetails release={group.desktop} label="Desktop" /> : null}
        {group.mobile ? <PlatformDetails release={group.mobile} label="Mobile" /> : null}
      </div>
    </div>
  )
}

function PlatformDetails({ release, label }: { release: Release; label: string }) {
  const body = shortenBody(release.body)
  return (
    <details className="group border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-2 text-[13px] text-ink-muted hover:text-ink select-none">
        <span className="mr-2 inline-block w-3 text-ink-muted group-open:hidden">+</span>
        <span className="mr-2 inline-block w-3 text-ink-muted hidden group-open:inline-block">−</span>
        <span className="font-bold uppercase tracking-wider text-[11px] text-ink">{label}</span>
        <span className="ml-2 text-ink-muted">{release.tag_name}</span>
      </summary>
      <div className="px-4 pb-4 -mt-1">
        {body ? renderBody(body, release.tag_name) : (
          <p className="mt-2 text-[13px] text-ink-muted">No release notes attached.</p>
        )}
      </div>
    </details>
  )
}
