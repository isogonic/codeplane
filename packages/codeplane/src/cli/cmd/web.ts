import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { upgrade } from "../upgrade"
import { evaluatePassword } from "../../server/auth-policy"
import open from "open"
import { networkInterfaces } from "os"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // Skip Docker bridge networks (typically 172.x.x.x)
      if (netInfo.address.startsWith("172.")) continue

      results.push(netInfo.address)
    }
  }

  return results
}

export const WebCommand = cmd({
  command: "web",
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
  describe: "start codeplane server and open web interface",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const isLocal = opts.hostname === "127.0.0.1" || opts.hostname === "localhost" || opts.hostname === "::1"
    const verdict = evaluatePassword({
      password: Flag.CODEPLANE_SERVER_PASSWORD,
      username: Flag.CODEPLANE_SERVER_USERNAME,
      isLocalBind: isLocal,
    })
    if (verdict.kind === "refuse") {
      UI.println(UI.Style.TEXT_DANGER_BOLD + verdict.message)
      process.exit(1)
    }
    if (verdict.kind === "warn") {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + verdict.message)
    }
    const server = await Server.listen(opts)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl.toString()).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    // Same auto-upgrade scheduler the TUI worker runs (see cli/upgrade.ts).
    // The in-app web UI subscribes to the `installation.update-available`
    // bus event, so a minor/major release will surface in the browser
    // window the user just opened. Patches auto-install per the
    // autoupdate config. Errors swallowed to keep server startup robust.
    void upgrade().catch(() => undefined)

    await new Promise(() => {})
    await server.stop()
  },
})
