import type { MetadataRoute } from "next"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/*
 * Sitemap — emitted to /sitemap.xml at build time. The docs routes are
 * discovered by scanning app/docs/ at build, so adding a new doc page is
 * enough to put it in the sitemap; there is no list to keep in sync. The
 * landing page + docs hub are weekly/high priority; everything else gets
 * a sensible default.
 */
export const dynamic = "force-static"

const HOST = "https://codeplane.cc"

const PRIORITY: Record<string, number> = {
  "/": 1.0,
  "/docs/": 0.9,
  "/docs/install/": 0.9,
  "/docs/quickstart/": 0.8,
  "/docs/configuration/": 0.8,
  "/docs/providers/": 0.8,
  "/docs/cli/": 0.8,
  "/docs/api/": 0.7,
  "/docs/architecture/": 0.7,
}

const WEEKLY = new Set(["/", "/docs/", "/docs/install/", "/docs/release/", "/docs/changelog/"])
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.mdx"]

function docsRoutes(): string[] {
  const dir = join(process.cwd(), "app", "docs")
  const routes = new Set<string>(["/docs/"])
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const sub = join(dir, name)
      if (!statSync(sub).isDirectory()) continue
      if (PAGE_FILES.some((f) => existsSync(join(sub, f)))) routes.add(`/docs/${name}/`)
    }
  }
  return [...routes].sort()
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const paths = ["/", ...docsRoutes()]
  return paths.map((path) => ({
    url: `${HOST}${path}`,
    lastModified: now,
    changeFrequency: WEEKLY.has(path) ? "weekly" : "monthly",
    priority: PRIORITY[path] ?? (path.startsWith("/docs/") ? 0.6 : 0.5),
  }))
}
