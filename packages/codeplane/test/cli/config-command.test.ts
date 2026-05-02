import { describe, expect, test } from "bun:test"
import {
  deleteConfigValueAtPath,
  getConfigValueAtPath,
  setConfigValueAtPath,
  splitConfigPath,
} from "../../src/cli/cmd/config"

describe("cli config helpers", () => {
  test("splits dotted and indexed config paths", () => {
    expect(splitConfigPath("npm.scopes[@scope].registry")).toEqual(["npm", "scopes", "@scope", "registry"])
    expect(splitConfigPath("plugin[0].enabled")).toEqual(["plugin", 0, "enabled"])
    expect(splitConfigPath("mcp.server\\.name.url")).toEqual(["mcp", "server.name", "url"])
  })

  test("reads nested config values", () => {
    const result = getConfigValueAtPath(
      {
        npm: {
          scopes: {
            "@scope": {
              registry: "https://registry.example.com",
            },
          },
        },
      },
      "npm.scopes[@scope].registry",
    )

    expect(result).toEqual({
      found: true,
      value: "https://registry.example.com",
    })
  })

  test("sets nested config values without mutating the original object", () => {
    const input = {
      npm: {
        registry: "https://registry.npmjs.org/",
      },
    }
    const next = setConfigValueAtPath(input, "npm.scopes[@scope].token", "secret")

    expect(next).toEqual({
      npm: {
        registry: "https://registry.npmjs.org/",
        scopes: {
          "@scope": {
            token: "secret",
          },
        },
      },
    })
    expect(input).toEqual({
      npm: {
        registry: "https://registry.npmjs.org/",
      },
    })
  })

  test("deletes nested config values", () => {
    expect(
      deleteConfigValueAtPath(
        {
          npm: {
            scopes: {
              "@scope": {
                token: "secret",
                registry: "https://registry.example.com",
              },
            },
          },
        },
        "npm.scopes[@scope].token",
      ),
    ).toEqual({
      npm: {
        scopes: {
          "@scope": {
            registry: "https://registry.example.com",
          },
        },
      },
    })
  })
})
