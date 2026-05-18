import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { DocsLayout } from "@/components/docs-sidebar"
import { allReleases, type Release } from "@/lib/releases"

/*
 * Changelog page — sourced straight from GitHub releases at build time.
 * Every Codeplane release (CLI, desktop, and mobile) lives there with
 * the workflow-generated release notes; this page renders the most
 * recent 30 entries in a single timeline. No hand-curated copy that
 * drifts out of sync.
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
  // Strip GitHub Generate-release-notes preamble ("## What's Changed",
  // "**Full Changelog**" trailer) so the body reads like a commit
  // message list rather than a templated form.
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

export default async function ChangelogPage() {
  const releases = await allReleases()
  const visible = releases.filter((r) => !r.prerelease).slice(0, 30)

  return (
    <>
      <SiteHeader active="docs" />
      <DocsLayout active="/docs/changelog/">
        <h1>Changelog</h1>
        <p className="lede">
          Notable changes per release, pulled directly from{" "}
          <a href="https://github.com/devinoldenburg/codeplane/releases">
            github.com/devinoldenburg/codeplane/releases
          </a>{" "}
          at site build time. Each release ID is linked to its GitHub release page where the
          attached binaries + full commit history live.
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
          <ul className="!pl-0 !list-none">
            {visible.map((r) => (
              <ReleaseEntry key={r.tag_name} release={r} />
            ))}
          </ul>
        )}

        <h2>Older history</h2>
        <p>
          Every release before this site existed lives on the{" "}
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
    <li className="!grid-cols-1 border-t border-line py-6 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-3">
        <a
          href={release.html_url}
          className="font-bold !text-ink !decoration-line hover:!decoration-ink"
        >
          {release.tag_name}
        </a>
        <span className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</span>
        <span className="text-[12px] text-ink-muted">{formatDate(release.published_at)}</span>
      </div>
      {body ? (
        <pre className="!my-3 !p-0 !bg-transparent !border-0 !text-[13px] !leading-relaxed text-ink-2 whitespace-pre-wrap">{body}</pre>
      ) : (
        <p className="!my-3 text-ink-muted">No release notes attached.</p>
      )}
    </li>
  )
}
