// Global "session expired" signal.
//
// Every SDK client built by createSdkForServer routes its fetch through here.
// When an authenticated request comes back 401 (or the second-factor 401), we
// record which connection key it was for and notify subscribers. The AuthGate
// subscribes and re-presents the login screen for that connection — without a
// full page reload — so an expired session is handled gracefully mid-use.
//
// This is deliberately a tiny standalone module (not a Solid context) so the
// low-level `utils/server.ts` SDK factory can report into it without importing
// any reactive graph or creating a dependency cycle.

type Listener = (key: string) => void

const listeners = new Set<Listener>()

// Connection keys we've seen a 401 for since the last clear. AuthGate reads
// this on mount so an expiry that fires before it subscribes isn't lost.
const expired = new Set<string>()

export const AuthSession = {
  // Called by the SDK fetch wrapper when an authenticated request 401s.
  reportExpired(key: string | undefined) {
    if (!key) return
    expired.add(key)
    for (const listener of listeners) listener(key)
  },
  // Called by AuthGate once the user re-authenticates for a connection.
  clear(key: string | undefined) {
    if (!key) return
    expired.delete(key)
  },
  isExpired(key: string | undefined) {
    return !!key && expired.has(key)
  },
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
