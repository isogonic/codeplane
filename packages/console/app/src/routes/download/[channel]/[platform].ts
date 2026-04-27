import type { APIEvent } from "@solidjs/start"
import type { DownloadPlatform } from "../types"

const prodAssetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "codeplane-desktop-darwin-aarch64.dmg",
  "darwin-x64-dmg": "codeplane-desktop-darwin-x64.dmg",
  "windows-x64-nsis": "codeplane-desktop-windows-x64.exe",
  "linux-x64-deb": "codeplane-desktop-linux-amd64.deb",
  "linux-x64-appimage": "codeplane-desktop-linux-amd64.AppImage",
  "linux-x64-rpm": "codeplane-desktop-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

const betaAssetNames: Record<string, string> = {
  "darwin-aarch64-dmg": "codeplane-electron-mac-arm64.dmg",
  "darwin-x64-dmg": "codeplane-electron-mac-x64.dmg",
  "windows-x64-nsis": "codeplane-electron-win-x64.exe",
  "linux-x64-deb": "codeplane-electron-linux-amd64.deb",
  "linux-x64-appimage": "codeplane-electron-linux-x86_64.AppImage",
  "linux-x64-rpm": "codeplane-electron-linux-x86_64.rpm",
} satisfies Record<DownloadPlatform, string>

// Doing this on the server lets us preserve the original name for platforms we don't care to rename for
const downloadNames: Record<string, string> = {
  "darwin-aarch64-dmg": "CodePlane Desktop.dmg",
  "darwin-x64-dmg": "CodePlane Desktop.dmg",
  "windows-x64-nsis": "CodePlane Desktop Installer.exe",
} satisfies { [K in DownloadPlatform]?: string }

export async function GET({ params: { platform, channel } }: APIEvent) {
  const assetName = channel === "stable" ? prodAssetNames[platform] : betaAssetNames[platform]
  if (!assetName) return new Response(null, { status: 404 })

  const resp = await fetch(
    `https://github.com/anomalyco/${channel === "stable" ? "codeplane" : "codeplane-beta"}/releases/latest/download/${assetName}`,
    {
      cf: {
        // in case gh releases has rate limits
        cacheTtl: 60 * 5,
        cacheEverything: true,
      },
    } as any,
  )

  const downloadName = downloadNames[platform]

  const headers = new Headers(resp.headers)
  if (downloadName) headers.set("content-disposition", `attachment; filename="${downloadName}"`)

  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers })
}
