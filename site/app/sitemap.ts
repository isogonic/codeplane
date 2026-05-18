import type { MetadataRoute } from "next"

/*
 * Static sitemap — emitted to /sitemap.xml at build time via the App
 * Router's MetadataRoute.Sitemap convention. Every public route gets one
 * entry. `priority` is a hint, not a guarantee — landing page is 1.0,
 * docs hub + install are 0.9, surface + reference pages 0.7, the rest 0.5.
 */
export const dynamic = "force-static"
const HOST = "https://codeplane.cc"

type Entry = { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }

const ROUTES: Entry[] = [
  { path: "/",                     priority: 1.0, changeFrequency: "weekly" },
  { path: "/docs/",                priority: 0.9, changeFrequency: "weekly" },
  { path: "/docs/install/",        priority: 0.9, changeFrequency: "weekly" },
  { path: "/docs/quickstart/",     priority: 0.8, changeFrequency: "monthly" },
  { path: "/docs/configuration/",  priority: 0.8, changeFrequency: "monthly" },
  { path: "/docs/cli/",            priority: 0.8, changeFrequency: "monthly" },
  { path: "/docs/tui/",            priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/desktop/",        priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/web/",            priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/mobile/",         priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/instances/",      priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/sessions/",       priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/permissions/",    priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/keybinds/",       priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/themes/",         priority: 0.5, changeFrequency: "monthly" },
  { path: "/docs/api/",            priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/mcp/",            priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/plugins/",        priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/sdk/",            priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/self-hosting/",   priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/changelog/",      priority: 0.6, changeFrequency: "weekly" },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${HOST}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }))
}
