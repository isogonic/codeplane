import { describe, expect, test } from "bun:test"
import { BashArity } from "../../src/permission/arity"

describe("BashArity.prefix arity-1 commands", () => {
  for (const cmd of [
    "cat",
    "cd",
    "chmod",
    "chown",
    "cp",
    "echo",
    "env",
    "export",
    "grep",
    "kill",
    "killall",
    "ln",
    "ls",
    "mkdir",
    "mv",
    "ps",
    "pwd",
    "rm",
    "rmdir",
    "sleep",
    "source",
    "tail",
    "touch",
    "unset",
    "which",
  ]) {
    test(`${cmd} returns just [${cmd}]`, () => {
      expect(BashArity.prefix([cmd, "x", "y"])).toEqual([cmd])
    })
  }
})

describe("BashArity.prefix arity-2 commands", () => {
  // Use a non-overlapping subcommand so longer 3-arity entries do not match.
  for (const cmd of [
    "cargo",
    "go",
    "kubectl",
    "make",
    "mvn",
    "pip",
    "podman",
    "python",
    "rake",
    "sst",
    "swift",
    "terraform",
  ]) {
    test(`${cmd} returns 2 tokens with unknown subcommand`, () => {
      expect(BashArity.prefix([cmd, "build", "extra"])).toEqual([cmd, "build"])
    })
  }
})

describe("BashArity.prefix arity-3 commands", () => {
  for (const [a, b] of [
    ["aws", "s3"],
    ["az", "storage"],
    ["bun", "run"],
    ["bun", "x"],
    ["cargo", "add"],
    ["cargo", "run"],
    ["consul", "kv"],
    ["deno", "task"],
    ["docker", "compose"],
    ["docker", "container"],
    ["docker", "image"],
    ["docker", "network"],
    ["docker", "volume"],
    ["docker", "builder"],
    ["git", "config"],
    ["git", "remote"],
    ["git", "stash"],
    ["ip", "addr"],
    ["ip", "link"],
    ["ip", "route"],
    ["ip", "netns"],
    ["kubectl", "rollout"],
    ["kubectl", "kustomize"],
    ["mc", "admin"],
    ["npm", "exec"],
    ["npm", "init"],
    ["npm", "run"],
    ["npm", "view"],
    ["openssl", "req"],
    ["openssl", "x509"],
    ["pnpm", "dlx"],
    ["pnpm", "exec"],
    ["pnpm", "run"],
    ["podman", "container"],
    ["podman", "image"],
    ["pulumi", "stack"],
    ["terraform", "workspace"],
    ["vault", "auth"],
    ["vault", "kv"],
    ["yarn", "dlx"],
    ["yarn", "run"],
  ]) {
    test(`${a} ${b} returns 3 tokens`, () => {
      expect(BashArity.prefix([a, b, "x", "y"])).toEqual([a, b, "x"])
    })
  }
})

describe("BashArity.prefix edge cases", () => {
  test("longest prefix takes precedence", () => {
    expect(BashArity.prefix(["docker", "compose", "logs"])).toEqual(["docker", "compose", "logs"])
    expect(BashArity.prefix(["docker", "logs"])).toEqual(["docker", "logs"])
  })

  test("returns empty for empty input", () => {
    expect(BashArity.prefix([])).toEqual([])
  })

  test("single unknown token returns it", () => {
    expect(BashArity.prefix(["xyz"])).toEqual(["xyz"])
  })

  test("single known arity-1 token returns it", () => {
    expect(BashArity.prefix(["ls"])).toEqual(["ls"])
  })

  test("single known arity-2 prefix returns 1 if only 1 provided", () => {
    expect(BashArity.prefix(["git"])).toEqual(["git"])
  })

  test("known arity-3 with only 2 tokens", () => {
    expect(BashArity.prefix(["docker", "compose"])).toEqual(["docker", "compose"])
  })
})
