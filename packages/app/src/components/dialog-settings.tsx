import { type Component, For, lazy, Suspense } from "solid-js"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Tabs } from "@codeplane-ai/ui/tabs"
import { Icon } from "@codeplane-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { settingsGroups, settingsSections, type SettingsSection } from "@/pages/settings/nav"

// Lazy-load every settings pane so opening the dialog doesn't block on
// modules the user might not click into. Mirrors the lazy graph in
// `pages/settings.tsx` so the dialog and the full-page settings UI stay
// byte-identical (same components, same boundaries).
const SettingsGeneral = lazy(() =>
  import("./settings-general").then((m) => ({ default: m.SettingsGeneral })),
)
const SettingsKeybinds = lazy(() =>
  import("./settings-keybinds").then((m) => ({ default: m.SettingsKeybinds })),
)
const SettingsProviders = lazy(() =>
  import("./settings-providers").then((m) => ({ default: m.SettingsProviders })),
)
const ModelsSettings = lazy(() => import("@/pages/models").then((m) => ({ default: m.ModelsSettings })))
const ModesSettings = lazy(() => import("@/pages/agents").then((m) => ({ default: m.ModesSettings })))
const PluginsSettings = lazy(() => import("@/pages/plugins").then((m) => ({ default: m.PluginsSettings })))
const McpSettings = lazy(() => import("@/pages/mcp").then((m) => ({ default: m.McpSettings })))
const SkillsSettings = lazy(() => import("@/pages/skills").then((m) => ({ default: m.SkillsSettings })))

// Driver table for which component renders inside which tab. Single source
// of truth so adding a section in `pages/settings/nav.tsx` only requires
// dropping a new row here — never another switch/Show ladder.
const sectionContent: Record<SettingsSection, Component<{ layout?: "dialog" | "page" }>> = {
  general: SettingsGeneral,
  shortcuts: SettingsKeybinds,
  providers: SettingsProviders,
  models: ModelsSettings,
  modes: ModesSettings,
  plugins: PluginsSettings,
  mcp: McpSettings,
  skills: SkillsSettings,
}

export const DialogSettings: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <Dialog size="x-large" transition>
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <For each={settingsGroups}>
                  {(group) => (
                    <div class="flex flex-col gap-1.5">
                      <Tabs.SectionTitle>{language.t(group.titleKey)}</Tabs.SectionTitle>
                      <div class="flex flex-col gap-1.5 w-full">
                        <For each={group.sections}>
                          {(item) => (
                            <Tabs.Trigger value={item.value}>
                              <Icon name={item.icon} />
                              {language.t(item.titleKey)}
                            </Tabs.Trigger>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.web")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <For each={settingsSections}>
          {(section) => {
            const Body = sectionContent[section.value]
            return (
              <Tabs.Content value={section.value} class="no-scrollbar">
                <Suspense fallback={<div class="h-full min-h-[240px]" />}>
                  <Body layout="dialog" />
                </Suspense>
              </Tabs.Content>
            )
          }}
        </For>
      </Tabs>
    </Dialog>
  )
}
