import { base64Encode } from "@codeplane-ai/shared/util/encode"

export const TUI_PERMISSION_AUTO_ACCEPT_KEY = "permission_auto_accept.v1"
export const GLOBAL_AUTO_ACCEPT_KEY = "@global"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

export function isGlobalAutoAccepting(autoAccept: Record<string, boolean>) {
  return autoAccept[GLOBAL_AUTO_ACCEPT_KEY] === true
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return (
    autoAccept[acceptKey(sessionID, directory)] ??
    autoAccept[sessionID] ??
    (directoryKey ? autoAccept[directoryKey] : undefined)
  )
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  return autoAccept[directoryAcceptKey(directory)] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  if (isGlobalAutoAccepting(autoAccept)) return true
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}
