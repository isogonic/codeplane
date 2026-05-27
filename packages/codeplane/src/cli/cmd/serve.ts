import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { upgrade } from "../upgrade"
import { evaluatePassword } from "../../server/auth-policy"

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
    const verdict = evaluatePassword({
      password: Flag.CODEPLANE_SERVER_PASSWORD,
      username: Flag.CODEPLANE_SERVER_USERNAME,
      isLocalBind: isLocal,
    })
    if (verdict.kind === "refuse") {
      console.error(verdict.message)
      process.exit(1)
    }
    if (verdict.kind === "warn") {
      console.warn("Warning:", verdict.message)
    }
    const server = await Server.listen(opts)
    console.log(`codeplane server listening on http://${server.hostname}:${server.port}`)

    // Fire the auto-upgrade check in the background. Until v27.4.43 this
    // only ran from the TUI worker, so users running `serve` (headless)
    // never auto-bumped — that's how the user got pinned to 27.4.22 for
    // 13 patch releases. Now `serve` runs the same scheduler. Patches
    // auto-install (per the autoupdate config); minor/major releases
    // publish a bus event that the in-app UI surfaces. Errors are
    // swallowed to keep server startup robust.
    void upgrade().catch(() => undefined)

    await new Promise(() => {})
    await server.stop()
  },
})
