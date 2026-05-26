import { describe, expect, test } from "bun:test"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./server-errors"
import { formatServerError, parseReadableConfigInvalidError } from "./server-errors"

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => {
    const value = vars[key]
    if (value === undefined) return ""
    return String(value)
  })
}

function useLanguageMock() {
  const dict: Record<string, string> = {
    "error.chain.unknown": "Erro desconhecido",
    "error.chain.configInvalid": "Arquivo de config em {{path}} invalido",
    "error.chain.configInvalidWithMessage": "Arquivo de config em {{path}} invalido: {{message}}",
    "error.chain.modelNotFound": "Modelo nao encontrado: {{provider}}/{{model}}",
    "error.chain.didYouMean": "Voce quis dizer: {{suggestions}}",
    "error.chain.checkConfig": "Revise provider/model no config",
  }
  return {
    t(key: string, vars?: Record<string, string | number>) {
      const text = dict[key]
      if (!text) return key
      return fill(text, vars)
    },
  }
}

const language = useLanguageMock()

describe("parseReadableConfigInvalidError", () => {
  test("formats issues with file path", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "codeplane.config.ts",
        issues: [
          { path: ["settings", "host"], message: "Required" },
          { path: ["mode"], message: "Invalid" },
        ],
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe(
      ["Arquivo de config em codeplane.config.ts invalido: settings.host: Required", "mode: Invalid"].join("\n"),
    )
  })

  test("uses trimmed message when issues are missing", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "config",
        message: "  Bad value  ",
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe("Arquivo de config em config invalido: Bad value")
  })
})

describe("formatServerError", () => {
  test("formats config invalid errors", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const result = formatServerError(error, language.t)

    expect(result).toBe("Arquivo de config em config invalido: Missing host")
  })

  test("returns error messages", () => {
    expect(formatServerError(new Error("Request failed with status 503"), language.t)).toBe(
      "Request failed with status 503",
    )
  })

  test("returns provided string errors", () => {
    expect(formatServerError("Failed to connect to server", language.t)).toBe("Failed to connect to server")
  })

  test("unwraps SDK error envelopes", () => {
    const error = {
      error: {
        name: "ConfigInvalidError",
        data: {
          message: "Missing secret",
        },
      },
    }

    expect(formatServerError(error, language.t)).toBe("Arquivo de config em config invalido: Missing secret")
  })

  test("returns message-like object errors", () => {
    expect(formatServerError({ message: "Failed to open CLI" }, language.t)).toBe("Failed to open CLI")
  })

  test("uses translated unknown fallback", () => {
    expect(formatServerError(0, language.t)).toBe("Erro desconhecido")
  })

  test("falls back for unknown error objects and names", () => {
    expect(formatServerError({ name: "ServerTimeoutError", data: { seconds: 30 } }, language.t)).toBe(
      "Erro desconhecido",
    )
  })

  test("formats provider model errors using provider/model", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "openai",
        modelID: "gpt-4.1",
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error, language.t)).toBe(
      ["Modelo nao encontrado: openai/gpt-4.1", "Revise provider/model no config"].join("\n"),
    )
  })

  test("formats OAuth invalid_grant into a friendly message", () => {
    const error = {
      error: "invalid_grant",
      error_description: "refresh token already used",
    }
    expect(formatServerError(error, language.t)).toBe("Your session has expired. Please sign in again.")
  })

  test("formats OAuth access_denied", () => {
    const error = { error: "access_denied", error_description: "user revoked consent" }
    expect(formatServerError(error, language.t)).toBe("Access denied. Please sign in again to continue.")
  })

  test("formats OAuth errors wrapped in an SDK envelope", () => {
    const wrapped = { error: { error: "invalid_grant", error_description: "expired" } }
    expect(formatServerError(wrapped, language.t)).toBe("Your session has expired. Please sign in again.")
  })

  test("formats unknown OAuth codes with description", () => {
    const error = { error: "custom_oauth_error", error_description: "something broke" }
    expect(formatServerError(error, language.t)).toBe("Authentication error (custom_oauth_error): something broke")
  })

  test("formats provider model suggestions", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "x",
        modelID: "y",
        suggestions: ["x/y2", "x/y3"],
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error, language.t)).toBe(
      ["Modelo nao encontrado: x/y", "Voce quis dizer: x/y2, x/y3", "Revise provider/model no config"].join("\n"),
    )
  })
})
