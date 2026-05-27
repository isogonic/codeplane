// Pre-boot password-strength gate. Runs from each CLI command that exposes
// the server (serve, web) before we open a socket.
//
// Threat model: Codeplane is single-user and the authenticated client gets
// shell + filesystem + provider keys. A guessable password is a full
// compromise of the host. We can't enforce hard strength rules without
// breaking pre-existing deployments — instead we:
//
//   * Refuse a non-loopback bind without a password (caller's job).
//   * Refuse to start with a password shorter than MIN_PASSWORD_BYTES,
//     because anything below that is brute-forceable within an attacker's
//     coffee break even with rate limiting.
//   * Loudly warn for passwords below RECOMMENDED_PASSWORD_BYTES.
//   * Loudly warn if the password is on the well-known weak list (the
//     usual demo-mode footguns).
//   * Loudly warn if the default username "codeplane" is left in place
//     when exposed on the network — a custom username doubles the search
//     space and dodges any drive-by scanner keyed on the default.
//
// Returns "ok" if startup should proceed, "refuse" if the caller should
// exit non-zero, "warn" if startup should proceed with a stderr warning.

const MIN_PASSWORD_BYTES = 8
const RECOMMENDED_PASSWORD_BYTES = 16

// A short list of values we've seen in support tickets that "feel like" a
// password but trivially fall to a dictionary attack. The point isn't to
// be exhaustive (that's what high entropy is for) — it's to catch the
// most embarrassing footguns.
const KNOWN_WEAK_PASSWORDS = new Set([
  "password",
  "Password",
  "admin",
  "Admin",
  "codeplane",
  "Codeplane",
  "codeplane123",
  "changeme",
  "secret",
  "test",
  "test123",
  "123456",
  "hunter2",
  "qwerty",
  "letmein",
])

export type Verdict =
  | { kind: "ok" }
  | { kind: "refuse"; message: string }
  | { kind: "warn"; message: string }

export function evaluatePassword(input: {
  password: string | undefined
  username: string | undefined
  isLocalBind: boolean
}): Verdict {
  if (!input.password) {
    if (!input.isLocalBind) {
      return {
        kind: "refuse",
        message:
          "CODEPLANE_SERVER_PASSWORD is not set and the server is binding to a non-loopback address. Refusing to start an unauthenticated server reachable from the network.",
      }
    }
    return {
      kind: "warn",
      message: "CODEPLANE_SERVER_PASSWORD is not set; server is unsecured (loopback-only).",
    }
  }

  const byteLength = new TextEncoder().encode(input.password).length

  if (byteLength < MIN_PASSWORD_BYTES) {
    return {
      kind: "refuse",
      message: `CODEPLANE_SERVER_PASSWORD must be at least ${MIN_PASSWORD_BYTES} bytes. The current value is too short to resist offline cracking even with rate limiting; pick a longer secret (a passphrase or randomly generated string).`,
    }
  }

  if (KNOWN_WEAK_PASSWORDS.has(input.password)) {
    return {
      kind: "refuse",
      message: `CODEPLANE_SERVER_PASSWORD is on the list of well-known weak passwords. Pick something unique.`,
    }
  }

  if (byteLength < RECOMMENDED_PASSWORD_BYTES) {
    return {
      kind: "warn",
      message: `CODEPLANE_SERVER_PASSWORD is only ${byteLength} bytes long; ${RECOMMENDED_PASSWORD_BYTES}+ is recommended. Anything granting shell access on this machine deserves a long random secret.`,
    }
  }

  if (!input.isLocalBind && (!input.username || input.username === "codeplane")) {
    return {
      kind: "warn",
      message:
        "CODEPLANE_SERVER_USERNAME is the default ('codeplane') while the server is exposed on the network. Picking a custom username with --username makes drive-by credential stuffing harder.",
    }
  }

  return { kind: "ok" }
}

export const config = {
  MIN_PASSWORD_BYTES,
  RECOMMENDED_PASSWORD_BYTES,
  KNOWN_WEAK_PASSWORDS,
} as const
