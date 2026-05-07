import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Button } from "@codeplane-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@codeplane-ai/ui/tooltip"

import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { StatusPopover } from "./status-popover"

export function Titlebar() {
  const layout = useLayout()
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`
  const isHome = createMemo(
    () => location.pathname === "/" || location.pathname === "/notifications",
  )
  const creating = createMemo(() => {
    if (!params.dir) return false
    if (params.id) return false
    const parts = location.pathname.replace(/\/+$/, "").split("/")
    return parts.at(-1) === "session"
  })

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)
  const hasProjects = createMemo(() => layout.projects.list().length > 0)
  const nav = createMemo(() => import.meta.env.VITE_CODEPLANE_CHANNEL !== "beta" || settings.general.showNavigation())
  const desktopMacos = createMemo(() => platform.desktop && platform.os === "macos")

  // Track macOS fullscreen so we can drop the 88px traffic-light gutter
  // when the system hides the close/min/zoom cluster.
  const desktopWindow =
    typeof window !== "undefined" ? (window as Window & { codeplaneDesktop?: { window?: { state?: { fullscreen: boolean }; onStateChange?: (cb: (s: { fullscreen: boolean }) => void) => () => void } } }).codeplaneDesktop?.window : undefined
  const [fullscreen, setFullscreen] = createSignal(!!desktopWindow?.state?.fullscreen)
  if (desktopWindow?.onStateChange) {
    const off = desktopWindow.onStateChange((state) => setFullscreen(!!state.fullscreen))
    onCleanup(() => off())
  }
  const trafficLightGap = createMemo(() => desktopMacos() && !fullscreen())

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return (
    <header
      class="titlebar-shell shrink-0 relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
      classList={{
        "h-11": platform.desktop,
        "h-10": !platform.desktop,
      }}
      data-desktop-titlebar={desktopMacos() ? "macos" : undefined}
      data-platform-desktop={platform.desktop ? "true" : undefined}
    >
      <div
        classList={{
          "flex items-center min-w-0 transition-[padding] duration-200 ease-out": true,
          "pl-2": !trafficLightGap(),
          "pl-[88px]": trafficLightGap(),
        }}
      >
        <div class="flex items-center gap-2 shrink-0" data-no-window-drag>
          <div class="xl:hidden w-[48px] shrink-0 flex items-center justify-center">
            <IconButton
              icon="menu"
              variant="ghost"
              class="titlebar-icon rounded-md"
              onClick={layout.mobileSidebar.toggle}
              aria-label={language.t("sidebar.menu.toggle")}
              aria-expanded={layout.mobileSidebar.opened()}
            />
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Show when={!isHome()}>
              <TooltipKeybind
                class="hidden xl:flex shrink-0 ml-12"
                placement="bottom"
                title={language.t("command.sidebar.toggle")}
                keybind={command.keybind("sidebar.toggle")}
              >
                <Button
                  variant="ghost"
                  class="group/sidebar-toggle titlebar-icon w-8 h-7 p-0 box-border rounded-md"
                  onClick={layout.sidebar.toggle}
                  aria-label={language.t("command.sidebar.toggle")}
                  aria-expanded={layout.sidebar.opened()}
                >
                  <Icon size="small" name={layout.sidebar.opened() ? "sidebar-active" : "sidebar"} />
                </Button>
              </TooltipKeybind>
            </Show>
            <div class="hidden xl:flex items-center shrink-0 gap-2">
              <Show when={params.dir}>
                <div
                  class="flex items-center shrink-0 w-8"
                  aria-hidden={layout.sidebar.opened() ? "true" : undefined}
                >
                  <div
                    class="transition-opacity"
                    classList={{
                      "opacity-100 duration-120 ease-out": !layout.sidebar.opened(),
                      "opacity-0 duration-120 ease-in delay-0 pointer-events-none": layout.sidebar.opened(),
                    }}
                  >
                    <TooltipKeybind
                      placement="bottom"
                      title={language.t("command.session.new")}
                      keybind={command.keybind("session.new")}
                      openDelay={2000}
                    >
                      <Button
                        variant="ghost"
                        icon={creating() ? "new-session-active" : "new-session"}
                        class="titlebar-icon w-8 h-7 p-0 box-border rounded-md"
                        disabled={layout.sidebar.opened()}
                        tabIndex={layout.sidebar.opened() ? -1 : undefined}
                        onClick={() => {
                          if (!params.dir) return
                          navigate(`/${params.dir}/session`)
                        }}
                        aria-label={language.t("command.session.new")}
                        aria-current={creating() ? "page" : undefined}
                      />
                    </TooltipKeybind>
                  </div>
                </div>
              </Show>
              <div
                class="flex items-center shrink-0 gap-1"
                classList={{
                  "-translate-x-[40px]": layout.sidebar.opened() && !!params.dir,
                  "duration-180 ease-out": !layout.sidebar.opened(),
                  "duration-180 ease-in": layout.sidebar.opened(),
                }}
              >
                <Show when={platform.desktop || (hasProjects() && nav())}>
                  <div class="titlebar-cluster flex items-center gap-0.5 rounded-lg p-0.5">
                    <Show when={platform.desktop}>
                      <Tooltip
                        placement="bottom"
                        value={language.t("command.server.switch")}
                        openDelay={2000}
                      >
                        <Button
                          variant="ghost"
                          icon="server"
                          class="titlebar-icon w-7 h-6 p-0 box-border rounded-md"
                          onClick={() => command.trigger("server.switch")}
                          aria-label={language.t("command.server.switch")}
                        />
                      </Tooltip>
                    </Show>
                    <Show when={hasProjects() && nav()}>
                      <Tooltip placement="bottom" value={language.t("common.goBack")} openDelay={2000}>
                        <Button
                          variant="ghost"
                          icon="chevron-left"
                          class="titlebar-icon w-7 h-6 p-0 box-border rounded-md"
                          disabled={!canBack()}
                          onClick={back}
                          aria-label={language.t("common.goBack")}
                        />
                      </Tooltip>
                      <Tooltip placement="bottom" value={language.t("common.goForward")} openDelay={2000}>
                        <Button
                          variant="ghost"
                          icon="chevron-right"
                          class="titlebar-icon w-7 h-6 p-0 box-border rounded-md"
                          disabled={!canForward()}
                          onClick={forward}
                          aria-label={language.t("common.goForward")}
                        />
                      </Tooltip>
                    </Show>
                  </div>
                </Show>
                <div id="codeplane-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
                {(() => {
                  const channel = import.meta.env.VITE_CODEPLANE_CHANNEL
                  if (channel !== "beta" && channel !== "dev") return null
                  return (
                  <div class="bg-icon-interactive-base text-[#FFF] text-11-medium px-1.5 py-0.5 rounded-sm uppercase font-mono tracking-wider">
                    {channel.toUpperCase()}
                  </div>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="min-w-0 flex items-center justify-center pointer-events-none">
        <div
          id="codeplane-titlebar-center"
          class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full"
          data-no-window-drag
        />
      </div>

      <div
        classList={{
          "flex items-center min-w-0 justify-end": true,
          "pr-2": true,
        }}
      >
        <div id="codeplane-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end" data-no-window-drag />
        <Show when={platform.desktop}>
          <div class="flex items-center gap-1 shrink-0" data-no-window-drag>
            <StatusPopover />
          </div>
        </Show>
      </div>
    </header>
  )
}
