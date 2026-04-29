import { createMemo, For, Show } from "solid-js"
import { A } from "@solidjs/router"
import { DateTime } from "luxon"
import { getFilename } from "@codeplane-ai/shared/util/path"
import { Button } from "@codeplane-ai/ui/button"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification, type Notification as AppNotification } from "@/context/notification"
import { sessionTitle } from "@/utils/session-title"
import { notificationHref } from "./notifications-utils"

export default function Notifications() {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const notification = useNotification()
  const items = createMemo(() =>
    notification
      .all()
      .slice()
      .sort((a, b) => b.time - a.time),
  )

  const projectName = (item: AppNotification) => (item.directory ? getFilename(item.directory) : "codeplane")
  const sessionName = (item: AppNotification) => {
    if (!item.directory || !item.session || item.session === "global") return projectName(item)
    const liveTitle = globalSync
      .child(item.directory, { bootstrap: false })[0]
      .session.find((session) => session.id === item.session)?.title
    const title = sessionTitle(liveTitle ?? item.sessionTitle ?? "")
    if (title) return title
    return language.t("notification.session.untitled")
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
  const markViewed = (item: AppNotification) => {
    if (item.session && item.session !== "global") {
      notification.session.markViewed(item.session)
      return
    }
    if (item.directory) {
      notification.project.markViewed(item.directory)
    }
  }
  const content = (item: AppNotification) => (
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
  )
  const actionClass =
    "group flex w-full min-w-0 rounded-md px-3 py-3 text-left transition-colors hover:bg-surface-raised-base-hover focus:outline-none focus-visible:bg-surface-raised-base-hover"

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
              {(item) => {
                const target = notificationHref(item)
                return (
                  <li class="border-b border-border-weak-base last:border-b-0">
                    <Show
                      when={target}
                      keyed
                      fallback={
                        <button
                          type="button"
                          class={actionClass}
                          classList={{ "bg-surface-base-active": !item.viewed }}
                          onClick={() => markViewed(item)}
                        >
                          {content(item)}
                        </button>
                      }
                    >
                      {(target) => (
                        <A
                          href={target}
                          class={actionClass}
                          classList={{ "bg-surface-base-active": !item.viewed }}
                          onClick={() => markViewed(item)}
                        >
                          {content(item)}
                        </A>
                      )}
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}
