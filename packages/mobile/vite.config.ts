import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

/**
 * Build target for the Capacitor web bundle.
 *
 * Capacitor copies `dist/` into the native iOS/Android app at sync time,
 * so this Vite config is what produces the in-app picker UI. Heavy
 * Codeplane instance UIs are still loaded over the network (or from the
 * shared local-runtime cache) at runtime — same model as desktop.
 */
export default defineConfig({
  root: ".",
  base: "./",
  plugins: [solidPlugin(), tailwindcss()],
  resolve: {
    // Order matters: more-specific aliases must be listed before the
    // broader `@codeplane-ai/ui` catch-all, otherwise Vite resolves
    // `@codeplane-ai/ui/styles/tailwind` against the components folder
    // first and never gets to the styles override.
    alias: [
      // KaTeX opt-out. The shared UI's `styles/index.css` imports
      // `katex/dist/katex.min.css` for math rendering inside markdown
      // surfaces. The picker has no math anywhere, so bundling KaTeX
      // shipped 59 font files (~1.1 MB) and a heap of @font-face
      // declarations that WKWebView eagerly preloaded at first style
      // pass — measured on the iOS Simulator as ~11 s of blank screen
      // before the first layer-tree commit. Aliasing the stylesheet
      // to an empty stub cuts first-paint to near-instant.
      {
        find: "katex/dist/katex.min.css",
        replacement: path.resolve(__dirname, "src/styles/empty.css"),
      },
      {
        find: "@codeplane-ai/ui/styles/tailwind",
        replacement: path.resolve(__dirname, "../ui/src/styles/tailwind/index.css"),
      },
      {
        find: "@codeplane-ai/ui/i18n",
        replacement: path.resolve(__dirname, "../ui/src/i18n"),
      },
      {
        find: "@codeplane-ai/ui/theme",
        replacement: path.resolve(__dirname, "../ui/src/theme/index.ts"),
      },
      {
        find: /^@codeplane-ai\/ui\/(.*)$/,
        replacement: path.resolve(__dirname, "../ui/src/components") + "/$1",
      },
      {
        find: /^@codeplane-ai\/shared$/,
        replacement: path.resolve(__dirname, "../shared/src"),
      },
      {
        find: /^@codeplane-ai\/shared\/(.*)$/,
        replacement: path.resolve(__dirname, "../shared/src") + "/$1",
      },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
  },
})
