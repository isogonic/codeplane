import { describe, expect, test } from "bun:test"
import { describeGenericToolDisplay, humanizeToolIdentifier } from "../src/tool-display"

describe("humanizeToolIdentifier", () => {
  test("preserves known brand and acronym casing", () => {
    expect(humanizeToolIdentifier("unifi_get_system_info")).toBe("UniFi Get System Info")
    expect(humanizeToolIdentifier("github_pr_search")).toBe("GitHub Pr Search")
    expect(humanizeToolIdentifier("ssh_config")).toBe("SSH Config")
  })
})

describe("describeGenericToolDisplay", () => {
  test("formats MCP execute wrappers like native tools", () => {
    expect(
      describeGenericToolDisplay({
        tool: "unifi-network_unifi_execute",
        args: { tool: "unifi_get_system_info" },
        metadata: { mcp: true },
      }),
    ).toEqual({
      title: "Get System Info",
      subtitle: "UniFi Network",
      isMcp: true,
    })
  })

  test("keeps the MCP server in the subtitle and removes the raw tool arg row", () => {
    expect(
      describeGenericToolDisplay({
        tool: "unifi-network_unifi_execute",
        args: {
          tool: "unifi_list_devices",
          site: "Dream Machine Pro",
        },
        metadata: { mcp: true },
      }),
    ).toEqual({
      title: "List Devices",
      subtitle: "UniFi Network",
      isMcp: true,
    })
  })

  test("formats direct MCP tools without the execute wrapper", () => {
    expect(
      describeGenericToolDisplay({
        tool: "notion_search_pages",
        args: { query: "roadmap" },
        metadata: { mcp: true },
      }),
    ).toEqual({
      title: "Search Pages",
      subtitle: "Notion · roadmap",
      isMcp: true,
    })
  })

  test("uses known native names when provided", () => {
    expect(
      describeGenericToolDisplay({
        tool: "websearch",
        args: { query: "latency" },
        metadata: {},
        resolveKnownName: (tool) => (tool === "websearch" ? "Web Search" : undefined),
      }),
    ).toEqual({
      title: "Web Search",
      subtitle: "latency",
      isMcp: false,
    })
  })
})
