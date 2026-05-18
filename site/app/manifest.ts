import type { MetadataRoute } from "next"

/*
 * Web app manifest — emitted to /manifest.webmanifest at build time. The
 * mobile shells use the same brand mark, so Add-to-Home-Screen from
 * mobile Safari / Chrome behaves like the native app icon.
 */
export const dynamic = "force-static"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Codeplane",
    short_name: "Codeplane",
    description: "Open-source coding agent for terminal, desktop, web, and mobile.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
