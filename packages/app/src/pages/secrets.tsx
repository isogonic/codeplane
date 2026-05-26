import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import type { ConfigSecretEntry } from "@codeplane-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

type SecretEntry = ConfigSecretEntry

export function SecretsSettings(props: { layout?: "dialog" | "page" } = {}) {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const page = () => props.layout === "page"

  const [entries, actions] = createResource<SecretEntry[]>(async () => {
    const result = await globalSDK.client.global.secrets.list().catch(() => null)
    return result?.data ?? []
  })

  const list = createMemo(() => (entries() ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))

  const remove = useMutation(() => ({
    mutationFn: async (name: string) => {
      await globalSDK.client.global.secrets.remove({ name })
      await actions.refetch()
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("secrets.toast.removed"),
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

  const openEditor = (entry?: SecretEntry) => {
    dialog.show(() => <SecretEditorDialog entry={entry} onSaved={() => void actions.refetch()} />)
  }

  const updatedAt = (value: number) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))

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
            <div class="text-20-medium text-text-strong truncate">{language.t("secrets.page.title")}</div>
            <div class="text-12-regular text-text-weak">{language.t("secrets.page.note")}</div>
          </div>
        </Show>
        <Button variant="primary" size="large" icon="plus-small" onClick={() => openEditor()}>
          {language.t("secrets.page.add")}
        </Button>
      </div>

      <Show
        when={list().length > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {language.t("secrets.page.empty")}
          </div>
        }
      >
        <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
          <For each={list()}>
            {(entry) => (
              <li class="border-b border-border-weak-base last:border-b-0">
                <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <Icon name="shield" size="small" class="icon-strong-base shrink-0" />
                      <span class="truncate text-14-medium text-text-strong">{entry.name}</span>
                    </div>
                    <div class="mt-0.5 truncate font-mono text-11-regular text-text-weak">{entry.placeholder}</div>
                    <div class="mt-1 text-11-regular text-text-weaker">{updatedAt(entry.updated_at)}</div>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <IconButton
                      icon="edit"
                      variant="ghost"
                      size="normal"
                      aria-label={language.t("common.edit")}
                      onClick={() => openEditor(entry)}
                    />
                    <IconButton
                      icon="trash"
                      variant="ghost"
                      size="normal"
                      aria-label={language.t("common.delete")}
                      onClick={() => {
                        if (!window.confirm(language.t("secrets.page.confirm.remove", { name: entry.name }))) return
                        remove.mutate(entry.name)
                      }}
                    />
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  )
}

type SecretEditorState = {
  name: string
  value: string
  errors: {
    name?: string
    value?: string
  }
}

function SecretEditorDialog(props: { entry?: SecretEntry; onSaved?: () => void }) {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const isEdit = !!props.entry

  const [form, setForm] = createStore<SecretEditorState>({
    name: props.entry?.name ?? "",
    value: "",
    errors: {},
  })

  const validate = () => {
    const errors: SecretEditorState["errors"] = {}
    if (!form.name.trim()) errors.name = language.t("secrets.editor.name.error")
    if (!form.value.trim()) errors.value = language.t("secrets.editor.value.error")
    setForm("errors", errors)
    return Object.keys(errors).length === 0
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) return
      await globalSDK.client.global.secrets.set({
        name: form.name.trim(),
        value: form.value,
      })
      props.onSaved?.()
      dialog.close()
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("secrets.toast.saved"),
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

  const submit = (e: SubmitEvent) => {
    e.preventDefault()
    if (save.isPending) return
    save.mutate()
  }

  return (
    <Dialog
      title={language.t(isEdit ? "secrets.editor.title.edit" : "secrets.editor.title.add")}
      class="w-full max-w-[520px] mx-auto"
      fit
    >
      <form onSubmit={submit} class="flex flex-col gap-5 px-6 pt-0 pb-5">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus={!isEdit}
            label={language.t("secrets.editor.name")}
            placeholder="github"
            value={form.name}
            onChange={(value) =>
              batch(() => {
                setForm("name", value)
                setForm("errors", "name", undefined)
              })
            }
            error={form.errors.name}
            disabled={isEdit}
            spellcheck={false}
            class="font-mono text-xs"
          />

          <TextField
            autofocus={isEdit}
            type="password"
            label={language.t("secrets.editor.value")}
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

export default function SecretsPage() {
  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <SecretsSettings />
      </div>
    </div>
  )
}
