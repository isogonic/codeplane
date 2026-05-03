import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("instance", {
      alias: "i",
      type: "string",
      describe:
        "use a per-instance Codeplane home folder (providers, models, MCP, plugins, agents, commands, skills, codeplane.jsonc all isolated). The flag is consumed by the preflight before yargs sees it.",
    }),
  describe: "starts a headless codeplane server",
  handler: async (args) => {
    if (!Flag.CODEPLANE_SERVER_PASSWORD) {
      console.log("Warning: CODEPLANE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = await Server.listen(opts)
    console.log(`codeplane server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
