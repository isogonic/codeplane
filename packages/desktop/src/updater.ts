import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { type as ostype } from "@tauri-apps/plugin-os"
import { Store } from "@tauri-apps/plugin-store"

import { t } from "./i18n"
import { commands } from "./bindings"

export const UPDATER_ENABLED = window.__CODEPLANE__?.updaterEnabled ?? false

const TOKEN_STORE = "codeplane.secrets.dat"
const GITHUB_TOKEN_KEY = "updater.githubToken"

let update: Update | null = null

const store = () => Store.load(TOKEN_STORE)

async function githubToken() {
  const value = await (await store()).get(GITHUB_TOKEN_KEY)
  if (typeof value !== "string") return
  const token = value.trim()
  if (!token) return
  return token
}

async function githubHeaders() {
  const token = await githubToken()
  if (!token) throw new Error(t("desktop.updater.tokenRequired.message"))

  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

export async function getUpdaterGitHubTokenConfigured() {
  return !!(await githubToken())
}

export async function setUpdaterGitHubToken(token: string) {
  const value = token.trim()
  if (!value) throw new Error(t("desktop.updater.tokenRequired.message"))

  const next = await store()
  await next.set(GITHUB_TOKEN_KEY, value)
  await next.save()
}

export async function checkForUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }

  const previous = update
  const headers = await githubHeaders()
  const next = await check({ headers })
  if (!next) {
    update = null
    await previous?.close().catch(() => undefined)
    return { updateAvailable: false }
  }

  await next.download(undefined, { headers }).catch(async (error: unknown) => {
    await next.close().catch(() => undefined)
    throw error
  })

  update = next
  await previous?.close().catch(() => undefined)
  return { updateAvailable: true, version: next.version }
}

export async function installDownloadedUpdate() {
  if (!UPDATER_ENABLED || !update) return

  const next = update
  update = null

  if (ostype() === "windows") await commands.killSidecar().catch(() => undefined)
  await next.install()
  await commands.killSidecar().catch(() => undefined)
  await relaunch()
}
