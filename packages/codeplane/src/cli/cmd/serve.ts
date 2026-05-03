import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("instance", {
        alias: "i",
        type: "string",
        describe:
          "use a per-instance Codeplane home folder (providers, models, MCP, plugins, agents, commands, skills, codeplane.jsonc all isolated). Consumed by the preflight before yargs sees it.",
      })
      .option("password", {
        type: "string",
        describe:
          "HTTP Basic Auth password to put in front of the server. Equivalent to setting CODEPLANE_SERVER_PASSWORD. Strongly recommended whenever --hostname is anything other than 127.0.0.1 / localhost.",
      })
      .option("username", {
        type: "string",
        describe: "HTTP Basic Auth username (only used when --password is set). Defaults to 'codeplane'.",
      }),
  describe: "starts a headless codeplane server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const isLocal = opts.hostname === "127.0.0.1" || opts.hostname === "localhost" || opts.hostname === "::1"
    if (!Flag.CODEPLANE_SERVER_PASSWORD) {
      if (!isLocal) {
        console.log(
          `Refusing to bind ${opts.hostname}:${opts.port} without a password. Each Codeplane instance is single-user — exposing it on a network without HTTP Basic Auth would let anyone reach your model providers, MCP servers, and plugins. Re-run with --password <secret> (or set CODEPLANE_SERVER_PASSWORD) to enable Basic Auth.`,
        )
        process.exit(1)
      }
      console.log("Warning: CODEPLANE_SERVER_PASSWORD is not set; server is unsecured (loopback-only).")
    }
    const server = await Server.listen(opts)
    console.log(`codeplane server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
