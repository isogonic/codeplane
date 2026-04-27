import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { useLocation, useNavigate } from "@solidjs/router"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  aimMove: (event: MouseEvent) => void
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  renderProjectOverlay: () => JSX.Element
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const notification = useNotification()
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const placement = () => (props.mobile ? "bottom" : "right")
  const homeSelected = createMemo(() => location.pathname === "/")
  const notificationsSelected = createMemo(() => location.pathname === "/notifications")
  const notificationActive = createMemo(() => notification.unseenCount() > 0)
  const openGlobalRoute = (href: string) => {
    navigate(href)
    layout.mobileSidebar.hide()
  }
  const RailAction = (itemProps: {
    icon: IconProps["name"]
    label: Accessor<string>
    selected: Accessor<boolean>
    notify?: Accessor<boolean>
    critical?: Accessor<boolean>
    onClick: () => void
  }) => (
    <Tooltip placement={placement()} value={itemProps.label()}>
      <button
        type="button"
        classList={{
          "relative flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default focus:outline-none": true,
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": itemProps.selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !itemProps.selected(),
        }}
        aria-label={itemProps.label()}
        aria-current={itemProps.selected() ? "page" : undefined}
        onClick={itemProps.onClick}
      >
        <Icon name={itemProps.icon} />
        <Show when={itemProps.notify?.()}>
          <div
            classList={{
              "absolute top-1 right-1 size-1.5 rounded-full z-10": true,
              "bg-icon-critical-base": itemProps.critical?.(),
              "bg-text-interactive-base": !itemProps.critical?.(),
            }}
          />
        </Show>
      </button>
    </Tooltip>
  )
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden"
        onMouseMove={props.aimMove}
      >
        <div class="flex-1 min-h-0 w-full">
          <DragDropProvider
            onDragStart={props.handleDragStart}
            onDragEnd={props.handleDragEnd}
            onDragOver={props.handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-3 overflow-y-auto no-scrollbar">
              <RailAction
                icon="home"
                label={() => language.t("sidebar.home")}
                selected={homeSelected}
                onClick={() => openGlobalRoute("/")}
              />
              <RailAction
                icon="bell"
                label={() => language.t("sidebar.notifications")}
                selected={notificationsSelected}
                notify={notificationActive}
                critical={notification.unseenHasError}
                onClick={() => openGlobalRoute("/notifications")}
              />
              <SortableProvider ids={props.projects().map((p) => p.worktree)}>
                <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
              </SortableProvider>
              <Tooltip
                placement={placement()}
                value={
                  <div class="flex items-center gap-2">
                    <span>{props.openProjectLabel}</span>
                    <Show when={!props.mobile && !!props.openProjectKeybind()}>
                      <span class="text-icon-base text-12-medium">{props.openProjectKeybind()}</span>
                    </Show>
                  </div>
                }
              >
                <IconButton
                  icon="plus"
                  variant="ghost"
                  size="large"
                  onClick={props.onOpenProject}
                  aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
                />
              </Tooltip>
            </div>
            <DragOverlay>{props.renderProjectOverlay()}</DragOverlay>
          </DragDropProvider>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
            <IconButton
              icon="settings-gear"
              variant="ghost"
              size="large"
              onClick={props.onOpenSettings}
              aria-label={props.settingsLabel()}
            />
          </TooltipKeybind>
          <Tooltip placement={placement()} value={props.helpLabel()}>
            <IconButton
              icon="help"
              variant="ghost"
              size="large"
              onClick={props.onOpenHelp}
              aria-label={props.helpLabel()}
            />
          </Tooltip>
        </div>
      </div>

      <div
        ref={(el) => {
          panel = el
        }}
        classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
        aria-hidden={!expanded()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
