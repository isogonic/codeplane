import { domain } from "./stage"

new sst.cloudflare.StaticSite("WebApp", {
  domain: "app." + domain,
  path: "packages/app",
  build: {
    command: "bun turbo build",
    output: "./dist",
  },
})
