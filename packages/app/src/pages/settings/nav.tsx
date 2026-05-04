import { For, createMemo, type Accessor } from "solid-js"
import { Icon, type IconProps } from "@codeplane-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

export type SettingsSection = "general" | "shortcuts" | "providers" | "modes" | "models" | "mcp" | "plugins" | "skills"

export const settingsSections = [
  {
    value: "general",
    icon: "sliders",
    titleKey: "settings.tab.general",
    descriptionKey: "settings.tab.general.description",
    groupKey: "settings.section.app",
  },
  {
    value: "shortcuts",
    icon: "keyboard",
    titleKey: "settings.tab.shortcuts",
    descriptionKey: "settings.tab.shortcuts.description",
    groupKey: "settings.section.app",
  },
  {
    value: "providers",
    icon: "providers",
    titleKey: "settings.providers.title",
    descriptionKey: "settings.tab.providers.description",
    groupKey: "settings.section.ai",
  },
  {
    value: "models",
    icon: "models",
    titleKey: "models.page.title",
    descriptionKey: "settings.tab.models.description",
    groupKey: "settings.section.ai",
  },
  {
    value: "modes",
    icon: "brain",
    titleKey: "modes.page.title",
    descriptionKey: "settings.tab.modes.description",
    groupKey: "settings.section.ai",
  },
  {
    value: "plugins",
    icon: "server",
    titleKey: "plugins.page.title",
    descriptionKey: "settings.tab.plugins.description",
    groupKey: "settings.section.extensions",
  },
  {
    value: "mcp",
    icon: "mcp",
    titleKey: "mcp.page.title",
    descriptionKey: "settings.tab.mcp.description",
    groupKey: "settings.section.extensions",
  },
  {
    value: "skills",
    icon: "checklist",
    titleKey: "skills.page.title",
    descriptionKey: "settings.tab.skills.description",
    groupKey: "settings.section.extensions",
  },
] as const satisfies readonly {
  value: SettingsSection
  icon: IconProps["name"]
  titleKey: string
  descriptionKey: string
  groupKey: string
}[]

export const settingsGroups = [
  {
    titleKey: "settings.section.app",
    sections: settingsSections.filter((section) => section.groupKey === "settings.section.app"),
  },
  {
    titleKey: "settings.section.ai",
    sections: settingsSections.filter((section) => section.groupKey === "settings.section.ai"),
  },
  {
    titleKey: "settings.section.extensions",
    sections: settingsSections.filter((section) => section.groupKey === "settings.section.extensions"),
  },
]

export const isSettingsPath = (pathname: string) => pathname === "/settings" || pathname.startsWith("/settings/")

export function normalizeSettingsSection(value: string | undefined): SettingsSection {
  if (
    value === "shortcuts" ||
    value === "providers" ||
    value === "modes" ||
    value === "models" ||
    value === "mcp" ||
    value === "plugins" ||
    value === "skills"
  )
    return value
  return "general"
}

export const settingsPath = (section: SettingsSection) => (section === "general" ? "/settings" : `/settings/${section}`)

export function settingsSectionFromPath(pathname: string) {
  if (!isSettingsPath(pathname)) return "general"
  return normalizeSettingsSection(pathname.slice("/settings/".length).split("/")[0])
}

export function settingsSection(section: SettingsSection) {
  return settingsSections.find((item) => item.value === section) ?? settingsSections[0]
}

export function SettingsSidebarPanel(props: {
  current: Accessor<SettingsSection>
  onSelect: (section: SettingsSection) => void
  mobile?: boolean
  merged?: boolean
  width?: number
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const merged = createMemo(() => props.mobile || (props.merged ?? true))

  return (
    <div
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged(),
        "bg-background-stronger": !merged(),
        "flex-1 min-w-0 max-w-full overflow-hidden": props.mobile,
      }}
      style={{
        width: props.mobile ? undefined : `${props.width ?? 244}px`,
      }}
    >
      <div class="shrink-0 pl-1 py-1">
        <div class="flex flex-col min-w-0 gap-0.5 py-2 pl-2 pr-0">
          <div class="text-14-medium text-text-strong truncate">{language.t("sidebar.settings")}</div>
          <div class="text-12-regular text-text-base truncate">
            {language.t("app.name.web")} v{platform.version}
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar py-4">
        <div class="flex flex-col gap-4">
          <For each={settingsGroups}>
            {(group) => (
              <div class="flex flex-col gap-1.5">
                <div class="px-3 text-12-medium text-text-weak">{language.t(group.titleKey)}</div>
                <div class="flex flex-col gap-1">
                  <For each={group.sections}>
                    {(item) => {
                      const selected = () => props.current() === item.value
                      return (
                        <button
                          type="button"
                          classList={{
                            "flex h-8 w-full items-center gap-3 rounded-md px-2 text-left text-14-medium transition-colors focus:outline-none focus-visible:bg-surface-base-hover": true,
                            "bg-surface-base-active text-text-strong": selected(),
                            "text-text-base hover:bg-surface-base-hover": !selected(),
                          }}
                          aria-current={selected() ? "page" : undefined}
                          onClick={() => props.onSelect(item.value)}
                        >
                          <Icon
                            name={item.icon}
                            class={selected() ? "icon-strong-base shrink-0" : "icon-base shrink-0"}
                          />
                          <span class="truncate">{language.t(item.titleKey)}</span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
