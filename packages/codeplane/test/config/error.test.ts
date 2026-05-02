import { describe, expect, test } from "bun:test"
import { ConfigError } from "../../src/config/error"

describe("ConfigError.JsonError", () => {
  test("instances have name 'ConfigJsonError'", () => {
    const e = new ConfigError.JsonError({ path: "x.json" })
    expect(e.name).toBe("ConfigJsonError")
  })

  test("instances are Error instances", () => {
    expect(new ConfigError.JsonError({ path: "x" })).toBeInstanceOf(Error)
  })

  test("data exposes path", () => {
    const e = new ConfigError.JsonError({ path: "/abs/path" })
    expect(e.data.path).toBe("/abs/path")
  })

  test("optional message stored", () => {
    const e = new ConfigError.JsonError({ path: "x", message: "hi" })
    expect(e.data.message).toBe("hi")
  })

  test("toObject returns name+data", () => {
    const e = new ConfigError.JsonError({ path: "x", message: "m" })
    expect(e.toObject()).toEqual({ name: "ConfigJsonError", data: { path: "x", message: "m" } })
  })

  test("isInstance returns true for own instances", () => {
    const e = new ConfigError.JsonError({ path: "x" })
    expect(ConfigError.JsonError.isInstance(e)).toBe(true)
  })

  test("isInstance returns false for InvalidError", () => {
    const e = new ConfigError.InvalidError({ path: "x" })
    expect(ConfigError.JsonError.isInstance(e)).toBe(false)
  })
})

describe("ConfigError.InvalidError", () => {
  test("instances have name 'ConfigInvalidError'", () => {
    const e = new ConfigError.InvalidError({ path: "x.json" })
    expect(e.name).toBe("ConfigInvalidError")
  })

  test("data exposes path", () => {
    const e = new ConfigError.InvalidError({ path: "x" })
    expect(e.data.path).toBe("x")
  })

  test("issues stored", () => {
    const issues = [{ code: "invalid_type", path: ["foo"], message: "bad" }] as any
    const e = new ConfigError.InvalidError({ path: "x", issues })
    expect(e.data.issues).toEqual(issues)
  })

  test("toObject returns name+data", () => {
    const e = new ConfigError.InvalidError({ path: "p", message: "m" })
    expect(e.toObject().name).toBe("ConfigInvalidError")
    expect(e.toObject().data.path).toBe("p")
  })

  test("isInstance returns true for own instances", () => {
    const e = new ConfigError.InvalidError({ path: "x" })
    expect(ConfigError.InvalidError.isInstance(e)).toBe(true)
  })

  test("isInstance returns false for JsonError", () => {
    const e = new ConfigError.JsonError({ path: "x" })
    expect(ConfigError.InvalidError.isInstance(e)).toBe(false)
  })
})
