import { Popover as Kobalte } from "@kobalte/core/popover"
import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSyncOptional } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { StatusPopoverBody } from "./status-popover-body"

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const sync = useSyncOptional()
  const globalSync = useGlobalSync()
  const [shown, setShown] = createSignal(false)
  const status = createMemo(() => sync?.data ?? globalSync.data)
  const ready = createMemo(() => server.healthy() === false || status().mcp_ready)
  const healthy = createMemo(() => {
    const serverHealthy = server.healthy() === true
    const mcp = Object.values(status().mcp ?? {})
    const issue = mcp.some((item) => item.status !== "connected" && item.status !== "disabled")
    return serverHealthy && !issue
  })

  return (
    <Kobalte open={shown()} onOpenChange={setShown} gutter={4} placement="bottom-end" shift={-168} modal={false}>
      <Kobalte.Trigger
        as={Button}
        variant="ghost"
        class="titlebar-icon w-8 h-6 p-0 box-border"
        aria-label={language.t("status.popover.trigger")}
        data-no-window-drag={true}
      >
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={shown() ? "status-active" : "status"} size="small" />
          </div>
          <div
            classList={{
              "absolute -top-px -right-px size-1.5 rounded-full": true,
              "bg-icon-success-base": ready() && healthy(),
              "bg-icon-critical-base": server.healthy() === false || (ready() && !healthy()),
              "bg-border-weak-base": server.healthy() === undefined || !ready(),
            }}
          />
        </div>
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl z-50 outline-none">
          <div data-slot="popover-body">
            <Show when={shown()}>
              <StatusPopoverBody shown={shown} />
            </Show>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
