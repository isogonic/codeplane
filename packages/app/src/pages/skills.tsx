import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Switch } from "@codeplane-ai/ui/switch"
import { Tag } from "@codeplane-ai/ui/tag"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import type { AppSkillsResponse, Config } from "@codeplane-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"

type SkillInfo = AppSkillsResponse[number]
type SkillSourceKind = "path" | "url"
type SkillSourceEntry = {
  kind: SkillSourceKind
  index: number
  value: string
}
type PermissionAction = "allow" | "ask" | "deny"
type PermissionObject = Record<string, PermissionAction>
type PermissionConfigObject = Exclude<Config["permission"], string | undefined>
type FormState = {
  kind: SkillSourceKind
  value: string
  errors: { value?: string }
}

const isPermissionAction = (value: unknown): value is PermissionAction =>
  value === "allow" || value === "ask" || value === "deny"

const isPermissionObject = (value: unknown): value is PermissionObject =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every(isPermissionAction)

const permissionRecord = (permission: Config["permission"]): PermissionConfigObject => {
  if (!permission) return {}
  if (typeof permission === "string") return { "*": permission }
  return { ...permission }
}

const wildcardMatch = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value)

const permissionRules = (permission: Config["permission"]) =>
  Object.entries(permissionRecord(permission)).flatMap(([permission, value]) => {
    if (isPermissionAction(value)) return [{ permission, pattern: "*", action: value }]
    if (!isPermissionObject(value)) return []
    return Object.entries(value).map(([pattern, action]) => ({ permission, pattern, action }))
  })

const skillAction = (permission: Config["permission"], name: string) =>
  permissionRules(permission)
    .toReversed()
    .find((rule) => wildcardMatch(rule.permission, "skill") && wildcardMatch(rule.pattern, name))?.action ?? "allow"

const skillRules = (permission: Config["permission"]): PermissionObject => {
  const current = permissionRecord(permission).skill
  if (isPermissionAction(current)) return { "*": current }
  if (isPermissionObject(current)) return { ...current }
  return {}
}

const sourceConfig = (sources: { paths: string[]; urls: string[] }) => ({
  paths: sources.paths,
  urls: sources.urls,
})

export function SkillsSettings(props: { layout?: "dialog" | "page" } = {}) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const page = () => props.layout === "page"

  const [skills, skillActions] = createResource(() =>
    globalSDK.client.app
      .skills()
      .then((result) => result.data ?? [])
      .catch(() => [] as AppSkillsResponse),
  )

  const loadedSkills = createMemo(() => (skills() ?? []).toSorted((a, b) => a.name.localeCompare(b.name)))
  const sources = createMemo<SkillSourceEntry[]>(() => [
    ...(globalSync.data.config.skills?.paths ?? []).map((value, index) => ({ kind: "path" as const, index, value })),
    ...(globalSync.data.config.skills?.urls ?? []).map((value, index) => ({ kind: "url" as const, index, value })),
  ])
  const enabledCount = createMemo(
    () =>
      loadedSkills().filter((skill) => skillAction(globalSync.data.config.permission, skill.name) !== "deny").length,
  )
  const canOpenLocalPath = createMemo(() => !!server.isLocal() && !!platform.openPath)

  const updateSkillEnabled = useMutation(() => ({
    mutationFn: async (input: { name: string; enabled: boolean }) => {
      const permission = permissionRecord(globalSync.data.config.permission)
      const rules = skillRules(permission)
      delete rules[input.name]
      rules[input.name] = input.enabled ? "allow" : "deny"
      delete permission.skill
      permission.skill = rules
      await globalSync.updateConfig({ permission })
      await globalSDK.client.global.dispose().catch(() => undefined)
      void skillActions.refetch()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const removeSource = useMutation(() => ({
    mutationFn: async (entry: SkillSourceEntry) => {
      const paths = (globalSync.data.config.skills?.paths ?? []).slice()
      const urls = (globalSync.data.config.skills?.urls ?? []).slice()
      if (entry.kind === "path") paths.splice(entry.index, 1)
      if (entry.kind === "url") urls.splice(entry.index, 1)
      await globalSync.updateConfig({ skills: sourceConfig({ paths, urls }) })
      await globalSDK.client.global.dispose().catch(() => undefined)
      void skillActions.refetch()
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("skills.toast.sourceRemoved"),
      })
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const openSourceEditor = (entry?: SkillSourceEntry) => {
    dialog.show(() => <SkillSourceEditorDialog entry={entry} onSaved={() => void skillActions.refetch()} />)
  }

  const openSkill = (skill: SkillInfo) => {
    if (!platform.openPath || !canOpenLocalPath()) return
    void platform.openPath(skill.location)
  }

  return (
    <>
      <div
        classList={{
          "shrink-0 flex items-center gap-4": true,
          "justify-between border-b border-border-weak-base pb-4": !page(),
          "justify-end": page(),
        }}
      >
        <Show when={!page()}>
          <div class="min-w-0">
            <div class="text-20-medium text-text-strong truncate">{language.t("skills.page.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("skills.page.subtitle", {
                enabled: enabledCount(),
                total: loadedSkills().length,
                sources: sources().length,
              })}
            </div>
          </div>
        </Show>
        <Button variant="primary" size="large" icon="plus-small" onClick={() => openSourceEditor()}>
          {language.t("skills.page.addSource")}
        </Button>
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-12-medium text-text-weak">{language.t("skills.section.sources")}</div>
        <Show
          when={sources().length > 0}
          fallback={
            <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-6 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
              {language.t("skills.sources.empty")}
            </div>
          }
        >
          <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
            <For each={sources()}>
              {(source) => (
                <SkillSourceRow
                  source={source}
                  onEdit={() => openSourceEditor(source)}
                  onRemove={() => {
                    if (!window.confirm(language.t("skills.sources.confirm.remove", { source: source.value }))) return
                    removeSource.mutate(source)
                  }}
                />
              )}
            </For>
          </ul>
        </Show>
      </div>

      <div class="flex flex-col gap-3">
        <div class="text-12-medium text-text-weak">{language.t("skills.section.available")}</div>
        <Show
          when={!skills.loading}
          fallback={
            <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
              {language.t("common.loading")}
            </div>
          }
        >
          <Show
            when={loadedSkills().length > 0}
            fallback={
              <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
                {language.t("skills.page.empty")}
              </div>
            }
          >
            <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
              <For each={loadedSkills()}>
                {(skill) => (
                  <SkillRow
                    skill={skill}
                    enabled={() => skillAction(globalSync.data.config.permission, skill.name) !== "deny"}
                    toggling={() => updateSkillEnabled.isPending && updateSkillEnabled.variables?.name === skill.name}
                    canOpen={canOpenLocalPath}
                    onToggle={(enabled) => updateSkillEnabled.mutate({ name: skill.name, enabled })}
                    onOpen={() => openSkill(skill)}
                  />
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </>
  )
}

export default function SkillsPage() {
  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <SkillsSettings />
      </div>
    </div>
  )
}

function SkillRow(props: {
  skill: SkillInfo
  enabled: () => boolean
  toggling: () => boolean
  canOpen: () => boolean
  onToggle: (enabled: boolean) => void
  onOpen: () => void
}) {
  const language = useLanguage()
  const normalizedLocation = () => props.skill.location.replace(/\\/g, "/")
  const kind = () => {
    const location = normalizedLocation()
    if (location.includes("/.claude/skills/")) return language.t("skills.kind.claude")
    if (location.includes("/.agents/skills/")) return language.t("skills.kind.agents")
    if (location.includes("/.codeplane/")) return language.t("skills.kind.codeplane")
    return language.t("skills.kind.local")
  }
  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="checklist" size="small" class="icon-strong-base shrink-0" />
            <span class="truncate text-14-medium text-text-strong">{props.skill.name}</span>
            <Tag>{kind()}</Tag>
            <Show when={!props.enabled()}>
              <Tag>{language.t("skills.tag.disabled")}</Tag>
            </Show>
          </div>
          <Show when={props.skill.description}>
            <div class="mt-0.5 truncate text-12-regular text-text-weak">{props.skill.description}</div>
          </Show>
          <div class="mt-0.5 truncate font-mono text-11-regular text-text-weak">{props.skill.location}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Switch checked={props.enabled()} disabled={props.toggling()} onChange={props.onToggle} hideLabel>
            {language.t("common.enabled")}
          </Switch>
          <IconButton
            icon="edit"
            variant="ghost"
            size="normal"
            aria-label={language.t("skills.row.openFile")}
            disabled={!props.canOpen()}
            onClick={props.onOpen}
          />
        </div>
      </div>
    </li>
  )
}

function SkillSourceRow(props: { source: SkillSourceEntry; onEdit: () => void; onRemove: () => void }) {
  const language = useLanguage()
  const kindLabel = () =>
    props.source.kind === "path" ? language.t("skills.source.path") : language.t("skills.source.url")
  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon
              name={props.source.kind === "path" ? "folder" : "link"}
              size="small"
              class="icon-strong-base shrink-0"
            />
            <span class="truncate font-mono text-13-medium text-text-strong">{props.source.value}</span>
            <Tag>{kindLabel()}</Tag>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <IconButton
            icon="edit"
            variant="ghost"
            size="normal"
            aria-label={language.t("common.edit")}
            onClick={props.onEdit}
          />
          <IconButton
            icon="trash"
            variant="ghost"
            size="normal"
            aria-label={language.t("common.delete")}
            onClick={props.onRemove}
          />
        </div>
      </div>
    </li>
  )
}

function SkillSourceEditorDialog(props: { entry?: SkillSourceEntry; onSaved: () => void }) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const isEdit = !!props.entry
  const [form, setForm] = createStore<FormState>({
    kind: props.entry?.kind ?? "path",
    value: props.entry?.value ?? "",
    errors: {},
  })

  const canBrowse = () => form.kind === "path" && !!platform.openDirectoryPickerDialog && server.isLocal()

  const validate = () => {
    const value = form.value.trim()
    const errors: FormState["errors"] = {}
    if (!value) errors.value = language.t("skills.editor.error.value")
    if (form.kind === "url" && value && !/^https?:\/\//i.test(value)) {
      errors.value = language.t("skills.editor.error.url")
    }
    setForm("errors", errors)
    return Object.keys(errors).length === 0
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) return
      const paths = (globalSync.data.config.skills?.paths ?? []).slice()
      const urls = (globalSync.data.config.skills?.urls ?? []).slice()
      if (props.entry?.kind === "path") paths.splice(props.entry.index, 1)
      if (props.entry?.kind === "url") urls.splice(props.entry.index, 1)
      const target = form.kind === "path" ? paths : urls
      if (target.includes(form.value.trim())) {
        setForm("errors", "value", language.t("skills.editor.error.duplicate"))
        return
      }
      if (props.entry && props.entry.kind === form.kind) {
        target.splice(props.entry.index, 0, form.value.trim())
      } else {
        target.push(form.value.trim())
      }
      await globalSync.updateConfig({ skills: sourceConfig({ paths, urls }) })
      await globalSDK.client.global.dispose().catch(() => undefined)
      props.onSaved()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEdit ? language.t("skills.toast.sourceUpdated") : language.t("skills.toast.sourceAdded"),
      })
      dialog.close()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const choosePath = () => {
    if (!canBrowse() || !platform.openDirectoryPickerDialog) return
    void platform.openDirectoryPickerDialog({ title: language.t("skills.editor.browse.title") }).then((result) => {
      if (!result) return
      setForm("value", Array.isArray(result) ? (result[0] ?? "") : result)
    })
  }

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    if (save.isPending) return
    save.mutate()
  }

  return (
    <Dialog
      title={isEdit ? language.t("skills.editor.title.edit") : language.t("skills.editor.title.add")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 px-6 pt-0 pb-5">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("skills.editor.type")}</label>
            <div class="flex gap-1.5">
              <KindButton
                active={form.kind === "path"}
                label={language.t("skills.source.path")}
                onClick={() => setForm("kind", "path")}
              />
              <KindButton
                active={form.kind === "url"}
                label={language.t("skills.source.url")}
                onClick={() => setForm("kind", "url")}
              />
            </div>
          </div>

          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <TextField
                autofocus
                label={form.kind === "path" ? language.t("skills.editor.path") : language.t("skills.editor.url")}
                description={
                  form.kind === "path"
                    ? language.t("skills.editor.path.description")
                    : language.t("skills.editor.url.description")
                }
                placeholder={form.kind === "path" ? "~/.codeplane/skills" : "https://example.com/.well-known/skills/"}
                value={form.value}
                onChange={(value) =>
                  batch(() => {
                    setForm("value", value)
                    setForm("errors", "value", undefined)
                  })
                }
                error={form.errors.value}
                spellcheck={false}
                class="font-mono text-xs"
              />
            </div>
            <Show when={canBrowse()}>
              <Button type="button" variant="secondary" size="large" icon="folder" onClick={choosePath}>
                {language.t("skills.editor.browse")}
              </Button>
            </Show>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={save.isPending}>
            {save.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function KindButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      classList={{
        "px-3 py-1.5 rounded-md text-12-medium transition-colors cursor-default border": true,
        "border-icon-strong-base bg-surface-base-hover text-text-strong": props.active,
        "border-border-weak-base text-text-base hover:bg-surface-base-hover": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}
