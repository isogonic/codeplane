import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"
import fs from "fs"

export default defineConfig({
  plugins: [
    solidPlugin(),
    providerIconsPlugin(),
    iconsSpritesheet([
      {
        withTypes: true,
        inputDir: "src/assets/icons/file-types",
        outputDir: "src/components/file-icons",
        formatter: "prettier",
      },
      {
        withTypes: true,
        inputDir: "src/assets/icons/provider",
        outputDir: "src/components/provider-icons",
        formatter: "prettier",
        iconNameTransformer: (iconName) => iconName,
      },
    ]),
  ],
  server: { port: 3001 },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
})

function providerIconsPlugin() {
  return {
    name: "provider-icons-plugin",
    configureServer() {
      void fetchProviderIcons()
    },
    buildStart() {
      void fetchProviderIcons()
    },
  }
}

async function fetchProviderIcons() {
  const url = process.env.CODEPLANE_MODELS_URL || "https://models.dev"
  const providers: string[] = await fetch(`${url}/api.json`)
    .then((res) => res.json())
    .then((json) => Object.keys(json))
  const concurrency = 8
  for (let i = 0; i < providers.length; i += concurrency) {
    await Promise.all(
      providers.slice(i, i + concurrency).map(async (provider) => {
        const res = await fetch(`${url}/logos/${provider}.svg`)
        if (!res.ok) return
        const svg = await res.text()
        if (!svg.includes("<svg")) return
        fs.writeFileSync(`./src/assets/icons/provider/${provider}.svg`, svg)
      }),
    )
  }
}
