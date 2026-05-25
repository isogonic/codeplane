import { Component, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Select } from "@codeplane-ai/ui/select"
import { Switch } from "@codeplane-ai/ui/switch"
import { TextField } from "@codeplane-ai/ui/text-field"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { showToast } from "@codeplane-ai/ui/toast"
import { useTheme, type ColorScheme } from "@codeplane-ai/ui/theme/context"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { usePermission } from "@/context/permission"
import { usePlatform, type SystemPermissionStatus } from "@/context/platform"
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
import {
  systemPermissionGranted,
  systemPermissionNeedsRelaunch,
  systemPermissionReady,
} from "./desktop-permissions"
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
  const platform = usePlatform()
  const dialog = useDialog()

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
    if (globalSync.data.config.tools?.browser === undefined || globalSync.data.config.tools?.computer === undefined) {
      void globalSync.updateConfig({
        tools: {
          ...globalSync.data.config.tools,
          browser: globalSync.data.config.tools?.browser ?? settings.general.browserUse(),
          computer: globalSync.data.config.tools?.computer ?? settings.general.computerUse(),
        },
      })
    }
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
  const browserUse = createMemo(() => globalSync.data.config.tools?.browser ?? settings.general.browserUse())
  const computerUse = createMemo(() => globalSync.data.config.tools?.computer ?? settings.general.computerUse())
  const desktopInstance = createMemo(() => {
    const manager = platform.serverManager
    if (!manager) return
    const key = manager.currentKey ?? manager.defaultKey ?? manager.instances[0]?.key
    return manager.instances.find((instance) => instance.key === key)
  })
  const [openingLogDir, setOpeningLogDir] = createSignal(false)
  // Track real-time permission status so the Computer Use row can show
  // "1 of 2 granted" / "All granted" inline without users having to enable
  // the toggle to find out. Re-checked on focus and after the dialog closes.
  const [computerPermissions, setComputerPermissions] = createSignal<SystemPermissionStatus[] | undefined>(undefined)
  const refreshComputerPermissions = async () => {
    if (!platform.systemPermissions) return
    const status = await platform.systemPermissions.check()
    setComputerPermissions(status.permissions)
  }
  onMount(() => {
    void refreshComputerPermissions()
    const onFocus = () => void refreshComputerPermissions()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  })

  const openPermissionsDialog = (tool: "computer", afterGrant?: () => void) => {
    void dialog.show(() => (
      <DesktopPermissionsDialog
        tool={tool}
        onClose={() => {
          void refreshComputerPermissions()
          afterGrant?.()
        }}
      />
    ))
  }

  const setDesktopTool = (tool: "browser" | "computer", checked: boolean) => {
    // Browser tool has no OS permission gate today — flip immediately.
    if (tool === "browser") {
      settings.general.setBrowserUse(checked)
      void globalSync.updateConfig({ tools: { browser: checked } })
      return
    }
    // Turning Computer Use OFF: never gate; never prompt.
    if (!checked) {
      settings.general.setComputerUse(false)
      void globalSync.updateConfig({ tools: { computer: false } })
      return
    }
    // Turning Computer Use ON: only flip the switch + write config once
    // permissions are confirmed. Otherwise the user sees the toggle land
    // in "on" while the dialog tells them it doesn't work — confusing.
    void (async () => {
      if (!platform.systemPermissions) {
        // No bridge to check (e.g., running in a remote browser). Trust
        // the user and flip the switch.
        settings.general.setComputerUse(true)
        void globalSync.updateConfig({ tools: { computer: true } })
        return
      }
      const status = await platform.systemPermissions.check()
      setComputerPermissions(status.permissions)
      const missing = status.permissions.filter((p) => !systemPermissionReady(p))
      if (missing.length === 0) {
        settings.general.setComputerUse(true)
        void globalSync.updateConfig({ tools: { computer: true } })
        return
      }
      // Show the dialog; only commit the toggle if the user explicitly
      // confirms via "Enable anyway" inside the dialog.
      void dialog.show(() => (
        <DesktopPermissionsDialog
          tool="computer"
          onClose={() => {
            void refreshComputerPermissions()
          }}
          onConfirmEnable={() => {
            settings.general.setComputerUse(true)
            void globalSync.updateConfig({ tools: { computer: true } })
          }}
        />
      ))
    })()
  }
  const openInstanceLogDir = () => {
    const instance = desktopInstance()
    if (!instance?.local || !platform.serverManager) return
    setOpeningLogDir(true)
    platform.serverManager
      .openLogDir(instance.id)
      .then((opened) => {
        if (!opened) throw new Error(language.t("settings.general.row.instanceLogs.unavailable"))
      })
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setOpeningLogDir(false))
  }

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
                checked={browserUse()}
                onChange={(checked) => setDesktopTool("browser", checked)}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.general.row.computerUse.title")}
            description={
              <>
                {language.t("settings.general.row.computerUse.description")}
                <Show when={platform.systemPermissions && computerPermissions()}>
                  {(perms) => {
                    const total = perms().length
                    const active = perms().filter(systemPermissionReady).length
                    const allReady = active === total && total > 0
                    const needsRelaunch = perms().some(systemPermissionNeedsRelaunch)
                    return (
                      <span class="mt-1.5 inline-flex items-center gap-2 align-middle">
                        <span
                          classList={{
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-11-medium": true,
                            "bg-surface-success-weak text-text-on-success-strong": allReady,
                            "bg-surface-warning-weak text-text-on-warning-strong": !allReady && (computerUse() || needsRelaunch),
                            "bg-surface-weak text-text-weak": !allReady && !computerUse() && !needsRelaunch,
                          }}
                        >
                          <Icon
                            name={allReady ? "circle-check" : needsRelaunch ? "reset" : "circle-ban-sign"}
                            class="h-3 w-3"
                          />
                          {allReady
                            ? language.t("settings.general.row.computerUse.statusAllGranted")
                            : needsRelaunch
                              ? language.t("settings.general.row.computerUse.statusRelaunchRequired")
                              : language.t("settings.general.row.computerUse.statusActivePartial", {
                                active: String(active),
                                total: String(total),
                              })}
                        </span>
                        <button
                          type="button"
                          class="text-11-medium text-text-weak hover:text-text-strong underline-offset-2 hover:underline cursor-pointer"
                          data-action="settings-computer-use-manage"
                          onClick={(e: MouseEvent) => {
                            e.preventDefault()
                            openPermissionsDialog("computer")
                          }}
                        >
                          {language.t("settings.general.row.computerUse.manage")}
                        </button>
                      </span>
                    )
                  }}
                </Show>
              </>
            }
          >
            <div data-action="settings-computer-use">
              <Switch
                checked={computerUse()}
                onChange={(checked) => setDesktopTool("computer", checked)}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.general.row.debugLogging.title")}
            description={language.t("settings.general.row.debugLogging.description")}
          >
            <div data-action="settings-debug-logging">
              <Switch
                checked={settings.general.debugLogging()}
                onChange={(checked) => settings.general.setDebugLogging(checked)}
              />
            </div>
          </SettingsRow>
          <Show when={desktopInstance()?.local}>
            <SettingsRow
              title={language.t("settings.general.row.instanceLogs.title")}
              description={language.t("settings.general.row.instanceLogs.description")}
            >
              <Button
                type="button"
                size="small"
                variant="secondary"
                icon="folder"
                data-action="settings-open-instance-logs"
                onClick={(e: MouseEvent) => {
                  e.preventDefault()
                  openInstanceLogDir()
                }}
                disabled={openingLogDir()}
              >
                {openingLogDir()
                  ? language.t("settings.general.row.instanceLogs.action.opening")
                  : language.t("settings.general.row.instanceLogs.action.open")}
              </Button>
            </SettingsRow>
          </Show>
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

// Why each system permission is needed. Looked up by key so labels can come
// from the main process while the explanatory copy stays localizable in the
// renderer. Falls back to a generic line for any key the renderer doesn't
// recognise (forward-compat with future permission types).
function permissionDescriptionKey(key: string) {
  switch (key) {
    case "accessibility":
      return "settings.general.row.computerUse.permissionDescription.accessibility"
    case "screen-recording":
      return "settings.general.row.computerUse.permissionDescription.screenRecording"
    default:
      return "settings.general.row.computerUse.permissionDescription.generic"
  }
}

function DesktopPermissionsDialog(props: {
  tool: "browser" | "computer"
  // Fires every time the dialog closes — regardless of permission state —
  // so the caller can re-poll status and update the inline indicator.
  onClose?: () => void
  // Optional confirm callback. When provided, the dialog shows an "Enable
  // anyway" footer button that flips the toggle even with missing perms.
  // Used by the OFF→ON flow so the user can opt-in rather than discovering
  // the toggle silently committed itself.
  onConfirmEnable?: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()

  const [requesting, setRequesting] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const [permissions, setPermissions] = createSignal<SystemPermissionStatus[]>([])
  const [relaunching, setRelaunching] = createSignal(false)

  const refresh = async () => {
    const status = await platform.systemPermissions?.check()
    if (!status) return
    setPermissions(status.permissions)
  }

  onMount(() => {
    void refresh()
    // Poll while the dialog is open so a grant in System Settings reflects
    // back automatically. 2s cadence is fast enough to feel live but
    // doesn't hammer the IPC. Cleared on unmount.
    const interval = setInterval(() => void refresh(), 2000)
    // Refresh immediately when the window regains focus (the usual
    // moment after the user grants permission in System Settings).
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", onFocus)
    }
  })

  const handleClose = () => {
    props.onClose?.()
    dialog.close()
  }

  const request = async (key: string) => {
    setRequesting(key)
    try {
      // `request` returns once the preference pane has been opened (or the
      // OS-level prompt has been triggered). It does NOT wait for the user
      // to actually grant — the polling above picks that up.
      await platform.systemPermissions?.request(key)
    } finally {
      setRequesting(null)
    }
  }

  const runRefresh = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      // Tiny minimum visible duration so the user sees the spinner state.
      setTimeout(() => setRefreshing(false), 250)
    }
  }

  const relaunch = async () => {
    setRelaunching(true)
    try {
      const ok = (await platform.relaunchShell?.()) ?? false
      if (!ok) {
        // Dev builds and remote browsers can't actually relaunch — tell
        // the user to quit manually so they don't think the button broke.
        showToast({
          variant: "default",
          title: language.t("settings.general.row.computerUse.relaunchUnavailable.title"),
          description: language.t("settings.general.row.computerUse.relaunchUnavailable.description"),
        })
      }
    } finally {
      setRelaunching(false)
    }
  }

  const toolLabel = () =>
    props.tool === "browser"
      ? language.t("settings.general.row.browserUse.title")
      : language.t("settings.general.row.computerUse.title")

  const allReady = createMemo(
    () => permissions().length > 0 && permissions().every(systemPermissionReady),
  )
  const relaunchRequired = createMemo(() => permissions().some(systemPermissionNeedsRelaunch))
  const activeCount = createMemo(() => permissions().filter(systemPermissionReady).length)

  return (
    <Dialog
      title={language.t("settings.general.row.computerUse.permissionsTitle", { tool: toolLabel() })}
      fit
      class="w-[calc(100vw-2rem)] max-w-[40rem]"
      transition
    >
      <div class="flex w-full flex-col gap-5 px-5 pb-5">
        <p class="text-14-regular text-text-base leading-relaxed">
          {language.t("settings.general.row.computerUse.permissionsBody", {
            tool: toolLabel(),
            count: String(permissions().length),
          })}
        </p>

        <div class="flex items-center justify-between gap-3">
          <span
            classList={{
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-12-medium": true,
              "bg-surface-success-weak text-text-on-success-strong": allReady(),
              "bg-surface-warning-weak text-text-on-warning-strong": !allReady(),
            }}
          >
            <Icon
              name={allReady() ? "circle-check" : relaunchRequired() ? "reset" : "circle-ban-sign"}
              class="h-3.5 w-3.5"
            />
            {allReady()
              ? language.t("settings.general.row.computerUse.statusAllGranted")
              : relaunchRequired()
                ? language.t("settings.general.row.computerUse.statusRelaunchRequired")
                : language.t("settings.general.row.computerUse.statusActivePartial", {
                  active: String(activeCount()),
                  total: String(permissions().length),
                })}
          </span>
          <Button
            size="small"
            variant="ghost"
            disabled={refreshing()}
            onClick={(e: MouseEvent) => {
              e.preventDefault()
              void runRefresh()
            }}
          >
            {refreshing()
              ? language.t("settings.general.row.computerUse.recheckLoading")
              : language.t("settings.general.row.computerUse.recheck")}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          {permissions().map((p) => (
            <div
              classList={{
                "flex flex-col gap-3 rounded-lg border px-4 py-4 sm:flex-row sm:items-start sm:justify-between": true,
                "border-border-success-base bg-surface-success-weak/40": systemPermissionReady(p),
                "border-border-warning-base bg-surface-warning-weak/40": systemPermissionNeedsRelaunch(p),
                "border-border-weak-base": !systemPermissionGranted(p),
              }}
            >
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <Icon
                    name={
                      systemPermissionReady(p)
                        ? "circle-check"
                        : systemPermissionNeedsRelaunch(p)
                          ? "reset"
                          : "circle-ban-sign"
                    }
                    classList={{
                      "h-4 w-4 shrink-0": true,
                      "text-text-on-success-strong": systemPermissionReady(p),
                      "text-text-on-warning-strong": !systemPermissionReady(p),
                    }}
                  />
                  <span class="text-14-medium text-text-strong">{p.label}</span>
                  <span
                    classList={{
                      "rounded-full px-1.5 py-0.5 text-11-medium": true,
                      "bg-surface-success-weak text-text-on-success-strong": systemPermissionReady(p),
                      "bg-surface-warning-weak text-text-on-warning-strong": !systemPermissionReady(p),
                    }}
                  >
                    {systemPermissionReady(p)
                      ? language.t("settings.general.row.computerUse.permissionGranted")
                      : systemPermissionNeedsRelaunch(p)
                        ? language.t("settings.general.row.computerUse.permissionRelaunchRequired")
                        : language.t("settings.general.row.computerUse.permissionMissing")}
                  </span>
                </div>
                <span class="text-12-regular text-text-weak leading-relaxed">
                  {language.t(permissionDescriptionKey(p.key))}
                </span>
              </div>
              <Show when={!systemPermissionGranted(p)}>
                <div class="sm:shrink-0 sm:pt-0.5">
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={requesting() === p.key}
                    onClick={(e: MouseEvent) => {
                      e.preventDefault()
                      void request(p.key)
                    }}
                  >
                    {requesting() === p.key
                      ? language.t("settings.general.row.computerUse.permissionOpening")
                      : language.t("settings.general.row.computerUse.permissionOpenSettings")}
                  </Button>
                </div>
              </Show>
            </div>
          ))}
        </div>

        <div class="flex items-start gap-2 rounded-lg border border-border-warning-base bg-surface-warning-weak/40 px-3 py-2.5">
          <Icon name="circle-ban-sign" class="h-4 w-4 shrink-0 text-text-on-warning-strong mt-0.5" />
          <p class="text-12-regular text-text-base leading-relaxed">
            {language.t(
              relaunchRequired()
                ? "settings.general.row.computerUse.permissionsRelaunchFooter"
                : "settings.general.row.computerUse.permissionsFooter",
            )}
          </p>
        </div>

        <div class="flex flex-col-reverse gap-2 border-t border-border-weak-base pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" size="normal" onClick={handleClose}>
            {language.t("settings.general.row.computerUse.permissionDone")}
          </Button>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Show when={props.onConfirmEnable && !allReady()}>
              <Button
                variant="ghost"
                size="normal"
                onClick={(e: MouseEvent) => {
                  e.preventDefault()
                  props.onConfirmEnable?.()
                  handleClose()
                }}
              >
                {language.t("settings.general.row.computerUse.enableAnyway")}
              </Button>
            </Show>
            {/*
              Restart Codeplane only makes sense when at least one permission
              is missing or granted-but-inactive in this process. TCC is read
              at process start, so the macOS toggle can be on while the
              running Electron process still needs a relaunch.
            */}
            <Show when={platform.relaunchShell && !allReady()}>
              <Button
                variant={props.onConfirmEnable ? "ghost" : "primary"}
                size="normal"
                disabled={relaunching()}
                onClick={(e: MouseEvent) => {
                  e.preventDefault()
                  void relaunch()
                }}
              >
                {relaunching()
                  ? language.t("settings.general.row.computerUse.relaunchPending")
                  : language.t("settings.general.row.computerUse.relaunch")}
              </Button>
            </Show>
            <Show when={allReady() && props.onConfirmEnable}>
              <Button
                variant="primary"
                size="normal"
                onClick={(e: MouseEvent) => {
                  e.preventDefault()
                  props.onConfirmEnable?.()
                  handleClose()
                }}
              >
                {language.t("settings.general.row.computerUse.enableNow")}
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </Dialog>
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
