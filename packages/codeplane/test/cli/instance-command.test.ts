import { describe, expect, test } from "bun:test"
import {
  applyLocalInstanceVersion,
  composeRemoteHeaders,
  filterInstanceSummaries,
  formatLocalStatus,
  formatInstanceSummary,
  formatLocalVersions,
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

  test("rejects header flags with empty values", () => {
    expect(() => parseInstanceHeaders(["X-Empty:"])).toThrow(/cannot be empty/)
  })

  test("rejects header flags with invalid names", () => {
    expect(() => parseInstanceHeaders(["Bad Name: value"])).toThrow(/Header name is not valid/)
    expect(() => parseInstanceHeaders(["Bad@Name: value"])).toThrow(/Header name is not valid/)
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

  test("leaves state unchanged when no local instances exist", () => {
    expect(
      applyLocalInstanceVersion(
        {
          lastInstanceID: "remote-1",
          instances: [
            {
              id: "remote-1",
              url: "https://example.com",
            },
          ],
        },
        "28.1.25",
      ),
    ).toEqual({
      lastInstanceID: "remote-1",
      instances: [
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

  test("ignores empty persisted headers in instance summaries", () => {
    expect(
      formatInstanceSummary({
        id: "remote-1",
        url: "https://example.com",
        headers: {
          Authorization: "   ",
          "X-Env": "prod",
        },
      }).headers,
    ).toBe(1)
  })

  test("filters instance summaries by type", () => {
    const summaries = [
      { id: "local-1", type: "local" as const },
      { id: "remote-1", type: "remote" as const },
    ]

    expect(filterInstanceSummaries(summaries, "local")).toEqual([{ id: "local-1", type: "local" }])
    expect(filterInstanceSummaries(summaries, "remote")).toEqual([{ id: "remote-1", type: "remote" }])
    expect(filterInstanceSummaries(summaries)).toBe(summaries)
  })

  test("rejects invalid instance summary filters", () => {
    expect(() => filterInstanceSummaries([], "worker")).toThrow(/Invalid instance type/)
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

  test("formats local target as binary name for scripts", () => {
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
        false,
        true,
      ),
    ).toBe("codeplane")
  })

  test("formats local status as a path for scripts", () => {
    expect(
      formatLocalStatus(
        {
          binaryVersion: "28.2.2",
          installed: true,
          binaryPath: "/tmp/codeplane/bin/codeplane",
          archive: "/tmp/codeplane.tgz",
        },
        true,
      ),
    ).toBe("/tmp/codeplane/bin/codeplane")
  })

  test("rejects missing local status paths for scripts", () => {
    expect(() =>
      formatLocalStatus(
        {
          binaryVersion: "28.2.2",
          installed: false,
          binaryPath: "",
          archive: "/tmp/codeplane.tgz",
        },
        true,
      ),
    ).toThrow(/binary path is unavailable/)
  })

  test("formats local runtime versions with a limit", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            latest: "28.2.1",
            distTags: { latest: "28.2.1", next: "28.3.0-beta.1" },
            versions: ["28.2.1", "28.2.0", "28.1.0"],
          },
          2,
        ),
      ),
    ).toEqual({
      latest: "28.2.1",
      distTags: { latest: "28.2.1", next: "28.3.0-beta.1" },
      distTagCount: 2,
      total: 3,
      shown: 2,
      omitted: 1,
      versions: ["28.2.1", "28.2.0"],
    })
  })

  test("formats one local runtime dist tag for scripts", () => {
    expect(
      formatLocalVersions(
        {
          latest: "28.2.1",
          distTags: { latest: "28.2.1", next: "28.3.0-beta.1" },
          versions: ["28.2.1"],
        },
        10,
        "next",
      ),
    ).toBe("28.3.0-beta.1")
  })

  test("rejects missing local runtime dist tags", () => {
    expect(() =>
      formatLocalVersions(
        {
          distTags: { latest: "28.2.1" },
          versions: ["28.2.1"],
        },
        10,
        "next",
      ),
    ).toThrow(/dist-tag "next" was not found/)
  })

  test("caps local runtime version output", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            distTags: {},
            versions: Array.from({ length: 150 }, (_, index) => `28.2.${index}`),
          },
          150,
        ),
    ).versions,
  ).toHaveLength(100)
  })

  test("formats malformed local runtime versions as empty", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: "28.2.1",
        }),
      ),
    ).toEqual({
      distTags: {},
      distTagCount: 0,
      total: 0,
      shown: 0,
      omitted: 0,
      versions: [],
    })
  })

  test("sorts local runtime dist tags for stable output", () => {
    expect(
      Object.keys(
        JSON.parse(
          formatLocalVersions({
            distTags: { zeta: "28.2.1", latest: "28.2.0", beta: "28.3.0-beta.1" },
            versions: [],
          }),
        ).distTags,
      ),
    ).toEqual(["beta", "latest", "zeta"])
  })
})
