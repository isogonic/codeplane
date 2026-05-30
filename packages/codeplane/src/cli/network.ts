import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config"
import { AppRuntime } from "@/effect/app-runtime"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: codeplane.local)",
    default: "codeplane.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}
// Detect an explicitly-passed flag in BOTH `--flag value` and `--flag=value`
// forms. Plain process.argv.includes("--port") missed the equals syntax, so
// `--port=8080` was treated as "not set" and the config value overrode the CLI.
function flagSet(name: string) {
  return process.argv.some((a) => a === name || a.startsWith(name + "="))
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const portExplicitlySet = flagSet("--port")
  const hostnameExplicitlySet = flagSet("--hostname")
  const mdnsExplicitlySet = flagSet("--mdns")
  const mdnsDomainExplicitlySet = flagSet("--mdns-domain")
  const corsExplicitlySet = flagSet("--cors")
  if (portExplicitlySet && hostnameExplicitlySet && !mdnsExplicitlySet && !mdnsDomainExplicitlySet && !corsExplicitlySet) {
    return resolveNetworkOptionsNoConfig(args)
  }

  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  return resolveNetworkOptionsNoConfig(args, config)
}

export function resolveNetworkOptionsNoConfig(args: NetworkOptions, config?: Config.Info) {
  const portExplicitlySet = flagSet("--port")
  const hostnameExplicitlySet = flagSet("--hostname")
  const mdnsExplicitlySet = flagSet("--mdns")
  const mdnsDomainExplicitlySet = flagSet("--mdns-domain")
  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, mdnsDomain, cors }
}
