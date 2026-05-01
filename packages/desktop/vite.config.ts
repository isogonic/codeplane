import { defineConfig } from "vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

const root = path.dirname(fileURLToPath(import.meta.url))

// The setup screen ships as a real Solid + Tailwind app so it picks up the
// same theme tokens, fonts, and component styles as the web UI. The output
// is consumed by Electron via a `file://` URL — base "" keeps every asset
// path relative.
export default defineConfig({
  root: path.join(root, "src/setup"),
  base: "",
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: path.join(root, "dist/setup"),
    emptyOutDir: true,
    target: "esnext",
    assetsDir: ".",
    rollupOptions: {
      input: path.join(root, "src/setup/index.html"),
    },
  },
})
