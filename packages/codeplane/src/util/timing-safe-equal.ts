// Constant-time string comparison. Used in auth code paths where a naive
// `a === b` would leak the secret byte-by-byte to an attacker measuring
// response latency.
//
// The implementation hashes both inputs (SHA-256) and compares the
// hashes with an XOR accumulator: any difference between any two bytes
// sets bits in the accumulator, and the runtime is independent of how
// many bytes match. Hashing first guarantees the byte-length passed to
// the XOR loop is constant regardless of input length, which avoids
// leaking the secret's length via timing of the loop itself.

const encoder = new TextEncoder()

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    // Bun and modern Node always ship WebCrypto. The fallback exists
    // only so we fail closed rather than throw if a host strips it.
    return false
  }
  const [hashA, hashB] = await Promise.all([
    subtle.digest("SHA-256", encoder.encode(a)),
    subtle.digest("SHA-256", encoder.encode(b)),
  ])
  const viewA = new Uint8Array(hashA)
  const viewB = new Uint8Array(hashB)
  if (viewA.length !== viewB.length) return false
  let diff = 0
  for (let i = 0; i < viewA.length; i++) {
    diff |= viewA[i] ^ viewB[i]
  }
  return diff === 0
}
