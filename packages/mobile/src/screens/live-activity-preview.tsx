/**
 * Dev-only HTML mockup of the iOS Live Activity layouts. Reachable
 * by navigating to `#la-preview` on the picker. Renders the same
 * card geometry the SwiftUI widget paints on the Lock Screen and the
 * Dynamic Island, using HTML + CSS so we can visually iterate on the
 * design without bouncing through Xcode → Simulator → "lock the
 * device, wait for the activity to render".
 *
 * Three layouts are mirrored:
 *   1. Lock Screen — single task (one running task on the instance).
 *   2. Lock Screen — duo (two tasks racing, third folded into the
 *      "+N more running" footer).
 *   3. Dynamic Island — compact pill + minimal dot + expanded duo.
 *
 * Keep this file in sync with `LockScreenView.swift` and
 * `DynamicIslandViews.swift`. The CSS variables below are 1:1 with
 * the colours `CodeplaneLiveActivityWidget.swift` defines —
 * `--la-text` matches `codeplaneText`, `--la-text-muted` matches
 * `codeplaneTextMuted`, `--la-border` matches `codeplaneBorder`,
 * `--la-failure` matches `codeplaneFailure`. If you tweak the Swift
 * palette, mirror the change here so the mockup keeps reflecting
 * what the widget actually renders.
 */

import { type Component, For, Show } from "solid-js"

type Phase = "running" | "queued" | "completed" | "failed"

type Task = {
  id: string
  phase: Phase
  title: string
  queueDepth: number
  progress: number | null
  startedSecondsAgo: number
  turns: number
}

type Layout = {
  label: string
  description: string
  attributes: { instanceLabel: string; instanceHost: string }
  state: { primary: Task; secondary: Task | null; totalActive: number }
}

const layouts: Layout[] = [
  {
    label: "Single — running",
    description: "One task on the instance. Progress bar stretches; turns + elapsed underneath.",
    attributes: { instanceLabel: "Production", instanceHost: "prod.codeplane.example.com" },
    state: {
      primary: {
        id: "t-1",
        phase: "running",
        title: "Refactoring authentication middleware…",
        queueDepth: 0,
        progress: 0.38,
        startedSecondsAgo: 134,
        turns: 3,
      },
      secondary: null,
      totalActive: 1,
    },
  },
  {
    label: "Duo — both running",
    description: "Top-2 by longest-running. Progress hides the bar and moves percent inline.",
    attributes: { instanceLabel: "Production", instanceHost: "prod.codeplane.example.com" },
    state: {
      primary: {
        id: "t-1",
        phase: "running",
        title: "Refactoring authentication middleware…",
        queueDepth: 0,
        progress: 0.38,
        startedSecondsAgo: 134,
        turns: 3,
      },
      secondary: {
        id: "t-2",
        phase: "running",
        title: "Updating database schema for v2 endpoints",
        queueDepth: 0,
        progress: null,
        startedSecondsAgo: 42,
        turns: 1,
      },
      totalActive: 2,
    },
  },
  {
    label: "Duo — three+ active",
    description: "Top-2 still shown; everything else folded into a +N more footer.",
    attributes: { instanceLabel: "Staging", instanceHost: "staging.codeplane.example.com" },
    state: {
      primary: {
        id: "t-1",
        phase: "running",
        title: "Migrating legacy webhook handler",
        queueDepth: 2,
        progress: 0.61,
        startedSecondsAgo: 312,
        turns: 7,
      },
      secondary: {
        id: "t-2",
        phase: "queued",
        title: "Generating release-notes for v27.4.69",
        queueDepth: 1,
        progress: null,
        startedSecondsAgo: 14,
        turns: 1,
      },
      totalActive: 4,
    },
  },
  {
    label: "Single — completed",
    description: "Terminal phase. Glyph swaps to a checkmark, percent reads 100%.",
    attributes: { instanceLabel: "Production", instanceHost: "prod.codeplane.example.com" },
    state: {
      primary: {
        id: "t-1",
        phase: "completed",
        title: "Deployed v27.4.68 to production",
        queueDepth: 0,
        progress: 1,
        startedSecondsAgo: 248,
        turns: 5,
      },
      secondary: null,
      totalActive: 1,
    },
  },
  {
    label: "Single — failed",
    description: "Failure is the one chromatic concession (red triangle alert).",
    attributes: { instanceLabel: "Staging", instanceHost: "staging.codeplane.example.com" },
    state: {
      primary: {
        id: "t-1",
        phase: "failed",
        title: "Could not reach Postgres replica — see logs",
        queueDepth: 0,
        progress: null,
        startedSecondsAgo: 87,
        turns: 2,
      },
      secondary: null,
      totalActive: 1,
    },
  },
]

const formatTurns = (n: number) => (n === 1 ? "1 turn" : `${n} turns`)

const formatElapsed = (s: number) => {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

const phaseLabel = (p: Phase) =>
  p === "running" ? "Running" : p === "queued" ? "Queued" : p === "completed" ? "Done" : "Failed"

const PhaseGlyph: Component<{ phase: Phase; size?: number }> = (props) => {
  const size = props.size ?? 7
  if (props.phase === "running") {
    return (
      <span
        class="la-phase la-phase--running"
        style={{ width: `${size}px`, height: `${size}px` }}
        aria-label={phaseLabel(props.phase)}
      />
    )
  }
  if (props.phase === "queued") {
    return (
      <span
        class="la-phase la-phase--queued"
        style={{ width: `${size}px`, height: `${size}px` }}
        aria-label={phaseLabel(props.phase)}
      />
    )
  }
  if (props.phase === "completed") {
    return (
      <svg width={size + 2} height={size + 2} viewBox="0 0 12 12" fill="none" aria-label="Done">
        <path
          d="M3 6.5l2 2 4-4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width={size + 2} height={size + 2} viewBox="0 0 12 12" fill="none" aria-label="Failed">
      <path
        d="M6 1.5L11 10.5H1L6 1.5Z M6 5v2.5"
        stroke="var(--la-failure)"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="6" cy="9" r="0.6" fill="var(--la-failure)" />
    </svg>
  )
}

const TaskRow: Component<{ task: Task; isCompact: boolean }> = (props) => {
  return (
    <div class="la-task" classList={{ "la-task--compact": props.isCompact }}>
      <div class="la-task__line">
        <PhaseGlyph phase={props.task.phase} />
        <div class="la-task__title">{props.task.title}</div>
        <Show when={props.isCompact && props.task.progress != null}>
          <div class="la-task__percent">{Math.round((props.task.progress ?? 0) * 100)}%</div>
        </Show>
      </div>
      <div class="la-task__meta">
        <Show when={props.task.turns > 0}>
          <span>{formatTurns(props.task.turns)}</span>
          <span class="la-task__sep">·</span>
        </Show>
        <span>{formatElapsed(props.task.startedSecondsAgo)}</span>
        <Show when={props.task.queueDepth > 0}>
          <span class="la-task__sep">·</span>
          <span>{props.task.queueDepth} queued</span>
        </Show>
      </div>
      <Show when={!props.isCompact}>
        <div class="la-task__bar-row">
          <Show
            when={props.task.progress != null}
            fallback={
              <div class="la-bar la-bar--indeterminate" aria-label="Indeterminate progress" />
            }
          >
            <div class="la-bar la-bar--determinate">
              <div
                class="la-bar__fill"
                style={{ width: `${(props.task.progress ?? 0) * 100}%` }}
              />
            </div>
            <div class="la-task__percent">
              {Math.round((props.task.progress ?? 0) * 100)}%
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const LockScreen: Component<{ layout: Layout }> = (props) => {
  const hidden = () =>
    Math.max(
      0,
      props.layout.state.totalActive - (props.layout.state.secondary == null ? 1 : 2),
    )
  return (
    <div class="la-lockscreen">
      <div class="la-header">
        <div class="la-mark" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M5 2.5L9 7l-4 4.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
            />
          </svg>
        </div>
        <div class="la-header__text">
          <div class="la-header__label">{props.layout.attributes.instanceLabel}</div>
          <div class="la-header__host">{props.layout.attributes.instanceHost}</div>
        </div>
      </div>

      <TaskRow task={props.layout.state.primary} isCompact={!!props.layout.state.secondary} />

      <Show when={props.layout.state.secondary} keyed>
        {(secondary) => (
          <>
            <div class="la-divider" />
            <TaskRow task={secondary} isCompact />
          </>
        )}
      </Show>

      <Show when={hidden() > 0}>
        <div class="la-footer">
          +{hidden()} more {props.layout.state.totalActive === hidden() + 1 ? "running" : "running"}
        </div>
      </Show>
    </div>
  )
}

const DynamicIsland: Component<{ layout: Layout }> = (props) => {
  const task = () => props.layout.state.primary
  const total = () => props.layout.state.totalActive
  return (
    <div class="la-island">
      <div class="la-island__compact">
        <div class="la-island__compact-row">
          <span class="la-island__brand">‹</span>
          <Show
            when={task().phase === "completed"}
            fallback={
              <Show
                when={task().phase === "failed"}
                fallback={
                  <Show
                    when={task().progress != null}
                    fallback={
                      <Show
                        when={total() > 1}
                        fallback={
                          <Show
                            when={task().queueDepth > 0}
                            fallback={<span class="la-island__dashed">○</span>}
                          >
                            <span class="la-island__count">⊟ {task().queueDepth}</span>
                          </Show>
                        }
                      >
                        <span class="la-island__count">▤ {total()}</span>
                      </Show>
                    }
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" stroke="var(--la-text-muted)" stroke-opacity="0.3" stroke-width="1.6" fill="none" />
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="var(--la-text)"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        fill="none"
                        stroke-dasharray={`${(task().progress ?? 0) * (Math.PI * 12)} ${Math.PI * 12}`}
                        transform="rotate(-90 8 8)"
                      />
                    </svg>
                  </Show>
                }
              >
                <PhaseGlyph phase="failed" size={11} />
              </Show>
            }
          >
            <PhaseGlyph phase="completed" size={11} />
          </Show>
        </div>
      </div>
      <div class="la-island__expanded">
        <div class="la-island__leading">
          <span class="la-island__brand">‹</span>
          <Show when={total() > 1}>
            <span class="la-island__count-mono">{total()}</span>
          </Show>
        </div>
        <div class="la-island__center">
          <div class="la-island__center-label">{props.layout.attributes.instanceLabel}</div>
          <div class="la-island__center-host">{props.layout.attributes.instanceHost}</div>
        </div>
        <div class="la-island__trailing">
          <Show when={task().progress != null}>
            <div class="la-island__pct">{Math.round((task().progress ?? 0) * 100)}%</div>
          </Show>
          <div class="la-island__elapsed">{formatElapsed(task().startedSecondsAgo)}</div>
        </div>
        <div class="la-island__bottom">
          <TaskRow task={props.layout.state.primary} isCompact />
          <Show when={props.layout.state.secondary} keyed>
            {(secondary) => (
              <>
                <div class="la-divider" />
                <TaskRow task={secondary} isCompact />
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}

export const LiveActivityPreview: Component = () => {
  return (
    <div class="la-preview">
      <style>{LIVE_ACTIVITY_PREVIEW_CSS}</style>
      <div class="la-preview__intro">
        <div class="la-preview__title">Live Activity preview</div>
        <div class="la-preview__subtitle">
          Mockup of the SwiftUI layouts in <code>build/ios-live-activity/</code>. Same colour
          tokens, same geometry — what you see here is what the iOS widget paints on the Lock
          Screen and Dynamic Island.
        </div>
      </div>
      <For each={layouts}>
        {(layout) => (
          <section class="la-preview__section">
            <header class="la-preview__section-header">
              <div class="la-preview__section-label">{layout.label}</div>
              <div class="la-preview__section-desc">{layout.description}</div>
            </header>
            <div class="la-preview__row">
              <div class="la-preview__col">
                <div class="la-preview__caption">Lock Screen</div>
                <LockScreen layout={layout} />
              </div>
              <div class="la-preview__col">
                <div class="la-preview__caption">Dynamic Island</div>
                <DynamicIsland layout={layout} />
              </div>
            </div>
          </section>
        )}
      </For>
    </div>
  )
}

const LIVE_ACTIVITY_PREVIEW_CSS = `
.la-preview {
  /* Live-Activity colour tokens, kept in sync with the Swift palette
     in build/ios-live-activity/CodeplaneLiveActivityWidget.swift. */
  --la-bg: #0b0d10;
  --la-text: #ededed;
  --la-text-muted: rgba(255,255,255,0.55);
  --la-border: rgba(255,255,255,0.12);
  --la-surface: rgba(255,255,255,0.06);
  --la-failure: #fc533a;

  padding: 24px 16px 64px;
  min-height: 100%;
  background: var(--background-base);
  color: var(--text-base);
  display: flex;
  flex-direction: column;
  gap: 28px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
}

.la-preview__intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.la-preview__title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.la-preview__subtitle { font-size: 13px; line-height: 1.45; color: var(--text-weak); }
.la-preview__subtitle code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.la-preview__section { display: flex; flex-direction: column; gap: 10px; }
.la-preview__section-header { display: flex; flex-direction: column; gap: 2px; }
.la-preview__section-label { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.la-preview__section-desc { font-size: 11px; color: var(--text-weak); line-height: 1.4; }
.la-preview__row { display: flex; flex-direction: column; gap: 16px; }
.la-preview__col { display: flex; flex-direction: column; gap: 8px; }
.la-preview__caption {
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--text-weak);
}

/* ─── Lock Screen card ─────────────────────────────────────────── */
.la-lockscreen {
  background: var(--la-bg);
  color: var(--la-text);
  border-radius: 22px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(255,255,255,0.06) inset;
}
.la-header { display: flex; align-items: center; gap: 10px; }
.la-mark {
  width: 22px; height: 22px;
  border-radius: 6px;
  background: rgba(255,255,255,0.12);
  color: var(--la-text);
  display: inline-flex; align-items: center; justify-content: center;
}
.la-header__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.la-header__label {
  font-size: 14px; font-weight: 600; color: var(--la-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.la-header__host {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; color: var(--la-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ─── Phase glyphs ────────────────────────────────────────────── */
.la-phase {
  display: inline-block;
  border-radius: 999px;
  flex-shrink: 0;
  margin-top: 4px;
}
.la-phase--running { background: var(--la-text); }
.la-phase--queued {
  background: transparent;
  border: 1px solid var(--la-text-muted);
}

/* ─── Task row ────────────────────────────────────────────────── */
.la-task { display: flex; flex-direction: column; gap: 4px; }
.la-task__line {
  display: flex; align-items: flex-start; gap: 8px;
  color: var(--la-text);
}
.la-task__title {
  font-size: 13px; line-height: 1.35;
  flex: 1 1 auto; min-width: 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.la-task--compact .la-task__title { -webkit-line-clamp: 1; }
.la-task__percent {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 500;
  color: var(--la-text-muted);
  flex-shrink: 0;
}
.la-task__meta {
  display: flex; gap: 6px; align-items: baseline;
  font-size: 11px; color: var(--la-text-muted); font-weight: 500;
  margin-left: 16px;
}
.la-task__sep { opacity: 0.6; }
.la-task__bar-row {
  display: flex; align-items: center; gap: 10px;
  margin-top: 2px;
  margin-left: 16px;
}

/* ─── Progress bars ───────────────────────────────────────────── */
.la-bar { flex: 1 1 auto; height: 4px; border-radius: 999px; overflow: hidden; position: relative; }
.la-bar--determinate { background: rgba(255,255,255,0.10); }
.la-bar__fill {
  height: 100%;
  background: rgba(255,255,255,0.92);
  border-radius: 999px;
  transition: width 0.4s ease-in-out;
}
.la-bar--indeterminate { background: rgba(255,255,255,0.10); }
.la-bar--indeterminate::before {
  content: "";
  position: absolute; top: 0; bottom: 0; width: 32%;
  background: rgba(255,255,255,0.78);
  border-radius: 999px;
  animation: la-indeterminate 1.6s linear infinite;
}
@keyframes la-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(310%); }
}

/* ─── Divider + footer ────────────────────────────────────────── */
.la-divider {
  height: 1px; background: var(--la-border); margin: 4px 0;
}
.la-footer {
  font-size: 11px; font-weight: 500;
  color: var(--la-text-muted); text-align: center;
  padding-top: 2px;
}

/* ─── Dynamic Island ──────────────────────────────────────────── */
.la-island {
  display: flex; flex-direction: column; gap: 12px;
}
.la-island__compact {
  align-self: center;
  background: #000;
  color: var(--la-text);
  border-radius: 999px;
  padding: 6px 14px;
  display: inline-flex; align-items: center;
  min-width: 124px; max-width: 124px;
  height: 36px;
  box-shadow: 0 0 0 0.5px rgba(255,255,255,0.06) inset;
}
.la-island__compact-row {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%;
}
.la-island__brand {
  font-size: 16px; font-weight: 800; color: var(--la-text);
  line-height: 1; transform: scaleX(0.85);
}
.la-island__count, .la-island__count-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; font-weight: 600; color: var(--la-text);
}
.la-island__dashed { font-size: 16px; color: var(--la-text); opacity: 0.7; }

.la-island__expanded {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  gap: 6px 12px;
  background: #000;
  color: var(--la-text);
  border-radius: 28px;
  padding: 14px 18px 16px;
  box-shadow: 0 0 0 0.5px rgba(255,255,255,0.06) inset;
}
.la-island__leading { display: flex; align-items: center; gap: 6px; }
.la-island__center { text-align: center; min-width: 0; }
.la-island__center-label { font-size: 13px; font-weight: 600; }
.la-island__center-host {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; color: var(--la-text-muted);
}
.la-island__trailing { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.la-island__pct {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 500; color: var(--la-text-muted);
}
.la-island__elapsed {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 500; color: var(--la-text-muted);
}
.la-island__bottom { grid-column: 1 / -1; padding-top: 6px; }
`
