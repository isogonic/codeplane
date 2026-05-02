import { describe, expect, test } from "bun:test"
import {
  gofmt,
  mix,
  prettier,
  oxfmt,
  biome,
  zig,
  clang,
  ktlint,
  ruff,
  rlang,
  uvformat,
  rubocop,
  standardrb,
  htmlbeautifier,
  dart,
  ocamlformat,
  terraform,
  latexindent,
  gleam,
  shfmt,
  nixfmt,
  rustfmt,
  pint,
  ormolu,
  cljfmt,
  dfmt,
} from "../../src/format/formatter"

const all = {
  gofmt,
  mix,
  prettier,
  oxfmt,
  biome,
  zig,
  clang,
  ktlint,
  ruff,
  rlang,
  uvformat,
  rubocop,
  standardrb,
  htmlbeautifier,
  dart,
  ocamlformat,
  terraform,
  latexindent,
  gleam,
  shfmt,
  nixfmt,
  rustfmt,
  pint,
  ormolu,
  cljfmt,
  dfmt,
}

describe("formatter metadata", () => {
  for (const [name, formatter] of Object.entries(all)) {
    test(`${name} has a name`, () => {
      expect(typeof formatter.name).toBe("string")
      expect(formatter.name.length).toBeGreaterThan(0)
    })

    test(`${name} has a non-empty extensions array`, () => {
      expect(Array.isArray(formatter.extensions)).toBe(true)
      expect(formatter.extensions.length).toBeGreaterThan(0)
    })

    test(`${name} has an enabled function`, () => {
      expect(typeof formatter.enabled).toBe("function")
    })

    test(`${name} extensions all start with .`, () => {
      for (const ext of formatter.extensions) {
        expect(ext.startsWith(".")).toBe(true)
      }
    })
  }
})

describe("formatter extension specifics", () => {
  test("gofmt covers .go", () => {
    expect(gofmt.extensions).toContain(".go")
  })

  test("prettier covers ts/tsx/js/jsx", () => {
    expect(prettier.extensions).toContain(".ts")
    expect(prettier.extensions).toContain(".tsx")
    expect(prettier.extensions).toContain(".js")
    expect(prettier.extensions).toContain(".jsx")
  })

  test("biome covers ts/tsx/css", () => {
    expect(biome.extensions).toContain(".ts")
    expect(biome.extensions).toContain(".tsx")
    expect(biome.extensions).toContain(".css")
  })

  test("ruff covers .py and .pyi", () => {
    expect(ruff.extensions).toContain(".py")
    expect(ruff.extensions).toContain(".pyi")
  })

  test("rubocop and standardrb both cover .rb", () => {
    expect(rubocop.extensions).toContain(".rb")
    expect(standardrb.extensions).toContain(".rb")
  })

  test("zig covers .zig and .zon", () => {
    expect(zig.extensions).toContain(".zig")
    expect(zig.extensions).toContain(".zon")
  })

  test("clang covers C/C++ family", () => {
    expect(clang.extensions).toContain(".c")
    expect(clang.extensions).toContain(".cpp")
    expect(clang.extensions).toContain(".h")
    expect(clang.extensions).toContain(".hpp")
  })

  test("rustfmt covers .rs", () => {
    expect(rustfmt.extensions).toEqual([".rs"])
  })

  test("nixfmt covers .nix", () => {
    expect(nixfmt.extensions).toEqual([".nix"])
  })

  test("dart covers .dart", () => {
    expect(dart.extensions).toEqual([".dart"])
  })

  test("terraform covers .tf and .tfvars", () => {
    expect(terraform.extensions).toContain(".tf")
    expect(terraform.extensions).toContain(".tfvars")
  })

  test("shfmt covers shells", () => {
    expect(shfmt.extensions).toContain(".sh")
    expect(shfmt.extensions).toContain(".bash")
  })

  test("ormolu covers .hs", () => {
    expect(ormolu.extensions).toEqual([".hs"])
  })

  test("dfmt covers .d", () => {
    expect(dfmt.extensions).toEqual([".d"])
  })

  test("gleam covers .gleam", () => {
    expect(gleam.extensions).toEqual([".gleam"])
  })

  test("latexindent covers .tex", () => {
    expect(latexindent.extensions).toEqual([".tex"])
  })

  test("htmlbeautifier covers ERB", () => {
    expect(htmlbeautifier.extensions).toContain(".erb")
  })

  test("ktlint covers Kotlin", () => {
    expect(ktlint.extensions).toContain(".kt")
    expect(ktlint.extensions).toContain(".kts")
  })

  test("mix covers Elixir family", () => {
    expect(mix.extensions).toContain(".ex")
    expect(mix.extensions).toContain(".exs")
  })

  test("ocamlformat covers ML", () => {
    expect(ocamlformat.extensions).toContain(".ml")
    expect(ocamlformat.extensions).toContain(".mli")
  })

  test("rlang named 'air'", () => {
    expect(rlang.name).toBe("air")
  })

  test("uvformat named 'uv'", () => {
    expect(uvformat.name).toBe("uv")
  })

  test("oxfmt named oxfmt", () => {
    expect(oxfmt.name).toBe("oxfmt")
  })

  test("oxfmt has BUN_BE_BUN environment", () => {
    expect(oxfmt.environment).toBeDefined()
    expect(oxfmt.environment?.BUN_BE_BUN).toBe("1")
  })

  test("biome has BUN_BE_BUN environment", () => {
    expect(biome.environment?.BUN_BE_BUN).toBe("1")
  })

  test("prettier has BUN_BE_BUN environment", () => {
    expect(prettier.environment?.BUN_BE_BUN).toBe("1")
  })

  test("cljfmt covers clojure family", () => {
    expect(cljfmt.extensions).toContain(".clj")
    expect(cljfmt.extensions).toContain(".cljs")
    expect(cljfmt.extensions).toContain(".cljc")
    expect(cljfmt.extensions).toContain(".edn")
  })
})

describe("formatter enabled returns expected shapes", () => {
  test("gofmt returns array or false", async () => {
    const result = await gofmt.enabled({} as any)
    if (result !== false) {
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    }
  })

  test("rustfmt returns array or false", async () => {
    const result = await rustfmt.enabled({} as any)
    if (result !== false) {
      expect(Array.isArray(result)).toBe(true)
    }
  })
})
