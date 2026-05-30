import { describe, test, expect } from "bun:test"
import { forgeRawUrlAllowed } from "../../src/tool/forge"

// Guards the forge `raw` SSRF / credential-exfiltration fix: the configured
// Git-host credential must only be sent to the configured forge endpoints,
// never to an attacker-named absolute URL.
describe("forgeRawUrlAllowed", () => {
  const github = {
    host: "github.com",
    apiBase: "https://api.github.com",
    baseUrl: "https://github.com",
  }

  test("allows the configured api host", () => {
    expect(forgeRawUrlAllowed(github, "https://api.github.com/repos/x/y/issues")).toBe(true)
  })

  test("allows the configured web host", () => {
    expect(forgeRawUrlAllowed(github, "https://github.com/x/y/raw/main/file")).toBe(true)
  })

  test("rejects an attacker host", () => {
    expect(forgeRawUrlAllowed(github, "https://attacker.example/steal")).toBe(false)
  })

  test("rejects the cloud metadata endpoint", () => {
    expect(forgeRawUrlAllowed(github, "http://169.254.169.254/latest/meta-data/")).toBe(false)
  })

  test("rejects a lookalike subdomain of the configured host", () => {
    expect(forgeRawUrlAllowed(github, "https://api.github.com.attacker.example/x")).toBe(false)
  })

  test("rejects a non-URL path", () => {
    expect(forgeRawUrlAllowed(github, "not a url")).toBe(false)
  })

  test("matches a self-hosted enterprise instance host", () => {
    const ghe = {
      host: "git.acme.internal",
      apiBase: "https://git.acme.internal/api/v3",
      baseUrl: "https://git.acme.internal",
    }
    expect(forgeRawUrlAllowed(ghe, "https://git.acme.internal/api/v3/user")).toBe(true)
    expect(forgeRawUrlAllowed(ghe, "https://github.com/x")).toBe(false)
  })
})
