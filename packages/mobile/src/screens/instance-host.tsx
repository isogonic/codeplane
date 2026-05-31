import { Component } from "solid-js"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import type { CodeplaneMobileAPI } from "../platform/api"
import { MobileHeader } from "../components/mobile-header"
import { WebviewHost } from "../components/webview-host"

/**
 * Once an instance is picked, this screen owns the rest of the session.
 * The header shows a back button (← Servers) plus the current label.
 * The body is the embedded webview/iframe.
 *
 * Mirrors the desktop's `ui-host.ts` role: it's the equivalent of the
 * second BrowserWindow that boots after the picker. Status-bar
 * style and keyboard handling stay identical to the picker so there
 * is no flicker when the user moves between screens.
 */
export const InstanceHostScreen: Component<{
  instance: SavedInstance
  api: CodeplaneMobileAPI
  onBack: () => void
}> = (props) => {
  const title = () => {
    const url = props.instance.url
    if (!url) return props.instance.label || ""
    try {
      return props.instance.label || new URL(url).host
    } catch {
      return props.instance.label || url
    }
  }

  return (
    <div class="flex flex-col h-full w-full">
      <MobileHeader title={title()} onBack={props.onBack} />
      <WebviewHost instance={props.instance} api={props.api} onClose={props.onBack} />
    </div>
  )
}
