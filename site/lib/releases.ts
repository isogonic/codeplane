/*
 * Build-time helpers for GitHub release data. Every function here runs
 * during `next build` (server component land); the resolved strings get
 * inlined into the static export, so the live site doesn't depend on
 * the GitHub API at request time.
 *
 * The pattern we're working around: three different release tag shapes
 * exist (`v28.21.22`, `v28.21.22-desktop`, `v28.21.22-mobile`) and GitHub's
 * `/releases/latest` pointer can land on ANY of them depending on which
 * workflow finished last. Linking at `/releases/latest/download/<file>`
 * therefore 404s half the time. Resolving the latest tag *by shape* at
 * build time gives us stable links.
 */

const API = "https://api.github.com/repos/devinoldenburg/codeplane/releases?per_page=30"

type Release = {
  tag_name: string
  name: string | null
  body: string | null
  published_at: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: Array<{ name: string; browser_download_url: string; size: number }>
}

let cache: Release[] | null = null

async function fetchReleases(): Promise<Release[]> {
  if (cache) return cache
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`
    }
    const res = await fetch(API, { headers, cache: "force-cache" })
    if (!res.ok) {
      console.warn(`[releases] GitHub API ${res.status}; using fallback data`)
      cache = []
      return cache
    }
    const json = (await res.json()) as Release[]
    cache = json.filter((r) => !r.draft)
    return cache
  } catch (err) {
    console.warn("[releases] fetch failed:", err)
    cache = []
    return cache
  }
}

function pickLatestByShape(releases: Release[], re: RegExp): Release | undefined {
  return releases
    .filter((r) => re.test(r.tag_name))
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0]
}

/**
 * Latest `v<x.y.z>-desktop` tag — the one with the dmg / AppImage / exe
 * assets. Falls back to a known-good version if the API call is rate
 * limited or unreachable at build time.
 */
export async function latestDesktopTag(): Promise<string> {
  const releases = await fetchReleases()
  return pickLatestByShape(releases, /^v\d+\.\d+\.\d+-desktop$/)?.tag_name ?? "v28.21.22-desktop"
}

/**
 * Latest `v<x.y.z>-mobile` tag — ships the iOS xcarchive (NOT a finished
 * .ipa) and the Android debug APK.
 */
export async function latestMobileTag(): Promise<string> {
  const releases = await fetchReleases()
  return pickLatestByShape(releases, /^v\d+\.\d+\.\d+-mobile$/)?.tag_name ?? "v28.21.22-mobile"
}

/**
 * Latest plain CLI version (without the `v` prefix). Read from
 * `site/package.json` because the sync-version script keeps every
 * package manifest in the monorepo in lockstep — so the field is
 * always the version the workflow is about to publish. We tried
 * querying the npm registry at build time but Next.js's static-export
 * fetch caching produced empty responses on cold builds; reading a
 * local file is deterministic.
 */
import pkg from "../package.json"
export async function latestCliVersion(): Promise<string> {
  if (pkg.version && /^\d+\.\d+\.\d+$/.test(pkg.version)) return pkg.version
  const releases = await fetchReleases()
  const tag = pickLatestByShape(releases, /^v\d+\.\d+\.\d+$/)?.tag_name
  if (tag) return tag.slice(1)
  return "28.21.22"
}

/**
 * All releases sorted newest-first. Used by the changelog page to render
 * an authoritative timeline pulled straight from GitHub at build time.
 */
export async function allReleases(): Promise<Release[]> {
  const releases = await fetchReleases()
  return [...releases].sort((a, b) =>
    (b.published_at ?? "").localeCompare(a.published_at ?? ""),
  )
}

export type { Release }
