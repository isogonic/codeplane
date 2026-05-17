import { describe, expect, test } from "bun:test"
import {
  applyLocalInstanceVersion,
  composeRemoteHeaders,
  formatInstanceSummary,
  formatLocalTarget,
  parseInstanceHeaders,
} from "../../src/cli/cmd/instance"

describe("cli instance helpers", () => {
  test("parses repeated header flags", () => {
    expect(parseInstanceHeaders(["authorization: Bearer test", "x-env: prod"])).toEqual({
      authorization: "Bearer test",
      "x-env": "prod",
    })
  })

  test("rejects header flags with control characters", () => {
    expect(() => parseInstanceHeaders(["Authorization: Bearer ok\nX-Injected: yes"])).toThrow(/control characters/)
    expect(() => parseInstanceHeaders(["Bad\0Name: value"])).toThrow(/control characters/)
  })

  test("basic auth fields override existing authorization headers", () => {
    expect(
      composeRemoteHeaders({
        header: ["Authorization: Bearer stale", "X-Env: prod"],
        username: "alice",
        password: "secret",
      }),
    ).toEqual({
      Authorization: "Basic YWxpY2U6c2VjcmV0",
      "X-Env": "prod",
    })
  })

  test("updates all saved local instance versions", () => {
    expect(
      applyLocalInstanceVersion(
        {
          lastInstanceID: "remote-1",
          instances: [
            {
              id: "local-1",
              url: "http://127.0.0.1",
              local: {
                binaryVersion: "27.3.1",
              },
            },
            {
              id: "remote-1",
              url: "https://example.com",
            },
          ],
        },
        "27.3.1",
      ),
    ).toEqual({
      lastInstanceID: "remote-1",
      instances: [
        {
          id: "local-1",
          url: "http://127.0.0.1",
          local: {
            binaryVersion: "27.3.1",
          },
        },
        {
          id: "remote-1",
          url: "https://example.com",
        },
      ],
    })
  })

  test("formats instance summaries for list output", () => {
    expect(
      formatInstanceSummary(
        {
          id: "local-1",
          label: "Local",
          url: "http://127.0.0.1",
          headers: {
            authorization: "Bearer test",
          },
          ignoreCertificateErrors: true,
          local: {
            binaryVersion: "27.3.1",
          },
        },
        "local-1",
      ),
    ).toEqual({
      id: "local-1",
      default: true,
      type: "local",
      label: "Local",
      url: "http://127.0.0.1",
      version: "27.3.1",
      headers: 1,
      ignoreCertificateErrors: true,
    })
  })

  test("formats local target as package name for scripts", () => {
    expect(
      formatLocalTarget(
        {
          os: "darwin",
          arch: "arm64",
          packageName: "codeplane-darwin-arm64",
          archiveName: "codeplane-darwin-arm64.tgz",
          archiveExt: ".tgz",
          binaryName: "codeplane",
        },
        true,
      ),
    ).toBe("codeplane-darwin-arm64")
  })
})
