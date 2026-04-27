import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.CODEPLANE_CHANNEL ?? "dev"}`

await $`cd ../codeplane && bun script/build-node.ts`
