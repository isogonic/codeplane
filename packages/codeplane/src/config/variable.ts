export * as ConfigVariable from "./variable"

import path from "path"
import os from "os"
import { Filesystem } from "@/util"
import { InvalidError } from "./error"
import { ConfigSecret } from "./secret"

type ParseSource =
  | {
      type: "path"
      path: string
    }
  | {
      type: "virtual"
      source: string
      dir: string
    }

type SubstituteInput = ParseSource & {
  text: string
  missing?: "error" | "empty"
}

function source(input: ParseSource) {
  return input.type === "path" ? input.path : input.source
}

function dir(input: ParseSource) {
  return input.type === "path" ? path.dirname(input.path) : input.dir
}

function replaceLiteral(text: string, token: string, value: string) {
  return text.split(token).join(value)
}

async function resolveFileToken(input: ParseSource, token: string, missing: "error" | "empty") {
  let filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
  if (filePath.startsWith("~/")) {
    filePath = path.join(os.homedir(), filePath.slice(2))
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(dir(input), filePath)
  return (
    await Filesystem.readText(resolvedPath).catch((error: NodeJS.ErrnoException) => {
      if (missing === "empty") return ""

      const errMsg = `bad file reference: "${token}"`
      if (error.code === "ENOENT") {
        throw new InvalidError(
          {
            path: source(input),
            message: errMsg + ` ${resolvedPath} does not exist`,
          },
          { cause: error },
        )
      }
      throw new InvalidError({ path: source(input), message: errMsg }, { cause: error })
    })
  ).trim()
}

async function resolveSecretToken(input: ParseSource, token: string, missing: "error" | "empty") {
  const name = token.replace(/^\{secret:/, "").replace(/\}$/, "")
  const resolvedPath = ConfigSecret.filepath(name)
  return (
    await Filesystem.readText(resolvedPath).catch((error: NodeJS.ErrnoException) => {
      if (missing === "empty") return ""

      const errMsg = `bad secret reference: "${token}"`
      if (error.code === "ENOENT") {
        throw new InvalidError(
          {
            path: source(input),
            message: errMsg + ` ${resolvedPath} does not exist`,
          },
          { cause: error },
        )
      }
      throw new InvalidError({ path: source(input), message: errMsg }, { cause: error })
    })
  ).trim()
}

export async function resolveString(input: ParseSource & { value: string; missing?: "error" | "empty" }) {
  const missing = input.missing ?? "error"
  let text = input.value.replace(/\{env:([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || ""
  })

  for (const token of Array.from(text.matchAll(/\{file:[^}]+\}/g)).map((match) => match[0])) {
    text = replaceLiteral(text, token, await resolveFileToken(input, token, missing))
  }

  for (const token of Array.from(text.matchAll(/\{secret:[^}]+\}/g)).map((match) => match[0])) {
    text = replaceLiteral(text, token, await resolveSecretToken(input, token, missing))
  }

  return text
}

export async function resolveUnknown(
  input: ParseSource & {
    value: unknown
    missing?: "error" | "empty"
  },
): Promise<unknown> {
  if (typeof input.value === "string") {
    return resolveString({ ...input, value: input.value })
  }
  if (Array.isArray(input.value)) {
    return Promise.all(input.value.map((item) => resolveUnknown({ ...input, value: item })))
  }
  if (!input.value || typeof input.value !== "object") return input.value
  return Object.fromEntries(
    await Promise.all(
      Object.entries(input.value).map(async ([key, value]) => [key, await resolveUnknown({ ...input, value })] as const),
    ),
  )
}

/** Apply {env:VAR}, {file:path}, and {secret:name} substitutions to config text. */
export async function substitute(input: SubstituteInput) {
  const missing = input.missing ?? "error"
  let text = input.text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || ""
  })

  const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
  if (!fileMatches.length) return text

  let out = ""
  let cursor = 0

  for (const match of fileMatches) {
    const token = match[0]
    const index = match.index!
    out += text.slice(cursor, index)

    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    const prefix = text.slice(lineStart, index).trimStart()
    if (prefix.startsWith("//")) {
      out += token
      cursor = index + token.length
      continue
    }

    const fileContent = await resolveFileToken(input, token, missing)

    out += JSON.stringify(fileContent).slice(1, -1)
    cursor = index + token.length
  }

  out += text.slice(cursor)
  text = out

  for (const token of Array.from(text.matchAll(/\{secret:[^}]+\}/g)).map((match) => match[0])) {
    text = replaceLiteral(text, token, await resolveSecretToken(input, token, missing))
  }

  return text
}
