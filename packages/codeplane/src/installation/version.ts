declare global {
  const CODEPLANE_VERSION: string
  const CODEPLANE_CHANNEL: string
}

export const InstallationVersion = typeof CODEPLANE_VERSION === "string" ? CODEPLANE_VERSION : "local"
export const InstallationChannel = typeof CODEPLANE_CHANNEL === "string" ? CODEPLANE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
