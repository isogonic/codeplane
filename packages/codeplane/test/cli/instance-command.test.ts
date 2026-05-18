import { describe, expect, test } from "bun:test"
import {
  applyLocalInstanceVersion,
  composeRemoteHeaders,
  filterDefaultInstanceSummaries,
  filterInstanceSummaries,
  filterTlsSkippedInstanceSummaries,
  formatInstanceCount,
  formatInstanceIDs,
  formatInstanceLabels,
  formatInstanceTable,
  formatInstanceURLs,
  formatLocalStatus,
  formatInstanceSummary,
  formatLocalVersions,
  formatLocalTarget,
  mergeSignedInHeader,
  normalizeLocalVersionMajor,
  parseInstanceHeaders,
  localInstanceVersions,
  validateInstanceID,
  validateLocalRuntimeVersion,
} from "../../src/cli/cmd/instance"

describe("cli instance helpers", () => {
  test("parses repeated header flags", () => {
    expect(parseInstanceHeaders(["authorization: Bearer test", "x-env: prod"])).toEqual({
      authorization: "Bearer test",
      "x-env": "prod",
    })
  })

  test("replaces repeated headers case-insensitively", () => {
    expect(parseInstanceHeaders(["Authorization: Bearer stale", "authorization: Bearer fresh"])).toEqual({
      authorization: "Bearer fresh",
    })
  })

  test("parses header values containing additional colons", () => {
    expect(parseInstanceHeaders(["Authorization: Bearer issuer:token:value"])).toEqual({
      Authorization: "Bearer issuer:token:value",
    })
  })

  test("rejects header flags with control characters", () => {
    expect(() => parseInstanceHeaders(["Authorization: Bearer ok\nX-Injected: yes"])).toThrow(/control characters/)
    expect(() => parseInstanceHeaders(["Bad\0Name: value"])).toThrow(/control characters/)
    expect(() => parseInstanceHeaders(["X-Test: bad\u007fvalue"])).toThrow(/control characters/)
    expect(() => parseInstanceHeaders(["X-Test: bad\tvalue"])).toThrow(/control characters/)
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

  test("rejects basic auth passwords without usernames", () => {
    expect(() => composeRemoteHeaders({ password: "secret" })).toThrow(/--password with --username/)
  })

  test("rejects empty explicit instance ids", () => {
    expect(validateInstanceID("remote-1")).toBe("remote-1")
    expect(validateInstanceID(" remote-1 ")).toBe("remote-1")
    expect(() => validateInstanceID("   ")).toThrow(/cannot be empty/)
  })

  test("rejects overlong explicit instance ids", () => {
    expect(() => validateInstanceID("a".repeat(81))).toThrow(/cannot exceed 80/)
  })

  test("rejects unsafe explicit instance ids", () => {
    expect(() => validateInstanceID(".")).toThrow(/cannot be . or ../)
    expect(() => validateInstanceID("..")).toThrow(/cannot be . or ../)
    expect(() => validateInstanceID("../local")).toThrow(/letters, numbers/)
    expect(() => validateInstanceID("local/one")).toThrow(/letters, numbers/)
    expect(() => validateInstanceID("local one")).toThrow(/letters, numbers/)
    expect(() => validateInstanceID("local\nInjected")).toThrow(/letters, numbers/)
  })

  test("validates explicit local runtime versions", () => {
    expect(validateLocalRuntimeVersion("v28.2.1")).toBe("28.2.1")
    expect(validateLocalRuntimeVersion(" 28.2.1-rc.0 ")).toBe("28.2.1-rc.0")
    expect(() => validateLocalRuntimeVersion("latest")).toThrow(/Invalid local runtime version/)
    expect(() => validateLocalRuntimeVersion("28.2")).toThrow(/Invalid local runtime version/)
    expect(() => validateLocalRuntimeVersion("28.2.1-..bad")).toThrow(/Invalid local runtime version/)
  })

  test("merges signed-in headers with strict validation", () => {
    expect(mergeSignedInHeader({ authorization: "Bearer stale", "X-Env": "prod" }, "Authorization: Bearer fresh")).toEqual({
      "X-Env": "prod",
      Authorization: "Bearer fresh",
    })
    expect(() => mergeSignedInHeader(undefined, "Bad Header: value")).toThrow(/Header name is not valid/)
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

  test("summarizes unique local instance versions", () => {
    expect(
      localInstanceVersions({
        instances: [
          { id: "local-a", url: "local://a", local: { binaryVersion: "28.2.0" } },
          { id: "remote", url: "https://example.com" },
          { id: "local-b", url: "local://b", local: { binaryVersion: "28.1.0" } },
          { id: "local-c", url: "local://c", local: { binaryVersion: "28.2.0" } },
          { id: "local-d", url: "local://d", local: { binaryVersion: "28.10.0" } },
        ],
      }),
    ).toEqual(["28.10.0", "28.2.0", "28.1.0"])
  })

  test("ignores malformed saved local instance versions", () => {
    expect(
      localInstanceVersions({
        instances: [
          { id: "local-a", url: "local://a", local: { binaryVersion: "28.2.0" } },
          { id: "local-b", url: "local://b", local: { binaryVersion: "broken" } },
        ],
      }),
    ).toEqual(["28.2.0"])
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

  test("formats instance table with remote diagnostics", () => {
    const table = formatInstanceTable([
      {
        id: "remote-1",
        default: false,
        type: "remote",
        label: "Remote",
        url: "https://example.com",
        version: undefined,
        headers: 2,
        ignoreCertificateErrors: true,
      },
    ])

    expect(table).toContain("Headers")
    expect(table).toContain("TLS")
    expect(table).toContain("2")
    expect(table).toContain("skip")
  })

  test("formats instance table with a saved instance count footer", () => {
    const table = formatInstanceTable([
      {
        id: "remote-1",
        default: false,
        type: "remote",
        label: undefined,
        url: "https://example.com",
        version: undefined,
        headers: 0,
        ignoreCertificateErrors: false,
      },
      {
        id: "local-1",
        default: true,
        type: "local",
        label: "Local",
        url: "http://127.0.0.1",
        version: "28.2.1",
        headers: 0,
        ignoreCertificateErrors: false,
      },
    ])

    expect(table).toEndWith("2 saved instances; 1 default; 0 skip TLS.")
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

  test("filters instance summaries to the default selection", () => {
    const summaries = [
      { id: "local-1", default: true },
      { id: "remote-1", default: false },
      { id: "remote-2" },
    ]

    expect(filterDefaultInstanceSummaries(summaries, true)).toEqual([{ id: "local-1", default: true }])
    expect(filterDefaultInstanceSummaries(summaries)).toBe(summaries)
  })

  test("filters instance summaries to skipped TLS entries", () => {
    const summaries = [
      { id: "remote-1", ignoreCertificateErrors: true },
      { id: "remote-2", ignoreCertificateErrors: false },
      { id: "local-1" },
    ]

    expect(filterTlsSkippedInstanceSummaries(summaries, true)).toEqual([
      { id: "remote-1", ignoreCertificateErrors: true },
    ])
    expect(filterTlsSkippedInstanceSummaries(summaries)).toBe(summaries)
  })

  test("formats instance ids for script output", () => {
    expect(formatInstanceIDs([{ id: "local-1" }, { id: "remote-1" }])).toBe("local-1\nremote-1")
    expect(formatInstanceIDs([])).toBe("")
  })

  test("formats instance URLs for script output", () => {
    expect(formatInstanceURLs([{ url: "local://one" }, { url: "https://example.com" }])).toBe(
      "local://one\nhttps://example.com",
    )
    expect(formatInstanceURLs([])).toBe("")
  })

  test("formats instance labels for script output", () => {
    expect(formatInstanceLabels([{ id: "local-1", label: "Local" }, { id: "remote-1" }])).toBe("Local\nremote-1")
    expect(formatInstanceLabels([])).toBe("")
  })

  test("formats instance counts for script output", () => {
    expect(formatInstanceCount([{ id: "local-1" }, { id: "remote-1" }])).toBe("2")
    expect(formatInstanceCount([])).toBe("0")
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

  test("formats local target package name from archive fallback", () => {
    expect(
      formatLocalTarget(
        {
          os: "linux",
          arch: "x64",
          archiveName: "codeplane-linux-x64.tar.gz",
          archiveExt: ".tar.gz",
          binaryName: "codeplane",
        },
        true,
      ),
    ).toBe("codeplane-linux-x64")
  })

  test("includes local target package name fallback in JSON output", () => {
    expect(
      JSON.parse(
        formatLocalTarget({
          os: "linux",
          arch: "x64",
          archiveName: "codeplane-linux-x64.tar.gz",
          archiveExt: ".tar.gz",
          binaryName: "codeplane",
        }),
      ).packageName,
    ).toBe("codeplane-linux-x64")
  })

  test("includes local target platform summary in JSON output", () => {
    expect(
      JSON.parse(
        formatLocalTarget({
          os: "linux",
          arch: "x64",
          packageName: "codeplane-linux-x64-baseline-musl",
          archiveName: "codeplane-linux-x64-baseline-musl.tgz",
          archiveExt: ".tgz",
          binaryName: "codeplane",
        }),
      ).platform,
    ).toBe("linux/x64/baseline/musl")
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

  test("rejects conflicting local target script flags", () => {
    expect(() =>
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
        true,
      ),
    ).toThrow(/not both/)
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

  test("trims local status path output for scripts", () => {
    expect(
      formatLocalStatus(
        {
          binaryVersion: "28.2.2",
          installed: true,
          binaryPath: "  /tmp/codeplane/bin/codeplane  ",
          archive: "/tmp/codeplane.tgz",
        },
        true,
      ),
    ).toBe("/tmp/codeplane/bin/codeplane")
  })

  test("trims local status binary path in JSON output", () => {
    expect(
      JSON.parse(
        formatLocalStatus({
          binaryVersion: "28.2.2",
          installed: true,
          binaryPath: "  /tmp/codeplane/bin/codeplane  ",
          archive: "/tmp/codeplane.tgz",
        }),
      ).binaryPath,
    ).toBe("/tmp/codeplane/bin/codeplane")
  })

  test("rejects missing local status paths for scripts", () => {
    expect(() =>
      formatLocalStatus(
        {
          binaryVersion: "28.2.2",
          installed: true,
          binaryPath: "",
          archive: "/tmp/codeplane.tgz",
        },
        true,
      ),
    ).toThrow(/binary path is unavailable/)
  })

  test("rejects local status path output when runtime is not installed", () => {
    expect(() =>
      formatLocalStatus(
        {
          binaryVersion: "28.2.2",
          installed: false,
          binaryPath: "/tmp/codeplane/bin/codeplane",
          archive: "/tmp/codeplane.tgz",
        },
        true,
      ),
    ).toThrow(/is not installed/)
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
      duplicateVersionCount: 0,
      invalidDistTagCount: 0,
      invalidVersionCount: 0,
      prereleaseVersionCount: 0,
      selectedVersionCount: 3,
      stableVersionCount: 3,
      total: 3,
      newestVersion: "28.2.1",
      newestStableVersion: "28.2.1",
      oldestVersion: "28.1.0",
      limit: 2,
      shown: 2,
      stableShown: 2,
      prereleaseShown: 0,
      stableOmitted: 1,
      prereleaseOmitted: 0,
      omitted: 1,
      versions: ["28.2.1", "28.2.0"],
    })
  })

  test("sorts local runtime versions with semver precedence", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.0", "28.10.0", "28.2.1-rc.1", "28.2.1"],
        }),
      ).versions,
    ).toEqual(["28.10.0", "28.2.1", "28.2.1-rc.1", "28.2.0"])
  })

  test("deduplicates local runtime versions before sorting", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.0", "28.2.1", "28.2.0", "28.2.1"],
        }),
      ).versions,
    ).toEqual(["28.2.1", "28.2.0"])
  })

  test("reports duplicate local runtime version counts", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.0", "28.2.1", "28.2.0", "28.2.1"],
        }),
      ).duplicateVersionCount,
    ).toBe(2)
  })

  test("ignores malformed local runtime versions before semver sorting", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.0", "broken", "28.2", "28.2.1-..bad", "28.2.1"],
        }),
      ).versions,
    ).toEqual(["28.2.1", "28.2.0"])
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

  test("formats latest local runtime version for scripts", () => {
    expect(
      formatLocalVersions(
        {
          latest: "28.2.1",
          distTags: { latest: "28.2.1" },
          versions: ["28.2.1"],
        },
        10,
        undefined,
        undefined,
        true,
      ),
    ).toBe("28.2.1")
  })

  test("reports missing latest local runtime version", () => {
    expect(() => formatLocalVersions({ distTags: {}, versions: [] }, 10, undefined, undefined, true)).toThrow(
      /latest version was not found/,
    )
    expect(() => formatLocalVersions({ latest: "broken", distTags: {}, versions: [] }, 10, undefined, undefined, true)).toThrow(
      /latest version was not found/,
    )
  })

  test("rejects conflicting local runtime version selectors", () => {
    expect(() =>
      formatLocalVersions({ latest: "28.2.1", distTags: { latest: "28.2.1" }, versions: ["28.2.1"] }, 10, "latest", undefined, true),
    ).toThrow(/without --tag or --major/)
    expect(() =>
      formatLocalVersions({ latest: "28.2.1", distTags: { latest: "28.2.1" }, versions: ["28.2.1"] }, 10, undefined, 28, true),
    ).toThrow(/without --tag or --major/)
  })

  test("formats local runtime versions for one major release line", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            latest: "28.2.1",
            distTags: { latest: "28.2.1", old: "27.9.9" },
            versions: ["29.0.0", "28.2.1", "28.1.0", "27.9.9"],
          },
          10,
          undefined,
          28,
        ),
      ),
    ).toEqual({
      latest: "28.2.1",
      distTags: { latest: "28.2.1", old: "27.9.9" },
      distTagCount: 2,
      duplicateVersionCount: 0,
      invalidDistTagCount: 0,
      invalidVersionCount: 0,
      prereleaseVersionCount: 0,
      selectedVersionCount: 2,
      stableVersionCount: 2,
      total: 2,
      newestVersion: "28.2.1",
      newestStableVersion: "28.2.1",
      oldestVersion: "28.1.0",
      major: 28,
      matchingDistTags: { latest: "28.2.1" },
      selectedDistTags: ["latest"],
      selectedDistTagCount: 1,
      limit: 10,
      shown: 2,
      stableShown: 2,
      prereleaseShown: 0,
      stableOmitted: 0,
      prereleaseOmitted: 0,
      omitted: 0,
      versions: ["28.2.1", "28.1.0"],
    })
  })

  test("rejects invalid local runtime major filters", () => {
    expect(normalizeLocalVersionMajor(28)).toBe(28)
    expect(normalizeLocalVersionMajor()).toBeUndefined()
    expect(() => normalizeLocalVersionMajor(-1)).toThrow(/Invalid major version/)
    expect(() => normalizeLocalVersionMajor(28.5)).toThrow(/Invalid major version/)
    expect(() => normalizeLocalVersionMajor(Number.MAX_SAFE_INTEGER + 1)).toThrow(/Invalid major version/)
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

  test("rejects unsafe local runtime dist tag names", () => {
    expect(() => formatLocalVersions({ distTags: {}, versions: [] }, 10, "../latest")).toThrow(/Invalid local runtime dist-tag/)
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
      duplicateVersionCount: 0,
      invalidDistTagCount: 0,
      invalidVersionCount: 1,
      prereleaseVersionCount: 0,
      selectedVersionCount: 0,
      stableVersionCount: 0,
      total: 0,
      limit: 10,
      shown: 0,
      stableShown: 0,
      prereleaseShown: 0,
      stableOmitted: 0,
      prereleaseOmitted: 0,
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

  test("omits malformed local runtime dist tags from formatted output", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: { latest: "28.2.0", "../bad": "28.2.1", old: "broken", rc: "28.2.1-..bad" },
          versions: [],
        }),
      ),
    ).toMatchObject({
      distTags: { latest: "28.2.0" },
      distTagCount: 1,
      invalidDistTagCount: 3,
    })
  })

  test("formats local runtime dist tag names for scripts", () => {
    expect(
      formatLocalVersions(
        {
          distTags: { zeta: "28.2.1", latest: "28.2.0", beta: "28.3.0-beta.1" },
          versions: [],
        },
        10,
        undefined,
        undefined,
        false,
        true,
      ),
    ).toBe("beta\nlatest\nzeta")
  })

  test("rejects conflicting local runtime dist tag name output flags", () => {
    expect(() =>
      formatLocalVersions({ distTags: { latest: "28.2.0" }, versions: [] }, 10, "latest", undefined, false, true),
    ).toThrow(/without --tag/)
  })

  test("rejects conflicting local runtime version-only output flags", () => {
    expect(() =>
      formatLocalVersions({ latest: "28.2.0", distTags: { latest: "28.2.0" }, versions: [] }, 10, undefined, undefined, true, false, false, false, true),
    ).toThrow(/without --tag, --latest-only, or --tag-only/)
    expect(() =>
      formatLocalVersions({ distTags: { latest: "28.2.0" }, versions: [] }, 10, "latest", undefined, false, false, false, false, true),
    ).toThrow(/without --tag, --latest-only, or --tag-only/)
    expect(() =>
      formatLocalVersions({ distTags: { latest: "28.2.0" }, versions: [] }, 10, undefined, undefined, false, true, false, false, true),
    ).toThrow(/without --tag, --latest-only, or --tag-only/)
  })

  test("reports ignored malformed local runtime versions", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.0", "broken", "28.2", 28],
        }),
      ).invalidVersionCount,
    ).toBe(3)
  })

  test("reports local runtime prerelease version counts", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.1", "28.3.0-beta.1", "28.3.0-rc.1"],
        }),
      ).prereleaseVersionCount,
    ).toBe(2)
  })

  test("reports local runtime stable version counts", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.2.1", "28.3.0-beta.1", "28.1.0"],
        }),
      ).stableVersionCount,
    ).toBe(2)
  })

  test("reports omitted local runtime stable and prerelease counts", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            distTags: {},
            versions: ["28.4.0-beta.1", "28.3.0", "28.2.0", "28.1.0-beta.1"],
          },
          2,
        ),
      ),
    ).toMatchObject({ stableOmitted: 1, prereleaseOmitted: 1, omitted: 2 })
  })

  test("formats only stable local runtime versions", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            distTags: {},
            versions: ["28.2.1", "28.3.0-beta.1", "28.1.0"],
          },
          10,
          undefined,
          undefined,
          false,
          false,
          true,
        ),
      ),
    ).toMatchObject({ stableOnly: true, versions: ["28.2.1", "28.1.0"] })
  })

  test("formats only prerelease local runtime versions", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            distTags: {},
            versions: ["28.2.1", "28.3.0-beta.1", "28.3.0-rc.1"],
          },
          10,
          undefined,
          undefined,
          false,
          false,
          false,
          true,
        ),
      ),
    ).toMatchObject({ prereleaseOnly: true, versions: ["28.3.0-rc.1", "28.3.0-beta.1"] })
  })

  test("formats selected local runtime versions for scripts", () => {
    expect(
      formatLocalVersions(
        {
          distTags: {},
          versions: ["28.2.1", "28.3.0-beta.1", "28.1.0"],
        },
        2,
        undefined,
        undefined,
        false,
        false,
        false,
        false,
        true,
      ),
    ).toBe("28.3.0-beta.1\n28.2.1")
  })

  test("formats selected local runtime versions as json lines", () => {
    expect(
      formatLocalVersions(
        {
          distTags: {},
          versions: ["28.2.1", "28.3.0-beta.1", "28.1.0"],
        },
        2,
        undefined,
        undefined,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
      ),
    ).toBe('{"version":"28.3.0-beta.1"}\n{"version":"28.2.1"}')
  })

  test("rejects conflicting local runtime json lines output flags", () => {
    expect(() =>
      formatLocalVersions({ distTags: { latest: "28.2.0" }, versions: [] }, 10, "latest", undefined, false, false, false, false, false, false, true),
    ).toThrow(/Use --json-lines/)
  })

  test("formats local runtime version counts for scripts", () => {
    expect(
      formatLocalVersions(
        {
          distTags: {},
          versions: ["28.2.1", "28.3.0-beta.1", "28.1.0"],
        },
        1,
        undefined,
        undefined,
        false,
        false,
        true,
        false,
        false,
        true,
      ),
    ).toBe("2")
  })

  test("rejects conflicting local runtime count-only output flags", () => {
    expect(() =>
      formatLocalVersions({ distTags: { latest: "28.2.0" }, versions: [] }, 10, undefined, undefined, true, false, false, false, false, true),
    ).toThrow(/without --tag, --latest-only, --tag-only, or --version-only/)
  })

  test("rejects conflicting stable and prerelease filters", () => {
    expect(() =>
      formatLocalVersions({ distTags: {}, versions: [] }, 10, undefined, undefined, false, false, true, true),
    ).toThrow(/--stable-only or --prerelease-only/)
  })

  test("reports the newest local runtime version", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.1.0", "28.3.0-beta.1", "28.2.1"],
        }),
      ).newestVersion,
    ).toBe("28.3.0-beta.1")
  })

  test("reports the newest local runtime prerelease version", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.1.0", "28.3.0-beta.1", "28.2.1"],
        }),
      ).newestPrereleaseVersion,
    ).toBe("28.3.0-beta.1")
  })

  test("reports selected local runtime dist-tag counts", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            distTags: { latest: "28.2.1", next: "29.0.0-beta.1", legacy: "27.9.0" },
            versions: ["28.2.1", "29.0.0-beta.1", "27.9.0"],
          },
          10,
          undefined,
          28,
        ),
      ).selectedDistTagCount,
    ).toBe(1)
  })

  test("reports selected local runtime dist-tag names", () => {
    expect(
      JSON.parse(
        formatLocalVersions(
          {
            distTags: { latest: "28.2.1", next: "29.0.0-beta.1", legacy: "27.9.0" },
            versions: ["28.2.1", "29.0.0-beta.1", "27.9.0"],
          },
          10,
          undefined,
          28,
        ),
      ).selectedDistTags,
    ).toEqual(["latest"])
  })

  test("reports the oldest local runtime version", () => {
    expect(
      JSON.parse(
        formatLocalVersions({
          distTags: {},
          versions: ["28.1.0", "28.3.0-beta.1", "28.2.1"],
        }),
      ).oldestVersion,
    ).toBe("28.1.0")
  })
})
