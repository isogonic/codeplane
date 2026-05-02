import { describe, expect, test } from "bun:test"
import { AppFileSystem } from "../src/filesystem"

describe("AppFileSystem.mimeType", () => {
  const cases: Array<[string, RegExp]> = [
    ["file.txt", /^text\/plain/],
    ["a.html", /^text\/html/],
    ["a.css", /^text\/css/],
    ["a.js", /javascript/],
    ["a.mjs", /javascript/],
    ["a.json", /json/],
    ["a.png", /^image\/png/],
    ["a.jpg", /^image\/jpeg/],
    ["a.jpeg", /^image\/jpeg/],
    ["a.gif", /^image\/gif/],
    ["a.svg", /^image\/svg/],
    ["a.webp", /^image\/webp/],
    ["a.avif", /^image\/avif/],
    ["a.pdf", /^application\/pdf/],
    ["a.woff", /^font\/woff/],
    ["a.woff2", /^font\/woff2/],
    ["a.ttf", /^font\/ttf/],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [filename, expected] = cases[i]
    test(`mimeType ${i}: ${filename}`, () => {
      expect(AppFileSystem.mimeType(filename)).toMatch(expected)
    })
  }

  test("unknown extension falls back to application/octet-stream", () => {
    expect(AppFileSystem.mimeType("a.unknownext")).toBe("application/octet-stream")
  })

  test("file without extension falls back", () => {
    expect(AppFileSystem.mimeType("README")).toBe("application/octet-stream")
  })

  test("hidden file matches by extension if any", () => {
    expect(AppFileSystem.mimeType(".hidden.json")).toMatch(/json/)
  })

  test("absolute paths still match by extension", () => {
    expect(AppFileSystem.mimeType("/var/log/foo.txt")).toMatch(/^text\/plain/)
  })

  test("mixed-case extension handled", () => {
    // mime-types lowercases extensions.
    expect(AppFileSystem.mimeType("FOO.PNG")).toMatch(/^image\/png/)
  })
})

describe("AppFileSystem.windowsPath", () => {
  if (process.platform !== "win32") {
    test("non-Windows passes path through unchanged", () => {
      const inputs = [
        "/home/user/file.txt",
        "/var",
        "C:\\Users\\me",
        "relative/path",
        "",
        "/cygdrive/c/foo",
        "/mnt/c/foo",
        "/c/foo",
      ]
      for (const input of inputs) {
        expect(AppFileSystem.windowsPath(input)).toBe(input)
      }
    })

    test("non-Windows does not normalize cygdrive paths", () => {
      expect(AppFileSystem.windowsPath("/cygdrive/c/Users")).toBe("/cygdrive/c/Users")
    })

    test("non-Windows does not normalize mnt paths", () => {
      expect(AppFileSystem.windowsPath("/mnt/d/Code")).toBe("/mnt/d/Code")
    })
  }
})

describe("AppFileSystem.normalizePath", () => {
  if (process.platform !== "win32") {
    test("non-Windows passes path through unchanged", () => {
      expect(AppFileSystem.normalizePath("/home/user")).toBe("/home/user")
      expect(AppFileSystem.normalizePath("relative")).toBe("relative")
      expect(AppFileSystem.normalizePath("/")).toBe("/")
    })
  }
})

describe("AppFileSystem.normalizePathPattern", () => {
  if (process.platform !== "win32") {
    test("non-Windows passes pattern through unchanged", () => {
      expect(AppFileSystem.normalizePathPattern("**/*.ts")).toBe("**/*.ts")
      expect(AppFileSystem.normalizePathPattern("*")).toBe("*")
      expect(AppFileSystem.normalizePathPattern("src/*")).toBe("src/*")
    })
  }
})

describe("AppFileSystem.contains", () => {
  const cases: Array<[string, string, string, boolean]> = [
    ["parent contains direct child", "/a", "/a/b", true],
    ["parent contains nested", "/a", "/a/b/c/d", true],
    ["parent contains itself", "/a", "/a", true],
    ["sibling not contained", "/a", "/b", false],
    ["different drive root", "/a", "/", false],
    ["empty paths", "", "", true],
    ["dot relative same", ".", ".", true],
    ["dot relative deeper", ".", "./b", true],
    ["dot relative outside", "./a", "./b", false],
    ["nested doesn't contain shallower", "/a/b", "/a", false],
    ["partial match not contained", "/abc", "/abcd", false],
    ["partial match dir not contained", "/abc/def", "/abc", false],
    ["root contains everything", "/", "/anywhere/under/root", true],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [name, parent, child, expected] = cases[i]
    test(`contains ${i}: ${name}`, () => {
      expect(AppFileSystem.contains(parent, child)).toBe(expected)
    })
  }
})

describe("AppFileSystem.overlaps", () => {
  const cases: Array<[string, string, string, boolean]> = [
    ["identical paths overlap", "/a/b", "/a/b", true],
    ["parent and child overlap", "/a", "/a/b", true],
    ["child and parent overlap", "/a/b", "/a", true],
    ["siblings do not overlap", "/a", "/b", false],
    ["different roots do not overlap", "/x/y", "/p/q", false],
    ["empty same", "", "", true],
    ["nested deep overlap", "/a/b/c", "/a/b/c/d/e", true],
    ["partial prefix doesn't overlap", "/abc", "/abcd", false],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [name, a, b, expected] = cases[i]
    test(`overlaps ${i}: ${name}`, () => {
      expect(AppFileSystem.overlaps(a, b)).toBe(expected)
    })
  }
})

describe("AppFileSystem.resolve", () => {
  test("absolute path resolves to itself or canonical", () => {
    const cwd = process.cwd()
    expect(AppFileSystem.resolve(cwd)).toBeTruthy()
  })
  test("relative paths resolve against cwd", () => {
    const result = AppFileSystem.resolve("./relative-test-path-does-not-exist")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })
  test("non-existent path falls back to resolved path", () => {
    // resolve() catches ENOENT and returns the resolved (non-realpath) value.
    const result = AppFileSystem.resolve("/this/path/should/never/exist/xyzabc")
    expect(typeof result).toBe("string")
  })
})

describe("AppFileSystem - service / layer types are exported", () => {
  test("layer is exported", () => {
    expect(AppFileSystem.layer).toBeDefined()
  })
  test("defaultLayer is exported", () => {
    expect(AppFileSystem.defaultLayer).toBeDefined()
  })
  test("FileSystemError is exported", () => {
    expect(AppFileSystem.FileSystemError).toBeDefined()
  })
  test("Service is exported", () => {
    expect(AppFileSystem.Service).toBeDefined()
  })
})

describe("AppFileSystem.FileSystemError construction", () => {
  test("construct with method only", () => {
    const e = new AppFileSystem.FileSystemError({ method: "test" })
    expect(e.method).toBe("test")
    expect(e._tag).toBe("FileSystemError")
  })
  test("construct with method and cause", () => {
    const cause = new Error("underlying")
    const e = new AppFileSystem.FileSystemError({ method: "test", cause })
    expect(e.method).toBe("test")
    expect(e.cause).toBe(cause)
  })
})
