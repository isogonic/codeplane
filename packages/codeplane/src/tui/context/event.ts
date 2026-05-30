import type { EventAugmented as Event } from "@/tui/_compat/sdk-v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"
import { shouldDeliverEvent } from "@/tui/util/event-routing"

type LooseEvent<Type extends string> = Type extends Event["type"]
  ? Extract<Event, { type: Type }>
  : { type: Type; properties: Record<string, any> }

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      // The runtime SDK event union narrows to the SDK's `Event`; we expose
      // it as the augmented type (with `id` + extra session.next.* variants)
      // because the underlying server emits those richer payloads.
      const payload = event.payload as unknown as Event

      // Deliver events for the current view, matching on EITHER the active
      // workspace OR the instance directory. The directory fallback is what
      // keeps streaming smooth: live deltas emitted by the prompt-queue worker
      // are stamped `workspace: undefined`, so a workspace-scoped session would
      // otherwise drop every delta and only refresh via the 10s poll — the
      // "TUI updates only every ~15s during streaming" bug. See
      // `shouldDeliverEvent` for the full rationale.
      if (
        shouldDeliverEvent({
          directory: event.directory,
          eventWorkspace: event.workspace,
          currentWorkspace: project.workspace.current(),
          instanceDirectory: project.instance.directory(),
        })
      ) {
        handler(payload)
      }
    })
  }

  // Strict for SDK events (narrows on `type` literal), structural for
  // TUI-local events defined via `BusEvent.define` outside the SDK union.
  // Mirror `TuiEventBus.on` from `@codeplane-ai/plugin/tui` so this dispatch
  // surface is interchangeable with the plugin-facing one.
  function on<Type extends string>(type: Type, handler: (event: LooseEvent<Type>) => void) {
    return subscribe((event) => {
      if (event.type !== type) return
      handler(event as LooseEvent<Type>)
    })
  }

  return {
    subscribe,
    on,
  }
}
