import { describe, expect, test } from "bun:test"
import { FileIgnore, PATTERNS } from "../../src/file/ignore"

describe("FileIgnore.match folder patterns", () => {
  test("ignores .git directory contents", () => {
    expect(FileIgnore.match(".git/config")).toBe(true)
  })

  test("ignores dist", () => {
    expect(FileIgnore.match("dist/index.js")).toBe(true)
  })

  test("ignores build", () => {
    expect(FileIgnore.match("build/output.js")).toBe(true)
  })

  test("ignores deeply nested ignored folders", () => {
    expect(FileIgnore.match("packages/foo/node_modules/bar.js")).toBe(true)
  })

  test("ignores .vscode folder", () => {
    expect(FileIgnore.match(".vscode/settings.json")).toBe(true)
  })

  test("ignores .idea folder", () => {
    expect(FileIgnore.match(".idea/workspace.xml")).toBe(true)
  })

  test("ignores __pycache__", () => {
    expect(FileIgnore.match("__pycache__/cached.pyc")).toBe(true)
  })

  test("ignores vendor folder", () => {
    expect(FileIgnore.match("vendor/bundle/foo.rb")).toBe(true)
  })

  test("ignores Windows-style paths", () => {
    expect(FileIgnore.match("node_modules\\foo\\bar.js")).toBe(true)
  })

  test("ignores .turbo", () => {
    expect(FileIgnore.match(".turbo/cache")).toBe(true)
  })

  test("ignores out folder", () => {
    expect(FileIgnore.match("out/index.html")).toBe(true)
  })

  test("ignores bower_components", () => {
    expect(FileIgnore.match("bower_components/jquery/jquery.js")).toBe(true)
  })

  test("ignores .pnpm-store", () => {
    expect(FileIgnore.match(".pnpm-store/v3/files/abc")).toBe(true)
  })

  test("ignores .next folder", () => {
    expect(FileIgnore.match(".next/cache.json")).toBe(true)
  })

  test("ignores target folder", () => {
    expect(FileIgnore.match("target/release/main.rs")).toBe(true)
  })

  test("ignores .svn", () => {
    expect(FileIgnore.match(".svn/entries")).toBe(true)
  })

  test("ignores .hg", () => {
    expect(FileIgnore.match(".hg/store.lock")).toBe(true)
  })

  test("ignores .gradle", () => {
    expect(FileIgnore.match(".gradle/cached")).toBe(true)
  })

  test("ignores .pytest_cache", () => {
    expect(FileIgnore.match(".pytest_cache/v/cache/lastfailed")).toBe(true)
  })

  test("ignores mypy_cache", () => {
    expect(FileIgnore.match("mypy_cache/something")).toBe(true)
  })

  test("ignores .history", () => {
    expect(FileIgnore.match(".history/file.ts")).toBe(true)
  })

  test("ignores .npm", () => {
    expect(FileIgnore.match(".npm/anonymous-cli-metrics.json")).toBe(true)
  })

  test("ignores .cache folder", () => {
    expect(FileIgnore.match(".cache/some-file.txt")).toBe(true)
  })

  test("ignores .sst folder", () => {
    expect(FileIgnore.match(".sst/output.json")).toBe(true)
  })

  test("ignores .output folder", () => {
    expect(FileIgnore.match(".output/something.txt")).toBe(true)
  })
})

describe("FileIgnore.match file patterns", () => {
  test("ignores .DS_Store", () => {
    expect(FileIgnore.match(".DS_Store")).toBe(true)
  })

  test("ignores nested .DS_Store", () => {
    expect(FileIgnore.match("src/.DS_Store")).toBe(true)
  })

  test("ignores .pyc files", () => {
    expect(FileIgnore.match("a/b/c.pyc")).toBe(true)
  })

  test("ignores .swp files", () => {
    expect(FileIgnore.match("file.swp")).toBe(true)
  })

  test("ignores .swo files", () => {
    expect(FileIgnore.match("file.swo")).toBe(true)
  })

  test("ignores .log files", () => {
    expect(FileIgnore.match("debug.log")).toBe(true)
    expect(FileIgnore.match("nested/access.log")).toBe(true)
  })

  test("ignores Thumbs.db", () => {
    expect(FileIgnore.match("subdir/Thumbs.db")).toBe(true)
  })

  test("ignores tmp folder", () => {
    expect(FileIgnore.match("tmp/file.txt")).toBe(true)
  })

  test("ignores temp folder", () => {
    expect(FileIgnore.match("temp/file.txt")).toBe(true)
  })

  test("ignores coverage folder", () => {
    expect(FileIgnore.match("coverage/lcov.info")).toBe(true)
  })

  test("ignores .nyc_output folder", () => {
    expect(FileIgnore.match(".nyc_output/something")).toBe(true)
  })

  test("ignores logs/* (directory glob)", () => {
    expect(FileIgnore.match("logs/access")).toBe(true)
  })
})

describe("FileIgnore.match non-ignored", () => {
  test("does not ignore source files", () => {
    expect(FileIgnore.match("src/index.ts")).toBe(false)
  })

  test("does not ignore plain README", () => {
    expect(FileIgnore.match("README.md")).toBe(false)
  })

  test("does not ignore .gitignore", () => {
    expect(FileIgnore.match(".gitignore")).toBe(false)
  })

  test("does not ignore foo.txt", () => {
    expect(FileIgnore.match("foo.txt")).toBe(false)
  })

  test("does not ignore plain ts/js without folder match", () => {
    expect(FileIgnore.match("foo.ts")).toBe(false)
    expect(FileIgnore.match("foo.js")).toBe(false)
  })
})

describe("FileIgnore.match options", () => {
  test("respects extra patterns", () => {
    expect(FileIgnore.match("custom.special", { extra: ["**/*.special"] })).toBe(true)
    expect(FileIgnore.match("custom.special")).toBe(false)
  })

  test("whitelist overrides ignore", () => {
    expect(FileIgnore.match("dist/important.js", { whitelist: ["dist/important.js"] })).toBe(false)
  })

  test("whitelist with glob pattern", () => {
    expect(FileIgnore.match("dist/important.js", { whitelist: ["dist/**"] })).toBe(false)
  })

  test("multiple extra patterns", () => {
    expect(FileIgnore.match("a.aa", { extra: ["**/*.aa", "**/*.bb"] })).toBe(true)
    expect(FileIgnore.match("a.bb", { extra: ["**/*.aa", "**/*.bb"] })).toBe(true)
    expect(FileIgnore.match("a.cc", { extra: ["**/*.aa", "**/*.bb"] })).toBe(false)
  })
})

describe("PATTERNS", () => {
  test("PATTERNS is a non-empty array", () => {
    expect(Array.isArray(PATTERNS)).toBe(true)
    expect(PATTERNS.length).toBeGreaterThan(0)
  })

  test("PATTERNS includes both folder names and file patterns", () => {
    expect(PATTERNS).toContain("node_modules")
    expect(PATTERNS).toContain("**/*.log")
  })

  test("PATTERNS includes coverage and tmp", () => {
    expect(PATTERNS).toContain("**/coverage/**")
    expect(PATTERNS).toContain("**/tmp/**")
  })
})
