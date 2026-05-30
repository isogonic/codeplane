// Decides whether a live event from the global stream belongs to the view the
// TUI is currently showing.
//
// History / why the directory fallback matters: a workspace-scoped session
// sets `currentWorkspace` to the session's workspaceID, but the streaming
// deltas emitted while a prompt runs are stamped `eventWorkspace: undefined`
// (the prompt-queue worker re-enters the instance with only the directory and
// never restores the workspace). The previous logic required an exact
// workspace match and returned early, so every delta was silently dropped and
// the session only refreshed via the 10s active-session poll — the
// "TUI only updates every ~15s during streaming" bug. Matching on EITHER the
// active workspace OR the instance directory delivers those deltas live while
// still isolating events from other instances.
export function shouldDeliverEvent(input: {
  directory: string
  eventWorkspace: string | undefined
  currentWorkspace: string | undefined
  instanceDirectory: string
}): boolean {
  // Truly global events are always delivered.
  if (input.directory === "global") return true
  // Scoped to the active workspace when one is selected.
  if (input.currentWorkspace && input.eventWorkspace === input.currentWorkspace) return true
  // Fallback: same instance directory ⇒ same view (covers events that carry
  // no / a stale workspace stamp).
  return input.directory === input.instanceDirectory
}
