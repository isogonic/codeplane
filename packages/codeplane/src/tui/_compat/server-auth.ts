// TUI-local stub for ServerAuth — only `header` and `headers` are needed by the TUI.
// We don't pull in the full effect Schema because the TUI just needs to format
// HTTP basic-auth headers when talking to the local server.

export type Credentials = {
  password?: string
  username?: string
}

export namespace ServerAuth {
  export function header(credentials?: Credentials): string | undefined {
    if (!credentials?.password) return undefined
    const username = credentials.username ?? "codeplane"
    return "Basic " + Buffer.from(`${username}:${credentials.password}`).toString("base64")
  }

  export function headers(credentials?: Credentials): Record<string, string> {
    const value = header(credentials)
    return value ? { Authorization: value } : {}
  }
}
