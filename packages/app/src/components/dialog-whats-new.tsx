import { Component, Show, createMemo } from "solid-js"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Markdown } from "@codeplane-ai/ui/markdown"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import type { ReleaseNotes } from "@/context/updates"

function formatDate(iso: string | null, locale: string | undefined) {
  if (!iso) return undefined
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return undefined
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d)
  } catch {
    return undefined
  }
}

export const DialogWhatsNew: Component<{ notes: ReleaseNotes; previousVersion?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()

  const version = createMemo(() => props.notes.tag.replace(/^v/, ""))
  const body = createMemo(() => props.notes.body?.trim() || "")
  const published = createMemo(() => formatDate(props.notes.publishedAt, language.locale()))

  return (
    <Dialog
      size="large"
      transition
      title={
        <div class="flex items-center gap-3 -my-1">
          <span
            data-component="whats-new-icon"
            class="flex size-8 items-center justify-center rounded-full bg-surface-interactive-base text-text-on-interactive shadow-sm ring-1 ring-inset ring-border-interactive-base/40"
          >
            <Icon name="sparkle" size="small" />
          </span>
          <span class="flex flex-col leading-tight gap-0.5">
            <span class="text-16-medium text-text-strong">
              {language.t("dialog.whatsNew.title", { version: version() })}
            </span>
            <span class="text-12-regular text-text-weak inline-flex items-center gap-2">
              <Show
                when={props.previousVersion}
                keyed
                fallback={
                  <Show when={published()}>
                    <span>{published()}</span>
                  </Show>
                }
              >
                {(prev) => (
                  <span class="inline-flex items-center gap-1.5">
                    <span class="rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-11-regular text-text-base">
                      v{prev}
                    </span>
                    <Icon name="arrow-right" size="x-small" class="text-icon-weak" />
                    <span class="rounded bg-surface-interactive-base-subtle px-1.5 py-0.5 font-mono text-11-regular text-text-interactive">
                      v{version()}
                    </span>
                  </span>
                )}
              </Show>
            </span>
          </span>
        </div>
      }
    >
      <div data-component="whats-new" class="flex h-full min-h-0 flex-col">
        <div data-component="whats-new-divider" class="shrink-0 border-t border-border-weak-base" />

        <div data-component="whats-new-body" class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <Show
            when={body()}
            fallback={
              <div class="flex h-full items-center justify-center px-6 text-center text-13-regular text-text-weak">
                {language.t("dialog.whatsNew.empty")}
              </div>
            }
          >
            <Markdown text={body()} class="whats-new-markdown" />
          </Show>
        </div>

        <div
          data-component="whats-new-footer"
          class="flex shrink-0 items-center justify-between gap-3 border-t border-border-weak-base px-6 py-3"
        >
          <Show when={props.notes.url} keyed fallback={<span />}>
            {(url) => (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-13-medium text-text-interactive hover:underline"
              >
                <span>{language.t("dialog.whatsNew.action.viewFull")}</span>
                <Icon name="square-arrow-top-right" size="x-small" />
              </a>
            )}
          </Show>
          <Button type="button" variant="primary" size="small" onClick={() => dialog.close()}>
            {language.t("dialog.whatsNew.action.dismiss")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
