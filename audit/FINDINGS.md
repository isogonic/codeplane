# CodePlane Web App — Full UI Audit

**URL tested:** http://localhost:3001/
**Date:** 2026-04-29
**Browser:** Chromium (Playwright) at 1440x900, also tested 1024x700 + 375x800
**Locale:** Deutsch (default)
**Screenshots:** see `audit/*.png` (01–46)

---

## 🔴 CRITICAL — broken or actively wrong

### C1. Toast: `[object Object]` shown to user
- **Where:** Status popover (top-right toolbar) or any failed request
- **What:** Toast title is "Anfrage fehlgeschlagen", body literally renders `[object Object]`. Classic missing `JSON.stringify` / error formatter.
- **Screenshot:** `audit/07-status-popover.png`

### C2. Mobile menu hides ALL content
- **Where:** ≤ 375 px viewport, hamburger icon in title bar (`Menü umschalten`)
- **What:** Clicking the menu button collapses the sidebar **and** blanks the entire main content area. The right pane becomes empty white. Only the sidebar icon strip remains.
- **Screenshot:** `audit/36-mobile-menu.png`
- This is the only nav method on small screens, so it's a hard block.

### C3. Notifications show raw session IDs instead of titles
- **Where:** `/notifications`
- **What:** Items like *"ses_227f6653bffeuNT883ru4dG1NE in opencode ist bereit"* — the user sees a 32-char ULID instead of the session title. Other items in the same list correctly show "New session in Development ist bereit", so the data join is missing/inconsistent.
- **Screenshot:** `audit/28-notifications.png`

### C4. Spam toasts re-firing forever
- **Where:** Project view (no session selected), `~/Development`
- **What:** A persistent prompt draft (`hi`) plus a missing model triggers the auto-send guard repeatedly. Result: stacked toasts *"Wählen Sie einen Agenten und ein Modell"* (3+ stacked) every few seconds with no obvious user action.
- **Screenshot:** `audit/39-context-menu.png`
- Also: same pattern produces "Fehler beim Neuladen von Development / temp_snake_game / Repos — Unbekannter Fehler" stacked toasts on session load.
- **Screenshots:** `audit/06-session-detail.png`, `audit/33-dark-session.png`

### C5. Backend 500-spam on bootstrap
- Console shows continuous `500` responses from `localhost:4096/global/version`, `/agent`, `/vcs`, `/command` endpoints, plus `[global-sdk] event stream error` and `Failed to finish bootstrap instance {name: UnknownError}`. Those errors then become the toast in C4.

### C6. Placeholder URL leaking into production code path
- Console: `Failed to load resource: net::ERR_NAME_NOT_RESOLVED @ https://example.invalid/changelog.json`
- A literal `example.invalid` host is being requested. Either the changelog URL was never wired up or a default placeholder shipped.

### C7. Command palette shortcut is broken on `/` (home)
- `⌘⇧P` (`Befehlspalette`) does nothing on the home and notifications routes. It only works inside a project/session route (where it opens the same palette as `⌘K`). The settings page lists the keybind as global.

### C8. Performance overlay is on by default and obscures real UI
- The "Entwicklungs-Leistungsdiagnose" panel (NAV / FPS / FRAME / JANK / LONG / DELAY / INP / CLS / MEM) is rendered on every page in the bottom-right corner. It overlaps the bottom-right of:
  - the home stats / activity card,
  - the side panel (file tree / changes),
  - the composer at narrow widths (`audit/34-mobile-session-dark.png`),
  - the timeline, etc.
- No visible toggle to dismiss. Should be dev-only or hidden behind a flag.
- **Screenshots:** every screenshot from `audit/`.

---

## 🟠 HIGH — visibly broken UX, but not crashing

### H1. Massive German/English mix (i18n is half-done)
The app's default locale is German, but huge sections are untranslated. A non-exhaustive list:

| Surface | German label | English label still showing |
|---|---|---|
| Settings sidebar | Allgemein, Tastenkombinationen, Anbieter, Erweiterungen | **Models**, **Modes**, **Plugins**, **MCP**, **Skills** |
| Settings → Anbieter | Trennen, Verbinden | **Edit models** |
| Provider model modal | — | "GitHub Copilot models", "Select all", "Clear", "Model ID", "Display name", "+ Add" — entire modal in EN |
| Settings → Models page | Anbieter (sidebar) | Title **Models**, **+ Add model** |
| Settings → Modes page | sidebar | **Modes**, **+ Add mode**, mode tag **Primary** |
| Settings → Plugins | sidebar | Title **Plugins**, **+ Add plugin**, **No plugins configured** |
| Settings → MCP | sidebar | Title **MCP**, **+ Add server**, **No MCP servers configured** |
| Settings → Skills | sidebar | **Skills**, "Skill-Quellen verwalten" (DE) **Sources**, "+ Add source", "No additional skill sources configured", "Available skills", "No skills found" |
| Settings → Allgemein → Erscheinungsbild | UI-Schriftart, Code-Schriftart | **Terminal Font**, "Customise the font used in the terminal" |
| Cron page | — | "Scheduled tasks", "+ New scheduled task", "No scheduled tasks…", "Sessions" header, "Back" button |
| Cron form | "Abbrechen" / "Speichern" buttons | "New scheduled task", "Name", "Description", "Task prompt", "Schedule type", "Cron", "Interval", "Cron expression", "Timeout (minutes)", "Agent", "Model (provider/modelID)", placeholders "Daily code review" / "Describe exactly what the agent should do." |
| Notifications | "Antwort bereit" | "Aborted" status text |
- **Screenshots:** `audit/12,17,19,20,21,22,23,25,28.png`

### H2. Sound-effect labels are internal IDs
- Settings → Allgemein → Soundeffekte
- Values shown: **"Staplebops 01"**, **"Staplebops 02"**, **"Nein 03"** (yes, "No 03"). These are clearly internal asset names being rendered as user-visible options.
- **Screenshot:** `audit/13-settings-general-bottom.png`

### H3. Empty bars on activity chart are invisible in light mode
- `/` → "Sitzungen im Zeitverlauf" (Last 14 days)
- 12 of 14 days are 0. In **light mode** the empty days render with no baseline at all — the chart looks like only the last 2 days exist. In **dark mode** there *is* a faint placeholder rect (visible in `audit/35-mobile-home-dark.png`), so the contrast is off in light mode.
- No tooltip on hover either; the bar darkens but no number/label.
- **Screenshots:** `audit/01-home.png`, `audit/03-home-chart-hover.png`.

### H4. Branch label sometimes shows as a single `/`
- Project view (`~/Development`) → middle pane shows the branch indicator as just `/` alone above "Haupt-Branch".
- **Screenshots:** `audit/04-project-session-list.png`, `audit/38-project-options.png`.

### H5. "Git-Repository erstellen" pushed onto every project that isn't a repo
- Project view → right pane "Überprüfung" panel says *"Git-Repository erstellen"* and shows a giant CTA, even when the user clearly hasn't asked for git tooling. Not a bug per se, but the empty state takes 80% of the panel and dominates over the existing review/timeline tabs.
- **Screenshot:** `audit/04-project-session-list.png`

### H6. File tree side-panel tabs are truncated to mush
- Open Dateibaum on a 1440 viewport → tabs render as **"0 Änder…"** and **"Alle Dat…"** because the right panel default width is too narrow for the labels.
- **Screenshot:** `audit/09-file-tree.png`

### H7. "Datei öffnen" file picker shows `Keine Ergebnisse gefunden` before user types
- Empty state on the Open File palette is just the "no results" message. Should at least say "Type to search" or list recent files.
- **Screenshot:** `audit/46-file-open.png`

### H8. Terminal opening shifts the message timeline under the composer
- Click `Terminal umschalten` in a session → the composer overlaps the message column. "Fragen verworfen" label and the bottom of the message stack are clipped behind the composer.
- **Screenshot:** `audit/08-terminal.png`

### H9. Cron `/cron` (global) vs `/cron/worktree/...` is contradictory
- Global cron page: empty state, "+ New scheduled task" button does **nothing** when clicked (no modal, no toast).
- Project-scoped cron page: button works and opens the form. So the global page has a dead button.
- Project-scoped page sidebar lists "Sessions" but the body says "No scheduled tasks for this project yet." — the two halves disagree about what's there.
- **Screenshots:** `audit/24-cron.png`, `audit/26-cron-project.png`, `audit/27-cron-form-open.png`.

### H10. Theme picker click only works with synthetic pointer events
- Native click on the `aria-haspopup="listbox"` theme select (`Thema: OC-2`) doesn't open the menu. Only `pointerdown + pointerup + click` triggered programmatically did. Likely a pointer-event handler is filtering out plain clicks — keyboard / a11y users will hit this.

### H11. CLS jumps on the notifications page
- `audit/28-notifications.png` ran with CLS=0.15 in the perf overlay; chart page hit CLS=0.18 too. Anything > 0.1 is a Web Vitals "needs-improvement" signal.

---

## 🟡 MEDIUM — polish, copy, design

### M1. Title-bar back/forward buttons disabled at home
- On `/` both `Zurück` and `Vorwärts navigieren` are disabled even though there is browser history available (we just came from `/notifications`). They only enable inside a project route. That's inconsistent with how a normal "back" button behaves.

### M2. Mixed casing/style of metric labels
- Home stats card shows "Sitzungen", "Geänderte Dateien", "Geänderte Zeilen", "Diese Woche". The third one has a green/red diff `+3.764 -168`, the fourth has a "heute" suffix — inconsistent visual treatment per cell.
- **Screenshot:** `audit/01-home.png`

### M3. Sidebar hover state for active item is awkward
- Active project pill (`D`) gets a pink/lavender highlight while the icon-only nav above it (Home, bell) keeps a plain border treatment. The two highlight styles don't match.
- **Screenshots:** `audit/01-home.png`, `audit/35-mobile-home-dark.png`.

### M4. Composer placeholder copy
- Empty session: the placeholder is `Fragen Sie alles… "Diese Funktion lesbarer gestalten"` — the example is in straight quotes inside the placeholder, makes the placeholder read like two sentences smashed together.

### M5. Composer right-side icon row is unlabeled
- 3 small icons next to the model/agent picker (Bild, Tools, "Erlaubt Reasoning"). They appear as plain `<generic>` with `img` children — they don't look like buttons, no hover affordance, the right one's tooltip "Erlaubt Reasoning" is sentence-fragment German.

### M6. Scheduled Tasks empty-state copy
- Global: "Run agent tasks automatically on a schedule." — missing period of localization. Also the empty state says "No scheduled tasks yet. Create one to run the agent automatically." but the button on the same page is dead (see H9).

### M7. Project cron sidebar uppercase header
- "SESSIONS" in all caps. Inconsistent with rest of the app's sentence case.
- **Screenshot:** `audit/26-cron-project.png`

### M8. Cron form: cron-expression UX
- Default value is `0 9 * * 1-5`. There's no "preview next run", no syntax help, no error state when invalid. Users who don't know cron will be lost.
- **Screenshot:** `audit/25-cron-form.png`

### M9. Settings → Allgemein → "Nach Updates suchen" gives no feedback
- Clicking the "Check for updates" button silently scrolls the page back to the top. No spinner, no "you're up to date" toast, no error. With the network already failing on `https://example.invalid/changelog.json`, this is just dead.

### M10. Provider modal — long lists, no virtualization
- "GitHub Copilot models" lists all 27 models with toggles in a small popover. Scrolling inside is fine but selecting "Select all" is the only bulk option (Clear is the inverse). No "deprecated/preview" filter.
- **Screenshot:** `audit/18-edit-models-modal.png`

### M11. Bare ULIDs in two more places
- Notification body for some sessions uses `ses_227f...` (see C3). Same pattern showed up in localStorage values, but those are internal. The user-facing one is the bug.

### M12. Erkundet count hover area
- Buttons in the timeline like "Erkundet, 0 Lesevorgänge, 1 Suche, 0 Listen" have weird pluralization spacing — comma right before the comma in "0 Listen" looks like `0 Listen ,` due to whitespace. Minor typography.

### M13. Update toast / version meta
- Settings → Updates panel says: *"Du nutzt Version local. Automatische Updates sind für diese Installation nicht verfügbar — bitte manuell aktualisieren."* This reads fine, but `Version local` (lowercase, raw env) leaks the dev value. Should be "Entwicklungsversion" or "lokal".

### M14. Performance overlay covers settings-icon area at small heights
- At 700px tall (tablet) the overlay covers half of the bottom of the Settings → Allgemein page (visible in `audit/40-theme-section.png`).

---

## 🟢 LOW — nits

- `oc-1` → `oc-2` migration in `theme-preload-script` runs on every page load and writes localStorage; should at least be guarded by version check so it doesn't run forever.
- `Pfad kopieren` button doesn't show a toast on success.
- `Restart` icon-only button in sidebar has no confirmation dialog. One miss-click and you lose unsaved drafts.
- Tooltip on the home project bar (`D Development 28 Sitzungen vor 16 Minuten +3.764 -168`) is a single concatenated string.
- `Letzte Sitzungen` list at home repeats the project pill ("D") to the left of every row — visually noisy when only one project is connected.
- Composer uses `Datei anhängen` as the action but on click no observed file dialog appeared during testing (couldn't verify the chooser opened — file inputs don't surface to Playwright).
- Overscroll bounce on the sidebar reveals the white background underneath the rounded outer card; small black gap visible.
- Notifications page page title is "Benachrichtigungen / 6 Benachrichtigungen" — repeats the noun.

---

## What I COULD NOT verify (called out so you don't think I missed)

- Real send / agent workflow (the model + provider needed to be configured cleanly; auto-send guard kept firing).
- File attach picker (native dialog isn't visible to Playwright).
- "Nach Updates suchen" success path (network blocked by `example.invalid`).
- `Ctrl+~` for terminal toggle on the home route — not sure if that's intentional.
- Restart button (didn't click it; would have killed the dev server).
- Cmd+, for opening settings — yes, jumps to settings.
- Status popover MCP / LSP / Plugins tabs (all empty in this install — not exercised).
- Deep linking into a specific cron session (`/cron/worktree/.../session/...`).

---

## Suggested first fixes (smallest diff, biggest impact)

1. **Hide the perf overlay** behind `localStorage.codeplane-debug` or the env flag — single-line change, kills visual noise on every screenshot above. (C8)
2. **Fix the toast formatter** to JSON-stringify objects instead of `String(err)` printing `[object Object]`. (C1)
3. **Replace raw session IDs in notifications** with the session title, fall back to the ID only when the title is empty. (C3)
4. **Stop auto-firing the "select model" toast** when the prompt has a stale draft. Either gate the auto-send on user intent or coalesce the toasts (use Sonner's `id` to replace instead of stack). (C4)
5. **Translate the missing strings** (everything in H1) — there's clearly an i18n catalogue, the keys are just not being used in those views.
6. **Mobile menu**: the toggle should swap *between* sidebar and content, not hide both. (C2)
