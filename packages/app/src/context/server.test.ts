import { describe, expect, test } from "bun:test"
import { ServerConnection } from "./server"

describe("ServerConnection.storageScope", () => {
  test("uses local scope for base sidecar and enables legacy migration", () => {
    expect(
      ServerConnection.storageScope({
        type: "sidecar",
        variant: "base",
        http: { url: "http://127.0.0.1:4096", password: "secret" },
      }),
    ).toEqual({ key: "local", legacy: true })
  })

  test("uses normalized HTTP URL without credentials", () => {
    expect(
      ServerConnection.storageScope({
        type: "http",
        http: { url: "https://user:pass@example.com:4096///", username: "codeplane", password: "secret" },
      }),
    ).toEqual({ key: "https://example.com:4096", legacy: false })
  })

  test("allows loopback HTTP to migrate legacy local data", () => {
    expect(
      ServerConnection.storageScope({
        type: "http",
        http: { url: "http://localhost:4096/" },
      }),
    ).toEqual({ key: "http://localhost:4096", legacy: true })
  })

  test("isolates ssh and wsl server variants", () => {
    expect(
      ServerConnection.storageScope({
        type: "ssh",
        host: "prod",
        http: { url: "http://127.0.0.1:5000", password: "secret" },
      }),
    ).toEqual({ key: "ssh:prod" })

    expect(
      ServerConnection.storageScope({
        type: "sidecar",
        variant: "wsl",
        distro: "Ubuntu",
        http: { url: "http://127.0.0.1:4097" },
      }),
    ).toEqual({ key: "wsl:Ubuntu" })
  })
})
