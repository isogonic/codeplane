import { Component, Show, createMemo } from "solid-js"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Button } from "@codeplane-ai/ui/button"
import { Markdown } from "@codeplane-ai/ui/markdown"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import type { ReleaseNotes } from "@/context/updates"

export const DialogWhatsNew: Component<{ notes: ReleaseNotes; previousVersion?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const title = createMemo(() => {
    const v = props.notes.tag.replace(/^v/, "")
    return language.t("dialog.whatsNew.title", { version: v })
  })
  const subtitle = createMemo(() => {
    if (!props.previousVersion) return undefined
    return language.t("dialog.whatsNew.subtitle", {
      previous: props.previousVersion,
      current: props.notes.tag.replace(/^v/, ""),
    })
  })
  const body = createMemo(() => props.notes.body?.trim() || language.t("dialog.whatsNew.empty"))

  return (
    <Dialog title={title()} description={subtitle()} size="large">
      <div class="flex flex-col gap-4 min-h-0">
        <div class="flex-1 min-h-0 overflow-y-auto pr-2">
          <Markdown text={body()} />
        </div>
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-border-base">
          <Show when={props.notes.url}>
            {(url) => (
              <a
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                class="text-13-regular text-text-interactive hover:underline"
              >
                {language.t("dialog.whatsNew.action.viewFull")}
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
