export async function writeClipboardText(text: string) {
  if (!text) return false

  const clipboard = globalThis.navigator?.clipboard
  if (clipboard) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Fall back for desktop shells and browsers that block Clipboard API access.
    }
  }

  if (typeof globalThis.document?.execCommand !== "function") return false
  const textarea = globalThis.document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  globalThis.document.body.append(textarea)
  textarea.select()

  try {
    return globalThis.document.execCommand("copy")
  } finally {
    textarea.remove()
  }
}
