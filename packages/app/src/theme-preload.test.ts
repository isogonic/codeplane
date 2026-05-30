import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount", () => {
    localStorage.setItem("codeplane-theme-id", "oc-1")
    localStorage.setItem("codeplane-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("codeplane-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    // No stored color-scheme → default dark (system/auto was removed).
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(localStorage.getItem("codeplane-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("codeplane-theme-css-light")).toBeNull()
    expect(localStorage.getItem("codeplane-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("codeplane-theme-id", "nightowl")
    localStorage.setItem("codeplane-color-scheme", "light")
    localStorage.setItem("codeplane-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("legacy system scheme falls back to dark", () => {
    localStorage.setItem("codeplane-color-scheme", "system")

    run()

    expect(document.documentElement.dataset.colorScheme).toBe("dark")
  })
})
