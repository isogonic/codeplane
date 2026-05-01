import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, lazy, Suspense, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { normalizeSettingsSection, settingsPath, settingsSection, type SettingsSection } from "./settings/nav"

type SettingsContentProps = {
  layout?: "dialog" | "page"
}

const SettingsGeneral = lazy(() => import("@/components/settings-general").then((module) => ({ default: module.SettingsGeneral })))
const SettingsKeybinds = lazy(() =>
  import("@/components/settings-keybinds").then((module) => ({ default: module.SettingsKeybinds })),
)
const SettingsProviders = lazy(() =>
  import("@/components/settings-providers").then((module) => ({ default: module.SettingsProviders })),
)
const ModesSettings = lazy(() => import("@/pages/agents").then((module) => ({ default: module.ModesSettings })))
const McpSettings = lazy(() => import("@/pages/mcp").then((module) => ({ default: module.McpSettings })))
const ModelsSettings = lazy(() => import("@/pages/models").then((module) => ({ default: module.ModelsSettings })))
const PluginsSettings = lazy(() => import("@/pages/plugins").then((module) => ({ default: module.PluginsSettings })))
const SkillsSettings = lazy(() => import("@/pages/skills").then((module) => ({ default: module.SkillsSettings })))

const settingsContent: Record<
  SettingsSection,
  {
    component: Component<SettingsContentProps>
    contentScroll?: boolean
  }
> = {
  general: { component: SettingsGeneral },
  shortcuts: { component: SettingsKeybinds },
  providers: { component: SettingsProviders },
  modes: { component: ModesSettings },
  models: { component: ModelsSettings },
  mcp: { component: McpSettings },
  plugins: { component: PluginsSettings },
  skills: { component: SkillsSettings },
}

export default function SettingsPage() {
  const language = useLanguage()
  const params = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  const section = createMemo(() => normalizeSettingsSection(params.tab))
  const current = createMemo(() => settingsSection(section()))
  const currentContent = createMemo(() => settingsContent[section()])
  const Content = createMemo(() => currentContent().component)

  createEffect(() => {
    if (!params.tab) return
    if (params.tab === section()) return
    navigate(settingsPath(section()), { replace: true })
  })

  return (
    <div
      classList={{
        "size-full": true,
        "overflow-hidden": currentContent().contentScroll,
        "overflow-y-auto": !currentContent().contentScroll,
      }}
    >
      <div
        classList={{
          "mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8": true,
          "h-full min-h-0": currentContent().contentScroll,
          "min-h-full": !currentContent().contentScroll,
        }}
      >
        <div class="shrink-0 flex items-center justify-between gap-4 border-b border-border-weak-base pb-4">
          <div class="min-w-0">
            <div class="text-20-medium text-text-strong truncate">{language.t(current().titleKey)}</div>
            <div class="text-12-regular text-text-weak">{language.t(current().descriptionKey)}</div>
          </div>
        </div>

        <Suspense fallback={<div class="h-full min-h-[240px]" />}>
          <Dynamic component={Content()} layout="page" />
        </Suspense>
      </div>
    </div>
  )
}
