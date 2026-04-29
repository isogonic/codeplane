import { defineConfig } from "vite"
import webPlugin from "./vite"

export default defineConfig({
  plugins: webPlugin,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
