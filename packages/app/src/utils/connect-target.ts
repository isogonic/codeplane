// Smart parsing for the "enter local / IP / domain" connect field.
//
// Goal: a single input where a user can type any of
//   local            → http://127.0.0.1:4096   (the default local server)
//   localhost:4096   → http://localhost:4096
//   192.168.1.5      → http://192.168.1.5
//   192.168.1.5:4096 → http://192.168.1.5:4096
//   box.example.com  → https://box.example.com (public domain ⇒ https)
//   http://x / https://x → used verbatim
// …and press Sign In. We pick a sensible protocol and default port so the
// common cases need zero ceremony.

const DEFAULT_LOCAL_PORT = 4096

// Words that mean "the local server on this machine".
const LOCAL_ALIASES = new Set(["local", "localhost", "127.0.0.1", "::1", "loopback", "this"])

function isLoopbackHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

function isIpv4(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

// Private / link-local IPv4 ranges + .local mDNS names are LAN targets that
// almost always speak plain HTTP, so we don't force https on them.
function isPrivateHost(host: string) {
  if (isLoopbackHost(host)) return true
  if (host.endsWith(".local")) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  return false
}

export type ConnectTarget = {
  // Fully-qualified URL the SDK will hit.
  url: string
  // Friendly label for the connection (host[:port]).
  label: string
}

// Normalize whatever the user typed into a connectable URL, or undefined if it
// can't be made into something plausible.
export function parseConnectTarget(raw: string): ConnectTarget | undefined {
  const input = raw.trim()
  if (!input) return

  // Bare local aliases → the default local server.
  if (LOCAL_ALIASES.has(input.toLowerCase())) {
    return { url: `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`, label: `localhost:${DEFAULT_LOCAL_PORT}` }
  }

  const hasProtocol = /^https?:\/\//i.test(input)
  // Strip a protocol (if any) to inspect the host, then decide the scheme.
  const withoutProtocol = input.replace(/^https?:\/\//i, "")
  const hostAndPort = withoutProtocol.replace(/\/.*$/, "")
  const host = hostAndPort.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1")
  if (!host) return

  // Choose a protocol: respect an explicit one; otherwise http for
  // loopback/LAN/IP targets and https for public domains.
  const scheme = hasProtocol
    ? input.slice(0, input.indexOf("://")).toLowerCase()
    : isPrivateHost(host) || isIpv4(host)
      ? "http"
      : "https"

  // Loopback with no explicit port → default local port so "localhost" alone
  // works. Other hosts keep whatever port (or none) was typed.
  let authority = withoutProtocol.replace(/\/.*$/, "")
  if (isLoopbackHost(host) && !/:\d+$/.test(authority)) authority = `${authority}:${DEFAULT_LOCAL_PORT}`

  const path = withoutProtocol.includes("/") ? "/" + withoutProtocol.split("/").slice(1).join("/") : ""
  const url = `${scheme}://${authority}${path}`.replace(/\/+$/, "")
  if (!URL.canParse(url)) return
  return { url, label: authority }
}

// Whether the typed value looks complete enough to enable the Sign In button.
export function looksConnectable(raw: string): boolean {
  const target = parseConnectTarget(raw)
  if (!target) return false
  try {
    const url = new URL(target.url)
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1")
    // Accept loopback, anything with a dot (domain / IPv4), or an explicit port.
    return isLoopbackHost(host) || host.includes(".") || !!url.port
  } catch {
    return false
  }
}
