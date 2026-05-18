import type { MetadataRoute } from "next"

/*
 * Static robots.txt — emitted to /robots.txt at build time via the App
 * Router convention. Everything is indexable. Sitemap pointer lets
 * crawlers discover every doc route in one fetch.
 */
export const dynamic = "force-static"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://codeplane.cc/sitemap.xml",
    host: "https://codeplane.cc",
  }
}
