import type { NextConfig } from "next"

/*
 * Static export config for GitHub Pages.
 *
 * `output: "export"` writes a fully-static HTML tree to `out/` at build
 * time (no Node server at runtime). `trailingSlash: true` matches the
 * directory-style URLs the existing site uses (`/docs/cli/` not
 * `/docs/cli`) so existing inbound links + the GitHub-Pages 404 fallback
 * keep working without redirects.
 *
 * Images are unoptimized because next/image's runtime optimizer needs a
 * Node server; on a static host it can't run.
 *
 * Disable the React-DevTools script in production builds so the deploy
 * is a single, cache-friendly artefact.
 */
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // GitHub Pages serves from the apex codeplane.cc (custom domain) so
  // no base path is needed. If you ever move to user-pages style
  // (https://isogonic.github.io/codeplane), set basePath here.
  // basePath: "",
}

export default config
