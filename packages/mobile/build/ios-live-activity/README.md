# iOS Live Activity integration

These six source files implement the iOS-side of the mobile app's Live
Activities. The TypeScript half lives in
[`src/platform/live-activities.ts`](../../src/platform/live-activities.ts)
and the auto-trigger logic in
[`src/platform/task-monitor.ts`](../../src/platform/task-monitor.ts).

| File                                | Target                        | Status                                   |
| ----------------------------------- | ----------------------------- | ---------------------------------------- |
| `CodeplaneActivityAttributes.swift` | **Both** App + Widget targets | placed at `ios/App/Shared/`              |
| `LiveActivitiesPlugin.swift`        | App target                    | placed at `ios/App/App/plugins/…`        |
| `LiveActivitiesPlugin.m`            | App target                    | placed at `ios/App/App/plugins/…`        |
| `CodeplaneLiveActivityWidget.swift` | Widget Extension target       | placed at `ios/App/CodeplaneLiveActivityWidget/` |
| `LockScreenView.swift`              | Widget Extension target       | placed at `ios/App/CodeplaneLiveActivityWidget/` |
| `DynamicIslandViews.swift`          | Widget Extension target       | placed at `ios/App/CodeplaneLiveActivityWidget/` |

The Capacitor plugin name on both sides is **`CodeplaneLiveActivities`**
— do not rename without also updating
`registerPlugin<NativeLiveActivitiesPlugin>("CodeplaneLiveActivities")`
in [`src/platform/live-activities.ts`](../../src/platform/live-activities.ts)
and the `CAP_PLUGIN(CodeplaneLiveActivitiesPlugin, …)` macro in the
`.m` file.

The widget's `Info.plist` (also in `ios/App/CodeplaneLiveActivityWidget/`)
already declares the bundle as a `widgetkit-extension` and sets both
Live Activity keys — leave it alone after target creation.

## One-time Xcode setup

After `bun run --cwd packages/mobile cap:add:ios`, the files above are
already on disk but **none of them are members of any Xcode target
yet** (Capacitor doesn't know about them and the widget extension
target itself doesn't exist).

### Recommended — auto-wire (one command)

```sh
packages/mobile/build/ios-live-activity/wire-widget-target.sh
packages/mobile/build/ios-live-activity/verify-setup.sh
```

The first script uses the `xcodeproj` Ruby gem (already shipped with
Homebrew's `cocoapods`) to:

- Create the `CodeplaneLiveActivityWidget` extension target
- Add the App-side plugin (`.swift` + `.m`) to the App target's
  Compile Sources
- Add the three widget Swift files to the widget target
- Share `CodeplaneActivityAttributes.swift` between both targets
  (the IPC contract between processes)
- Configure the widget's Build Settings (iOS 16.2 deployment target,
  bundle ID `cc.codeplane.mobile.LiveActivityWidget`, Swift 5,
  signing inherited from the App target, `PRODUCT_NAME=$(TARGET_NAME)`)
- Add an *Embed App Extensions* copy phase to the App target so the
  `.appex` ships inside `App.app/PlugIns/`
- Add a target dependency from App → Widget so the build order is
  correct

The script is **idempotent** — re-run it after every `cap:sync` if
you ever add or rename a Live Activity source file.

The second script is the validator. It exits non-zero with a precise
hint if anything looks off (target missing, plugin name out of sync,
auto-generated boilerplate left over, etc.).

After both scripts pass, open the workspace and Build & Run:

```sh
open packages/mobile/ios/App/App.xcworkspace
```

You should be able to skip the manual UI walkthrough below — it's
documented as a fallback in case the auto-wire ever needs a one-off
tweak.

### Manual fallback — Xcode UI walkthrough

If you'd rather not run a script, here's what the script does, by
hand. Skip this section unless `wire-widget-target.sh` is unable to
run (no Homebrew cocoapods, etc.).

#### Step 1 — Open the workspace

```sh
open ios/App/App.xcworkspace
```

Always open the **`.xcworkspace`**, never the `.xcodeproj` — the
workspace is what knows about the CocoaPods.

#### Step 2 — Register the App-side plugin sources

In the project navigator, right-click the `App` group → **Add Files to
"App"…**, select both:

- `ios/App/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.swift`
- `ios/App/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.m`

Untick "Copy items if needed" (they're already inside the project
folder). In the *Add to targets* checklist, tick **App** only.

#### Step 3 — Register the shared attributes file

Same flow — right-click `App` → **Add Files to "App"…** →
`ios/App/Shared/CodeplaneActivityAttributes.swift`. For now tick
**App** only; we'll come back to add the widget target after step 4.

#### Step 4 — Create the Widget Extension target

**File → New → Target…** → search "Widget Extension" → Next.

| Field | Value |
| --- | --- |
| Product Name | `CodeplaneLiveActivityWidget` |
| Team | _whatever signs the App target_ |
| Bundle Identifier | `cc.codeplane.mobile.LiveActivityWidget` (auto-derived) |
| Language | Swift |
| **Include Live Activity** | ✅ **TICK THIS** — without it Xcode generates the wrong scaffolding |
| Include Configuration App Intent | ❌ leave unchecked |

Click Finish. When Xcode asks "Activate "CodeplaneLiveActivityWidget"
scheme?" — say **Activate**.

Xcode will have generated:

- `CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidget.swift`
- `CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidgetLiveActivity.swift`
- `CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidgetBundle.swift`
- `CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidgetAttributes.swift`
- `CodeplaneLiveActivityWidget/Info.plist`
- `CodeplaneLiveActivityWidget/Assets.xcassets`

**Delete all four `.swift` files Xcode just generated** (right-click →
Delete → "Move to Trash"). Then **delete the auto-generated
`Info.plist`** the same way — we have our own. Keep the
`Assets.xcassets`.

Now drag the three real files from Finder (or "Add Files to"…) into
the widget group, ensuring **Add to targets ✅
CodeplaneLiveActivityWidget** is the only tick:

- `ios/App/CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidget.swift`
- `ios/App/CodeplaneLiveActivityWidget/LockScreenView.swift`
- `ios/App/CodeplaneLiveActivityWidget/DynamicIslandViews.swift`
- `ios/App/CodeplaneLiveActivityWidget/Info.plist`

For the `Info.plist`: select the widget target → General → scroll to
**Info.plist File** and set it to `CodeplaneLiveActivityWidget/Info.plist`.

#### Step 5 — Share the attributes file with the widget

Click `CodeplaneActivityAttributes.swift` in the navigator → in the
**File Inspector** (right pane, first tab) → under *Target Membership*,
also tick **CodeplaneLiveActivityWidget**. This is the IPC contract
that ActivityKit uses to serialise state across the App↔Widget process
boundary, so it has to be in both targets.

#### Step 6 — Set the widget's deployment target

Select the **CodeplaneLiveActivityWidget** target → General → **Minimum
Deployments** → set iOS to `16.2`. Live Activities require 16.2+ for
the `ActivityContent` and `isStale` APIs we use; bumping the App
target's deployment target is **not** necessary — the widget is its
own bundle.

#### Step 7 — Build & run

`Cmd+R` on the **App** scheme (not the widget scheme). On the device
or simulator (iOS 16.2+), open an instance whose Codeplane server
emits the `codeplane:task` postMessage protocol described below.
Within ~12 s of a running task, or as soon as queue depth ≥ 3, the
Lock Screen and Dynamic Island should show the activity in monochrome
opencode style.

## Validation log breadcrumbs

Once running, filter Console / `xcrun simctl spawn booted log stream`
for `Codeplane.LA` to see the lifecycle:

| Log line | Means |
| --- | --- |
| `Codeplane.LA register ok` | TS bridge handshake succeeded |
| `Codeplane.LA start instance=…` | An activity was actually opened |
| `Codeplane.LA update id=… progress=…` | A throttled state update went through |
| `Codeplane.LA end id=… reason=completed\|failed\|stale` | Activity ended, either after the 4 s grace or because the task ended |
| `Codeplane.LA SKIPPED iOS<16.2` | Older OS; the activity is suppressed but the rest of the app is unaffected |

If `start` never fires for a session that should have triggered, check:

1. The instance has the **Live Activities** toggle on in the edit
   sheet.
2. Live Activities are enabled in iOS Settings → Codeplane → Live
   Activities.
3. The server is actually emitting `codeplane:task` postMessages —
   filter the same log for `Codeplane.TM` to see the task-monitor's
   own breadcrumbs.

## Visual preview without rebuilding the widget

Iterating on the SwiftUI design is slow because every change needs
a target-rebuild. To shortcut that, the picker has a hidden HTML
mockup of all five layouts (single running, duo running, duo three+,
completed, failed) using the same colour tokens and typography as the
real widget. Reach it during `bun run dev`:

```
http://localhost:5182/#la-preview
```

Anything you change in the SwiftUI files should also be mirrored in
[`src/screens/live-activity-preview.tsx`](../../src/screens/live-activity-preview.tsx)
so the two stay in lock-step.

## postMessage protocol the activity reads

The instance UI inside the embedded webview talks to the outer mobile
shell with `window.parent.postMessage(...)`:

```ts
window.parent.postMessage(
  {
    type: "codeplane:task",
    taskId: "abc123",
    phase: "running",          // queued | running | completed | failed
    queueDepth: 4,             // messages still pending
    currentMessage: "Refactoring auth middleware…",
    progress: 0.38,            // 0..1, or null if unknown
    startedAt: "2026-05-06T12:00:00Z",
    elapsedSeconds: 134,       // optional server-authoritative
    turns: 3,                  // turns taken so far (optional)
  },
  "*",
)
```

The mobile shell ingests these on the iframe's `message` channel and
maps them to ActivityKit lifecycle calls. The user opts in or out per
instance via the **Live Activities** toggle in the instance edit
sheet.

## Why this design

- **One activity per instance, top-2 tasks.** ActivityKit caps you at
  8 active activities total per app, and stacking many for a single
  instance would clutter the Lock Screen. The task-monitor opens
  exactly one activity per instance and packs the *primary* (longest
  running) and *secondary* (next longest) tasks into it. A
  `+N more running` footer surfaces hidden tasks. See `selectTopTwo`
  in `task-monitor.ts`.
- **Two-process split.** The plugin runs in the App target so it can
  call `Activity<>.request(...)`. The Widget Extension runs in a
  separate process under SwiftUI; it can only render. That's why
  `CodeplaneActivityAttributes.swift` is shared — it's the shape that
  serialises across the IPC.
- **Monochrome.** Picker is monochrome (commit `b809f468b`) so the
  widget palette mirrors that — `--text-strong` for primary glyphs,
  `--text-weak` for meta. The single chromatic concession is the
  failure-state alert glyph (`codeplaneFailure`); a triangle alert in
  monochrome reads less urgent than the ~5 px of red here.
- **Honest progress.** When `progress` is null we render an
  indeterminate striped bar instead of "0% forever" — the Lock Screen
  has motion, which beats lying about progress.
- **Non-iOS / iOS < 16.2.** Both the JS bridge and the
  `@available(iOS 16.2, *)` Swift gates resolve to no-ops; nothing
  crashes, the toggle just stays unavailable.
- **Push updates.** `registerForUpdates` is wired up but currently
  resolves with a `null` token — a follow-up can hook it to APNs so
  the activity stays fresh while the app is suspended. See the
  iOS 17.2+ `pushToStartTokenUpdates` block in
  `LiveActivitiesPlugin.swift`.

## Android note

Live Activities are iOS-only. On Android, the equivalent surface is a
foreground-service ongoing notification with a custom layout
(`MediaStyle`-class). That's not implemented here — the JS bridge
returns false on Android so the toggle hides itself in the form, and
no postMessage events are forwarded.
