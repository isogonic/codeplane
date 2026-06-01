export type RemoteAuthStatus = {
  reachable: boolean
  required: boolean
  authenticated: boolean
  totpRequired: boolean
  passwordValid: boolean
}

export type RemoteAuthInput = {
  headers?: Record<string, string>
  otpToken?: string
  password?: string
  username?: string
}

export type RemoteAuthParts = {
  otpToken?: string
  password?: string
  username?: string
}

export type VerifyRemoteTotpResult =
  | { ok: true; token: string }
  | { ok: false; reason: "invalid-code" | "unauthorized" | "rate-limited" | "unreachable" | "disabled" }

export type RemoteAuthFetch = (input: string, init?: RequestInit) => Promise<Response>

export const OTP_HEADER = "x-codeplane-otp"

const UNREACHABLE: RemoteAuthStatus = {
  reachable: false,
  required: false,
  authenticated: false,
  totpRequired: false,
  passwordValid: false,
}

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function base64(bytes: Uint8Array) {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += base64Alphabet[a >> 2]
    out += base64Alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? "=" : base64Alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? "=" : base64Alphabet[c & 63]
  }
  return out
}

export function basicAuthValue(username: string | undefined, password: string) {
  return `Basic ${base64(new TextEncoder().encode(`${username?.trim() || "codeplane"}:${password}`))}`
}

export function splitRemoteAuthHeaders(headers: Record<string, string> | undefined): RemoteAuthParts {
  const authKey = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === "authorization")
  const otpKey = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === OTP_HEADER)
  const otpToken = otpKey ? headers?.[otpKey] : undefined
  if (!authKey) return { otpToken }

  const value = headers?.[authKey] ?? ""
  const match = /^\s*Basic\s+(.+)\s*$/i.exec(value)
  if (!match) return { otpToken }
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]!), (char) => char.charCodeAt(0)))
    const colon = decoded.indexOf(":")
    if (colon < 0) return { otpToken }
    return {
      otpToken,
      username: decoded.slice(0, colon),
      password: decoded.slice(colon + 1),
    }
  } catch {
    return { otpToken }
  }
}

export function composeRemoteAuthHeaders(input: RemoteAuthInput) {
  const existing = splitRemoteAuthHeaders(input.headers)
  const password = input.password ?? existing.password
  const otpToken = input.otpToken ?? existing.otpToken
  const headers: Record<string, string> = {}
  if (password) headers.Authorization = basicAuthValue(input.username ?? existing.username, password)
  if (otpToken) headers[OTP_HEADER] = otpToken
  return Object.keys(headers).length ? headers : undefined
}

function authHeaders(input: RemoteAuthInput) {
  return composeRemoteAuthHeaders(input) ?? {}
}

function passwordOnlyAuthHeaders(input: RemoteAuthInput) {
  const existing = splitRemoteAuthHeaders(input.headers)
  return (
    composeRemoteAuthHeaders({
      username: input.username ?? existing.username,
      password: input.password ?? existing.password,
    }) ?? {}
  )
}

function endpoint(url: string, path: string) {
  const base = url.replace(/\/+$/, "")
  return new URL(path.replace(/^\/+/, ""), `${base}/`).toString()
}

export async function checkRemoteAuth(
  input: { url: string } & RemoteAuthInput,
  fetcher: RemoteAuthFetch = globalThis.fetch,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<RemoteAuthStatus> {
  if (!URL.canParse(input.url)) return UNREACHABLE
  const controller = opts?.signal ? undefined : new AbortController()
  const timer = controller && opts?.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  try {
    const headers = passwordOnlyAuthHeaders(input)
    const res = await fetcher(endpoint(input.url, "/global/auth"), {
      headers: Object.keys(headers).length ? headers : undefined,
      method: "GET",
      redirect: "follow",
      signal: opts?.signal ?? controller?.signal,
    })
    if (res.status === 401)
      return { reachable: true, required: true, authenticated: false, totpRequired: false, passwordValid: false }
    if (!res.ok)
      return { reachable: true, required: false, authenticated: true, totpRequired: false, passwordValid: false }
    const data = (await res.json().catch(() => null)) as
      | { authenticated?: unknown; passwordValid?: unknown; required?: unknown; totpRequired?: unknown }
      | null
    if (!data || typeof data.required !== "boolean") {
      return { reachable: true, required: false, authenticated: true, totpRequired: false, passwordValid: false }
    }
    const totpRequired = data.totpRequired === true
    return {
      reachable: true,
      required: data.required,
      authenticated: data.authenticated === true,
      totpRequired,
      passwordValid: data.passwordValid === true || (!totpRequired && data.authenticated === true),
    }
  } catch {
    return UNREACHABLE
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function verifyRemoteTotp(
  input: { code: string; url: string } & RemoteAuthInput,
  fetcher: RemoteAuthFetch = globalThis.fetch,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<VerifyRemoteTotpResult> {
  if (!URL.canParse(input.url)) return { ok: false, reason: "unreachable" }
  const auth = splitRemoteAuthHeaders(input.headers)
  const password = input.password ?? auth.password
  if (!password) return { ok: false, reason: "unauthorized" }
  const controller = opts?.signal ? undefined : new AbortController()
  const timer = controller && opts?.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  try {
    const res = await fetcher(endpoint(input.url, "/global/auth/verify"), {
      body: JSON.stringify({ code: input.code.replace(/\s+/g, "") }),
      headers: {
        ...authHeaders({ username: input.username ?? auth.username, password }),
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "follow",
      signal: opts?.signal ?? controller?.signal,
    })
    if (res.status === 429) return { ok: false, reason: "rate-limited" }
    if (res.status === 400) return { ok: false, reason: "disabled" }
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { totp?: unknown } | null
      return { ok: false, reason: body?.totp === true ? "invalid-code" : "unauthorized" }
    }
    if (!res.ok) return { ok: false, reason: "unreachable" }
    const data = (await res.json().catch(() => null)) as { token?: unknown } | null
    if (!data || typeof data.token !== "string") return { ok: false, reason: "unreachable" }
    return { ok: true, token: data.token }
  } catch {
    return { ok: false, reason: "unreachable" }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
