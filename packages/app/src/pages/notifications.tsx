import { createMemo, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { DateTime } from "luxon"
import { base64Encode } from "@opencode-ai/shared/util/encode"
import { getFilename } from "@opencode-ai/shared/util/path"
import { Button } from "@opencode-ai/ui/button"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification, type Notification as AppNotification } from "@/context/notification"
import { sessionTitle } from "@/utils/session-title"

export default function Notifications() {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const navigate = useNavigate()
  const notification = useNotification()
  const items = createMemo(() =>
    notification
      .all()
      .slice()
      .sort((a, b) => b.time - a.time),
  )

  const projectName = (item: AppNotification) => (item.directory ? getFilename(item.directory) : "opencode")
  const href = (item: AppNotification) => {
    if (!item.directory) return
    const slug = base64Encode(item.directory)
    if (item.session && item.session !== "global") return `/${slug}/session/${item.session}`
    return `/${slug}`
  }
  const sessionName = (item: AppNotification) => {
    if (!item.directory || !item.session || item.session === "global") return projectName(item)
    return (
      sessionTitle(
        globalSync.child(item.directory, { bootstrap: false })[0].session.find((session) => session.id === item.session)
          ?.title ?? item.session,
      ) ?? item.session
    )
  }
  const errorDescription = (item: AppNotification) => {
    if (item.type !== "error") {
      return language.t("notification.center.item.responseReady", {
        sessionTitle: sessionName(item),
        projectName: projectName(item),
      })
    }
    if (!item.error) return language.t("notification.session.error.fallbackDescription")
    if ("message" in item.error.data && typeof item.error.data.message === "string") return item.error.data.message
    return item.error.name
  }
  const open = (item: AppNotification) => {
    if (item.session && item.session !== "global") {
      notification.session.markViewed(item.session)
    } else if (item.directory) {
      notification.project.markViewed(item.directory)
    }

    const target = href(item)
    if (!target) return
    navigate(target)
  }

  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8">
        <div class="shrink-0 flex items-center justify-between gap-4 border-b border-border-weak-base pb-4">
          <div class="min-w-0">
            <div class="text-20-medium text-text-strong truncate">{language.t("notification.center.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("notification.center.count", { count: items().length })}
            </div>
          </div>
          <Show when={notification.unseenCount() > 0}>
            <Button variant="ghost" onClick={notification.markAllViewed}>
              {language.t("notification.center.markAllRead")}
            </Button>
          </Show>
        </div>

        <Show
          when={items().length > 0}
          fallback={
            <div class="flex flex-1 items-center justify-center px-6 text-center">
              <div class="flex max-w-60 flex-col items-center gap-3">
                <div class="text-14-medium text-text-strong">{language.t("notification.center.empty.title")}</div>
              </div>
            </div>
          }
        >
          <ul class="mt-3 flex flex-col">
            <For each={items()}>
              {(item) => (
                <li class="border-b border-border-weak-base last:border-b-0">
                  <button
                    type="button"
                    class="group flex w-full min-w-0 rounded-md px-3 py-3 text-left transition-colors hover:bg-surface-raised-base-hover focus:outline-none focus-visible:bg-surface-raised-base-hover"
                    classList={{ "bg-surface-base-active": !item.viewed }}
                    onClick={() => open(item)}
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="truncate text-14-medium text-text-strong">
                          {item.type === "error"
                            ? language.t("notification.session.error.title")
                            : language.t("notification.session.responseReady.title")}
                        </span>
                        <Show when={!item.viewed}>
                          <span class="size-1.5 shrink-0 rounded-full bg-text-interactive-base" />
                        </Show>
                      </div>
                      <div class="mt-0.5 truncate text-12-regular text-text-base">{errorDescription(item)}</div>
                      <div class="mt-1 flex min-w-0 items-center gap-2 text-12-regular text-text-weak">
                        <span class="truncate">{projectName(item)}</span>
                        <span class="shrink-0">{DateTime.fromMillis(item.time).toRelative()}</span>
                      </div>
                    </div>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}
