import { Component, For, Show, createSignal, onCleanup } from "solid-js"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { RightChevron } from "./mobile-header"
import type { UICacheAPI, UICacheEntry } from "../platform/ui-cache"
import type { AssetCacheAPI, AssetCacheRecord, AssetCacheProgress } from "../platform/asset-cache"
import { formatCacheBytes } from "../platform/asset-cache"

/**
 * Touch-friendly list of saved instances.
 *
 * Each row is a 64px card with the favicon on the left, the label
 * + URL stacked in the middle, and a chevron on the right indicating
 * the row navigates. Long-press (context menu) is bound by the parent
 * to surface the edit sheet.
 *
 * Visual language:
 *   - "Update available" chip when the UI cache module has detected a
 *     newer version on the server than the user last opened.
 *   - "Downloading X%" chip while the asset cache is crawling the new
 *     version — pure progress, swaps in for "Update available" while
 *     active.
 *   - "Cached X MB" chip once the bytes are on disk (phase 2a) — sets
 *     the user's expectation that the next launch is offline-fast even
 *     before phase 2b's `WKURLSchemeHandler` lands.
 *   - "Auth" + "Last opened" — muted informational labels.
 */
const FALLBACK_HOST_ICON = (host: string) =>
  // Tiny SVG badge with the first letter of the host. Keeps us free of
  // network requests while still rendering something instance-specific.
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>
      <rect width='40' height='40' rx='10' fill='#1c2026'/>
      <text x='50%' y='54%' font-family='-apple-system,Helvetica,Arial' font-size='18' font-weight='600' fill='#cfd6df' text-anchor='middle' dominant-baseline='middle'>${(
        host[0] ?? "?"
      ).toUpperCase()}</text>
    </svg>`,
  )}`

const hostFor = (url: string) => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export const InstanceList: Component<{
  instances: SavedInstance[]
  lastId?: string
  /** UI-cache module — drives the "Update available" badge. */
  uiCache: UICacheAPI
  /**
   * Asset-cache module — drives the "Downloading…" / "Cached X MB"
   * chips. Pulled in alongside `uiCache` so each row owns one
   * concentrated cache-state surface (status + progress + size).
   */
  assetCache: AssetCacheAPI
  onOpen: (instance: SavedInstance) => void
  onEdit: (instance: SavedInstance) => void
}> = (props) => {
  return (
    <Show when={props.instances.length > 0} fallback={null}>
      <ul
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "10px",
          padding: "12px 16px 24px",
          margin: 0,
          "list-style": "none",
        }}
      >
        <For each={props.instances}>
          {(instance) => {
            const host = hostFor(instance.url)
            const hasHeaders = !!instance.headers && Object.keys(instance.headers).length > 0
            const isLast = () => instance.id === props.lastId
            const icon = instance.iconDataUrl ?? FALLBACK_HOST_ICON(host)

            // UI-cache record (version-aware metadata) +
            // asset-cache record (bytes-on-disk metadata) + live
            // download progress, all subscribed once per row.
            //
            // Subscriptions are torn down via a single `onCleanup`
            // call (rather than three) so the row's cleanup graph
            // matches Solid's per-row owner exactly — multiple
            // staggered `onCleanup` calls inside the For body had
            // been triggering "cleanups created outside a
            // createRoot or render" warnings under HMR.
            const [uiEntry, setUiEntry] = createSignal<UICacheEntry | null>(null)
            const [assetRecord, setAssetRecord] = createSignal<AssetCacheRecord | null>(null)
            const [assetProgress, setAssetProgress] = createSignal<AssetCacheProgress | null>(null)
            void props.uiCache.get(instance.id).then((entry) => {
              if (entry) setUiEntry(entry)
            })
            void props.assetCache.get(instance.id).then((rec) => {
              if (rec) setAssetRecord(rec)
            })
            const offUi = props.uiCache.subscribe(instance.id, setUiEntry)
            const offRecord = props.assetCache.subscribeRecord(instance.id, setAssetRecord)
            const offProgress = props.assetCache.subscribeProgress(instance.id, (p) => {
              setAssetProgress(p)
              // Once the crawl reports `done` or `error` the record
              // listener has the authoritative state — drop the
              // progress-only signal so the chip falls back to the
              // record-derived label.
              if (p.phase === "done" || p.phase === "error") {
                queueMicrotask(() => {
                  if (assetProgress() === p) setAssetProgress(null)
                })
              }
            })
            onCleanup(() => {
              offUi()
              offRecord()
              offProgress()
            })

            const downloading = () => {
              const progress = assetProgress()
              if (progress && (progress.phase === "download" || progress.phase === "save")) {
                return progress
              }
              if (assetRecord()?.status === "downloading") return null // record knows it but we don't have % yet
              return undefined
            }

            return (
              <li>
                <button
                  type="button"
                  class="mobile-card"
                  aria-label={`Open ${instance.label || host}`}
                  onClick={() => props.onOpen(instance)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    props.onEdit(instance)
                  }}
                >
                  <img src={icon} alt="" width={40} height={40} class="mobile-card__icon" />
                  <div class="mobile-card__body">
                    <div class="mobile-card__title">{instance.label || host}</div>
                    <div class="mobile-card__url">{instance.url}</div>
                    <Show
                      when={
                        hasHeaders ||
                        isLast() ||
                        uiEntry()?.state === "stale" ||
                        downloading() !== undefined ||
                        assetRecord()?.status === "ready"
                      }
                    >
                      <div class="mobile-card__meta">
                        {/* Cache status chip — one of three states,
                            in priority order: downloading > stale >
                            ready. */}
                        <Show
                          when={downloading()}
                          keyed
                          fallback={
                            <Show
                              when={uiEntry()?.state === "stale"}
                              fallback={
                                <Show when={assetRecord()?.status === "ready"}>
                                  <span
                                    class="mobile-card__chip"
                                    data-tone="muted"
                                    title={`UI cached locally — ${assetRecord()?.assetCount ?? 0} files`}
                                  >
                                    Cached {formatCacheBytes(assetRecord()?.totalBytes ?? 0)}
                                  </span>
                                </Show>
                              }
                            >
                              <span
                                class="mobile-card__chip"
                                data-indicator="dot"
                                title={
                                  uiEntry()?.remoteVersion
                                    ? `Newer version on server: ${uiEntry()?.remoteVersion}`
                                    : "A newer version of this instance is available"
                                }
                              >
                                Update available
                              </span>
                            </Show>
                          }
                        >
                          {(progress) => (
                            <span
                              class="mobile-card__chip"
                              data-indicator="dot"
                              title={progress.message}
                            >
                              Downloading {progress.percent}%
                            </span>
                          )}
                        </Show>
                        {/* Informational chips — muted variant, no
                            border, no dot. */}
                        <Show when={hasHeaders}>
                          <span class="mobile-card__chip" data-tone="muted" title="Auth headers configured">
                            Auth
                          </span>
                        </Show>
                        <Show when={isLast()}>
                          <span class="mobile-card__chip" data-tone="muted">
                            Last opened
                          </span>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <span class="mobile-card__chevron" aria-hidden>
                    <RightChevron />
                  </span>
                </button>
              </li>
            )
          }}
        </For>
      </ul>
    </Show>
  )
}
