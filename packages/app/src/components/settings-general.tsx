import { Component, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { Button } from "@codeplane-ai/ui/button"
import { Select } from "@codeplane-ai/ui/select"
import { Switch } from "@codeplane-ai/ui/switch"
import { TextField } from "@codeplane-ai/ui/text-field"
import { useTheme, type ColorScheme } from "@codeplane-ai/ui/theme/context"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { usePermission } from "@/context/permission"
import { useUpdates } from "@/context/updates"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/context/settings"
import { decode64 } from "@/utils/base64"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { SettingsList } from "./settings-list"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneral: Component<{ layout?: "dialog" | "page" }> = (props) => {
  const theme = useTheme()
  const language = useLanguage()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const params = useParams()
  const settings = useSettings()
  const updates = useUpdates()

  type VersionInfo = { current: string; latest: string | null; hasUpdate: boolean; method: string }
  const [checkingVersion, setCheckingVersion] = createSignal(false)
  const refetchVersion = async () => {
    setCheckingVersion(true)
    try {
      return await updates.recheck(false)
    } finally {
      setCheckingVersion(false)
    }
  }
  const versionInfo = (): VersionInfo | undefined => updates.status() as VersionInfo | undefined

  onMount(() => {
    void refetchVersion()
  })

  const dir = createMemo(() => decode64(params.dir))
  /*
   * Settings → General is a global page (no `dir` / `params.id` in the
   * route) so the auto-accept toggle here controls the GLOBAL flag, not
   * a per-directory rule. The previous wiring read `dir()` and the
   * toggle silently disabled itself when there was no project context —
   * which is always, on this page. Bind directly to the global accessor
   * so the toggle reflects + writes the real state every time.
   *
   * Per-directory + per-session auto-accept settings still exist
   * (they're set inside a session view), but they're additive: the
   * global flag short-circuits `shouldAutoRespond` before the lineage
   * walk, so flipping it on accepts every request everywhere.
   */
  const accepting = createMemo(() => permission.isGlobalAutoAccept())
  const toggleAccept = (checked: boolean) => permission.setGlobalAutoAccept(checked)
  const coauthoring = createMemo(() => globalSync.data.config.commit?.coauthor === true)
  const toggleCoauthoring = (checked: boolean) => globalSync.updateConfig({ commit: { coauthor: checked } })

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )
  const followupOptions = createMemo((): { value: "queue" | "steer"; label: string }[] => [
    { value: "queue", label: language.t("settings.general.row.followup.option.queue") },
    { value: "steer", label: language.t("settings.general.row.followup.option.steer") },
  ])
  const reasoningOptions = createMemo((): { value: "short" | "full" | "off"; label: string }[] => [
    { value: "short", label: "Short" },
    { value: "full", label: "Full" },
    { value: "off", label: "Off" },
  ])

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())
  const terminal = () => terminalInput(settings.appearance.terminalFont())
  const page = () => props.layout === "page"

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const GeneralSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.language.title")}
          description={language.t("settings.general.row.language.description")}
        >
          <Select
            data-action="settings-language"
            options={languageOptions()}
            current={languageOptions().find((o) => o.value === language.locale())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && language.setLocale(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("command.permissions.autoaccept.enable")}
          description={language.t("toast.permissions.autoaccept.on.description")}
        >
          <div data-action="settings-auto-accept-permissions">
            <Switch checked={accepting()} onChange={toggleAccept} />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.followup.title")}
          description={language.t("settings.general.row.followup.description")}
        >
          <Select
            data-action="settings-followup-behavior"
            options={followupOptions()}
            current={followupOptions().find((o) => o.value === settings.general.followup())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && settings.general.setFollowup(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.codeplaneCoauthor.title")}
          description={language.t("settings.general.row.codeplaneCoauthor.description")}
        >
          <div data-action="settings-codeplane-coauthor">
            <Switch checked={coauthoring()} onChange={(checked) => void toggleCoauthoring(checked)} />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Select
              options={reasoningOptions()}
              current={reasoningOptions().find((o) => o.value === settings.general.reasoningDisplay())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(option) => option && settings.general.setReasoningDisplay(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSessionProgressBar.title")}
          description={language.t("settings.general.row.showSessionProgressBar.description")}
        >
          <div data-action="settings-show-session-progress-bar">
            <Switch
              checked={settings.general.showSessionProgressBar()}
              onChange={(checked) => settings.general.setShowSessionProgressBar(checked)}
            />
          </div>
        </SettingsRow>

        <Show when={updates.hasDesktopBridge()}>
          <SettingsRow
            title={language.t("settings.general.row.browserUse.title")}
            description={language.t("settings.general.row.browserUse.description")}
          >
            <div data-action="settings-browser-use">
              <Switch
                checked={settings.general.browserUse()}
                onChange={(checked) => settings.general.setBrowserUse(checked)}
              />
            </div>
          </SettingsRow>
        </Show>
      </SettingsList>
    </div>
  )

  const AdvancedSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.advanced")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showNavigation.title")}
          description={language.t("settings.general.row.showNavigation.description")}
        >
          <div data-action="settings-show-navigation">
            <Switch
              checked={settings.general.showNavigation()}
              onChange={(checked) => settings.general.setShowNavigation(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showTerminal.title")}
          description={language.t("settings.general.row.showTerminal.description")}
        >
          <div data-action="settings-show-terminal">
            <Switch
              checked={settings.general.showTerminal()}
              onChange={(checked) => settings.general.setShowTerminal(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AppearanceSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.appearance")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.colorScheme.title")}
          description={language.t("settings.general.row.colorScheme.description")}
        >
          <Select
            data-action="settings-color-scheme"
            options={colorSchemeOptions()}
            current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(option) => option && theme.setColorScheme(option.value)}
            onHighlight={(option) => {
              if (!option) return
              theme.previewColorScheme(option.value)
              return () => theme.cancelPreview()
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "220px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.uiFont.title")}
          description={language.t("settings.general.row.uiFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-ui-font"
              label={language.t("settings.general.row.uiFont.title")}
              hideLabel
              type="text"
              value={sans()}
              onChange={(value) => settings.appearance.setUIFont(value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.font.title")}
          description={language.t("settings.general.row.font.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-code-font"
              label={language.t("settings.general.row.font.title")}
              hideLabel
              type="text"
              value={mono()}
              onChange={(value) => settings.appearance.setFont(value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.terminalFont.title")}
          description={language.t("settings.general.row.terminalFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-terminal-font"
              label={language.t("settings.general.row.terminalFont.title")}
              hideLabel
              type="text"
              value={terminal()}
              onChange={(value) => settings.appearance.setTerminalFont(value)}
              placeholder={terminalDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": terminalFontFamily(settings.appearance.terminalFont()) }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const NotificationsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.notifications")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.notifications.agent.title")}
          description={language.t("settings.general.notifications.agent.description")}
        >
          <div data-action="settings-notifications-agent">
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.permissions.title")}
          description={language.t("settings.general.notifications.permissions.description")}
        >
          <div data-action="settings-notifications-permissions">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.errors.title")}
          description={language.t("settings.general.notifications.errors.description")}
        >
          <div data-action="settings-notifications-errors">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const SoundsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.sounds")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.sounds.agent.title")}
          description={language.t("settings.general.sounds.agent.description")}
        >
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.permissions.title")}
          description={language.t("settings.general.sounds.permissions.description")}
        >
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.errors.title")}
          description={language.t("settings.general.sounds.errors.description")}
        >
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const versionDescription = () => {
    const info = versionInfo()
    if (!info && checkingVersion()) return language.t("settings.general.row.version.descriptionLoading")
    if (!info) return language.t("settings.general.row.version.descriptionLoading")
    const current =
      info.current === "local" || info.current === "dev"
        ? language.t("settings.general.row.version.developmentBuild")
        : info.current
    // Without the desktop bridge (e.g., a remote browser viewing a
    // desktop-managed server) we can't drive the update from here, so we
    // still point the user at the desktop app. With the bridge, fall
    // through to the regular "up to date" copy — the Update button below
    // talks straight to electron-updater.
    if (info.method === "desktop" && !updates.hasDesktopBridge())
      return language.t("settings.general.row.version.descriptionDesktopManaged", { current })
    if (info.method === "managed-local")
      return language.t("settings.general.row.version.descriptionManagedLocal", { current })
    if (info.method === "unknown")
      return language.t("settings.general.row.version.descriptionUnknownMethod", { current })
    if (info.hasUpdate && info.latest)
      return language.t("settings.general.row.version.descriptionHasUpdate", {
        current,
        latest: info.latest,
      })
    return language.t("settings.general.row.version.descriptionUpToDate", { current })
  }

  const canRunVersionUpdate = () => {
    const info = versionInfo()
    if (!info?.hasUpdate) return false
    if (!info.latest) return false
    if (info.method === "unknown" || info.method === "managed-local") return false
    if (info.method === "desktop" && !updates.hasDesktopBridge()) return false
    return true
  }

  const UpdatesSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.updates")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.version.title")}
          description={versionDescription()}
        >
          <div data-action="settings-check-update" class="flex gap-2 items-center">
            <Show when={versionInfo()?.current && /^\d+\.\d+\.\d+/.test(versionInfo()!.current)}>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  e.preventDefault()
                  updates.openWhatsNew(versionInfo()?.current)
                }}
                disabled={updates.isUpgrading()}
              >
                {language.t("settings.general.row.version.action.whatsNew")}
              </Button>
            </Show>
            <Show
              when={
                canRunVersionUpdate()
              }
              fallback={
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  onClick={(e: MouseEvent) => {
                    e.preventDefault()
                    void refetchVersion()
                  }}
                  disabled={checkingVersion() || updates.isUpgrading()}
                >
                  {checkingVersion()
                    ? language.t("settings.general.row.version.action.checking")
                    : language.t("settings.general.row.version.action.check")}
                </Button>
              }
            >
              <Button
                type="button"
                size="small"
                variant="primary"
                icon="download"
                onClick={async (e: MouseEvent) => {
                  e.preventDefault()
                  await updates.startUpgrade(versionInfo()?.latest ?? undefined)
                  await refetchVersion()
                }}
                disabled={updates.isUpgrading()}
              >
                {updates.isUpgrading()
                  ? language.t("settings.general.row.version.action.updating")
                  : language.t("settings.general.row.version.action.update")}
              </Button>
            </Show>
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  return (
    <div
      classList={{
        "flex flex-col": true,
        "w-full": page(),
        "h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10": !page(),
      }}
    >
      <Show when={!page()}>
        <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
          <div class="flex flex-col gap-1 pt-6 pb-8">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.general")}</h2>
          </div>
        </div>
      </Show>

      <div class="flex flex-col gap-8 w-full">
        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />


        <UpdatesSection />

        <Show when={import.meta.env.VITE_CODEPLANE_CHANNEL === "beta"}>
          <AdvancedSection />
        </Show>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
