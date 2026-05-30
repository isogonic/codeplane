import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  createSortable,
} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { Button } from "@codeplane-ai/ui/button"
import { DockTray } from "@codeplane-ai/ui/dock-surface"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { useLanguage } from "@/context/language"

type Item = { id: string; text: string }

interface RowControls {
  sending?: string
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Inner contents of every row — the text + action buttons. Pulled out so
 * the draggable and static variants share a single source of layout truth
 * (any future change to button order, copy, etc lives in one place).
 *
 * Pointer events on the buttons are stopped at the source so a
 * surrounding `use:sortable` can't interpret a button-click as the start
 * of a drag — without that, clicking Send/Edit/Trash near the top of the
 * row would briefly translate the row before the click resolved.
 */
function RowContents(props: { item: Item } & RowControls) {
  const language = useLanguage()
  // Wrap each interactive control in a span that swallows pointerdown.
  // Kobalte's Button doesn't surface `onPointerDown` through its prop
  // type cleanly, and we don't actually need it on the button itself —
  // catching the event on the wrapper is enough to stop the surrounding
  // sortable from interpreting a click as a drag.
  const swallow = (event: PointerEvent) => event.stopPropagation()
  return (
    <>
      <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">{props.item.text}</span>
      <span class="shrink-0" onPointerDown={swallow}>
        <Button
          size="small"
          variant="secondary"
          disabled={!!props.sending}
          onClick={() => props.onSend(props.item.id)}
        >
          {language.t("session.followupDock.sendNow")}
        </Button>
      </span>
      <span class="shrink-0" onPointerDown={swallow}>
        <Button size="small" variant="ghost" disabled={!!props.sending} onClick={() => props.onEdit(props.item.id)}>
          {language.t("session.followupDock.edit")}
        </Button>
      </span>
      <span class="shrink-0" onPointerDown={swallow}>
        <IconButton
          icon="trash"
          variant="ghost"
          disabled={!!props.sending}
          onClick={() => props.onDelete(props.item.id)}
          aria-label={language.t("common.delete")}
        />
      </span>
    </>
  )
}

/**
 * Draggable row — only mounted inside DragDropProvider/SortableProvider.
 * `createSortable` registers this row's id with the surrounding provider
 * so it acts as both source and drop target.
 */
function DraggableRow(props: { item: Item } & RowControls) {
  const sortable = createSortable(props.item.id)
  return (
    <div
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      use:sortable
      class="flex items-center gap-2 min-w-0 py-1 transition-opacity"
      classList={{
        "opacity-50": sortable.isActiveDraggable,
        "cursor-grab active:cursor-grabbing": !props.sending,
      }}
    >
      <span
        aria-hidden="true"
        class="shrink-0 text-text-weak hover:text-text-base"
        style={{ "touch-action": "none" }}
        onClick={(event) => event.stopPropagation()}
      >
        <Icon name="chevron-grabber-vertical" size="small" />
      </span>
      <RowContents
        item={props.item}
        sending={props.sending}
        onSend={props.onSend}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    </div>
  )
}

function StaticRow(props: { item: Item } & RowControls) {
  return (
    <div class="flex items-center gap-2 min-w-0 py-1">
      <RowContents
        item={props.item}
        sending={props.sending}
        onSend={props.onSend}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    </div>
  )
}

export function SessionFollowupDock(props: {
  items: Item[]
  sending?: string
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  /**
   * Called with the new id order whenever a drag moves the active row past
   * a sibling — same live-reorder pattern as the file-tab strip. Omit to
   * disable drag affordances (single-item lists, or callers that don't
   * persist order). When `sending` is set, `onReorder` is still called but
   * the upstream handler skips the update — the visual cue for "can't
   * reorder right now" is unchanged layout, not a swap to the static row,
   * to avoid the dock jumping the moment a send starts.
   */
  onReorder?: (ids: string[]) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
  })

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() =>
    language.t(total() === 1 ? "session.followupDock.summary.one" : "session.followupDock.summary.other", {
      count: total(),
    }),
  )
  const preview = createMemo(() => props.items[0]?.text ?? "")

  // Reorder is offered only when the parent supplied a handler AND there
  // are at least two items — single-item drag is pure friction. Memoised
  // so the dock doesn't toggle DragDropProvider on/off mid-render when the
  // queue empties.
  const reorderable = createMemo(() => !!props.onReorder && props.items.length > 1)
  const ids = createMemo(() => props.items.map((entry) => entry.id))

  const handleDragOver = (event: DragEvent) => {
    if (!props.onReorder) return
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const fromID = String(draggable.id)
    const toID = String(droppable.id)
    if (fromID === toID) return

    const order = ids()
    const fromIdx = order.indexOf(fromID)
    const toIdx = order.indexOf(toID)
    if (fromIdx === -1 || toIdx === -1) return

    // Splice into a fresh array — mutating in place would defeat
    // reactivity on the upstream `items` prop.
    const next = order.slice()
    next.splice(fromIdx, 1)
    next.splice(toIdx, 0, fromID)
    props.onReorder(next)
  }

  return (
    <DockTray
      data-component="session-followup-dock"
      style={{
        // This dock is lifted over the todo dock (negative margin + z-10 in
        // session-composer-region). The shared tray background is only ~70%
        // opaque, which let the todo panel text bleed through. Force a fully
        // opaque background here so the overlap reads as a solid surface.
        "background-color": "var(--muted)",
        "margin-bottom": "-0.875rem",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <div
        class="pl-3 pr-2 py-2 flex items-center gap-2"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="shrink-0 text-13-medium text-text-strong cursor-default">{label()}</span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate text-13-regular text-text-base cursor-default">{preview()}</span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButton
            data-collapsed={store.collapsed ? "true" : "false"}
            icon="chevron-down"
            size="normal"
            variant="ghost"
            style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            aria-label={
              store.collapsed ? language.t("session.followupDock.expand") : language.t("session.followupDock.collapse")
            }
          />
        </div>
      </div>

      <Show when={store.collapsed}>
        <div class="h-5" aria-hidden="true" />
      </Show>

      <Show when={!store.collapsed}>
        <div class="px-3 pb-7 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar">
          <Show
            when={reorderable()}
            fallback={
              <For each={props.items}>
                {(item) => (
                  <StaticRow
                    item={item}
                    sending={props.sending}
                    onSend={props.onSend}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                  />
                )}
              </For>
            }
          >
            <DragDropProvider onDragOver={handleDragOver} collisionDetector={closestCenter}>
              <DragDropSensors />
              <ConstrainDragXAxis />
              <SortableProvider ids={ids()}>
                <For each={props.items}>
                  {(item) => (
                    <DraggableRow
                      item={item}
                      sending={props.sending}
                      onSend={props.onSend}
                      onEdit={props.onEdit}
                      onDelete={props.onDelete}
                    />
                  )}
                </For>
              </SortableProvider>
            </DragDropProvider>
          </Show>
        </div>
      </Show>
    </DockTray>
  )
}
