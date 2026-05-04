// Boot wizard: instance picker → (optional create-local form) → directory
// picker. Renders before the main TUI hands off to `tui()` from `app.tsx`.
// Steps share a single CliRenderer that is fully destroyed before this
// promise resolves so the main TUI starts on a clean screen.
import { createSignal, createMemo, For, Show, batch, onCleanup } from "solid-js"
import { render, useKeyboard } from "@opentui/solid"
import { createCliRenderer, type CliRenderer, TextAttributes } from "@opentui/core"
import path from "node:path"
import fs from "node:fs/promises"
import { homedir } from "node:os"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import type { InstanceService } from "../instance-service"
import { Header, palette, SectionHeading, StatusBar } from "./primitives"
import { LocalInstanceForm } from "./local-form"

export type BootSelection = {
  instance: SavedInstance
  directory?: string
}

export type BootWizardInput = {
  service: InstanceService
  instances: SavedInstance[]
  defaultDirectory?: string
}

function homeify(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? "~" + p.slice(home.length) : p
}

type Step = "instance" | "create-local" | "directory"

// ---------- Step 1: instance picker ----------

function InstancePicker(props: {
  instances: SavedInstance[]
  selected: number
  onMove: (delta: number) => void
  onPick: (i: number) => void
  onCreateLocal: () => void
  onDelete: (i: number) => void
  onUpdate: (i: number) => void
  onQuit: () => void
  busy?: { message: string; percent?: number }
  notice?: { variant: "success" | "warn" | "error" | "info"; message: string }
}) {
  useKeyboard((evt) => {
    // Swallow input while an update / probe is in flight so a stray Enter
    // doesn't pick the instance mid-download.
    if (props.busy) {
      if (evt.ctrl && evt.name === "c") props.onQuit()
      return
    }
    if (evt.name === "up" || evt.name === "k") props.onMove(-1)
    else if (evt.name === "down" || evt.name === "j") props.onMove(1)
    else if (evt.name === "return") props.onPick(props.selected)
    else if (evt.name === "n" || evt.name === "l") props.onCreateLocal()
    else if (evt.name === "d" || evt.name === "delete") props.onDelete(props.selected)
    else if (evt.name === "u") props.onUpdate(props.selected)
    else if (evt.name === "q" || (evt.ctrl && evt.name === "c")) props.onQuit()
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg}>
      <Header instance="setup" cwd={homeify(process.cwd())} status="ready" />
      <SectionHeading>SELECT A SERVER</SectionHeading>
      <Show when={props.instances.length === 0}>
        <box marginTop={1} paddingX={2}>
          <text fg={palette.fgMuted}>No saved instances. Press </text>
          <text fg={palette.accent}>n</text>
          <text fg={palette.fgMuted}> to create a local one.</text>
        </box>
      </Show>
      <box flexDirection="column" marginTop={1} paddingX={2}>
        <For each={props.instances}>
          {(inst, i) => {
            const isSelected = createMemo(() => i() === props.selected)
            const local = inst.url.startsWith("local://") || !!inst.local
            return (
              <box flexDirection="column">
                <box flexDirection="row">
                  <text fg={isSelected() ? palette.accent : palette.divider}>
                    {isSelected() ? "▍" : " "}
                  </text>
                  <text fg={local ? palette.success : palette.info}>
                    {`  ${local ? "local " : "remote"}  `}
                  </text>
                  <text
                    fg={isSelected() ? palette.accent : palette.fgMuted}
                    attributes={isSelected() ? TextAttributes.BOLD : 0}
                  >
                    {inst.label ?? inst.id}
                  </text>
                  <text fg={palette.fgDim}>{`   ${inst.url}`}</text>
                </box>
                <Show when={isSelected()}>
                  <box flexDirection="row" paddingLeft={4}>
                    <text fg={palette.fgDim}>
                      {local
                        ? `binary ${inst.local?.binaryVersion || "auto"}  ·  starts on demand`
                        : "tls verify enabled  ·  no custom headers"}
                    </text>
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
      </box>
      <Show when={props.notice}>
        <box marginTop={1} paddingX={2} flexDirection="row">
          <text
            fg={
              props.notice!.variant === "success"
                ? palette.success
                : props.notice!.variant === "error"
                  ? palette.warn
                  : props.notice!.variant === "warn"
                    ? palette.warn
                    : palette.info
            }
          >
            {props.notice!.variant === "success"
              ? "✓ "
              : props.notice!.variant === "error"
                ? "✗ "
                : props.notice!.variant === "warn"
                  ? "! "
                  : "i "}
          </text>
          <text fg={palette.fg}>{props.notice!.message}</text>
        </box>
      </Show>
      <Show when={props.busy}>
        <box marginTop={1} paddingX={2} flexDirection="row">
          <text fg={palette.accent}>⟳ </text>
          <text fg={palette.fg}>{props.busy!.message}</text>
          <Show when={typeof props.busy!.percent === "number"}>
            <text fg={palette.fgDim}>{`  ${Math.round(props.busy!.percent ?? 0)}%`}</text>
          </Show>
        </box>
      </Show>
      <box flexGrow={1} />
      <StatusBar
        hints={[
          { keys: "↵", label: "open" },
          { keys: "u", label: "update" },
          { keys: "n", label: "new local" },
          { keys: "d", label: "delete" },
          { keys: "↑↓", label: "navigate" },
          { keys: "q", label: "quit" },
        ]}
      />
    </box>
  )
}

// ---------- Step 3: directory picker (proper file browser) ----------

type Entry = {
  name: string
  isDir: boolean
}

async function listDir(dir: string): Promise<Entry[]> {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true })
    const out: Entry[] = items
      .filter((d) => !d.name.startsWith(".") || d.name === ".codeplane")
      .map((d) => ({
        name: d.name,
        isDir: d.isDirectory() || d.isSymbolicLink(),
      }))
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return out
  } catch {
    return []
  }
}

function DirectoryPicker(props: {
  instance: SavedInstance
  initialDirectory: string
  onConfirm: (dir: string) => void
  onBack: () => void
  onQuit: () => void
}) {
  const [cwd, setCwd] = createSignal(path.resolve(props.initialDirectory))
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [selected, setSelected] = createSignal(0)
  const [search, setSearch] = createSignal("")
  const [scroll, setScroll] = createSignal(0)
  const [error] = createSignal<string | undefined>(undefined)

  const VIEWPORT = 14

  const refresh = async (next: string) => {
    const list = await listDir(next)
    batch(() => {
      setCwd(next)
      setEntries(list)
      setSelected(0)
      setScroll(0)
    })
  }
  void refresh(cwd())

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    const all = entries()
    if (!q) return all
    return all.filter((e) => e.name.toLowerCase().includes(q))
  })

  const visible = createMemo(() => filtered().slice(scroll(), scroll() + VIEWPORT))

  const move = (delta: number) => {
    const list = filtered()
    if (list.length === 0) return
    let next = selected() + delta
    if (next < 0) next = 0
    if (next > list.length - 1) next = list.length - 1
    setSelected(next)
    if (next < scroll()) setScroll(next)
    else if (next >= scroll() + VIEWPORT) setScroll(next - VIEWPORT + 1)
  }

  const enter = async () => {
    const list = filtered()
    const item = list[selected()]
    if (!item || !item.isDir) return
    const next = path.join(cwd(), item.name)
    setSearch("")
    await refresh(next)
  }

  const goUp = async () => {
    const parent = path.dirname(cwd())
    if (parent === cwd()) return
    setSearch("")
    await refresh(parent)
  }

  const goHome = async () => {
    setSearch("")
    await refresh(homedir())
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      if (search()) setSearch("")
      else props.onBack()
      return
    }
    if (evt.ctrl && evt.name === "c") return props.onQuit()
    if (evt.name === "up") return move(-1)
    if (evt.name === "down") return move(1)
    if (evt.name === "pageup") return move(-VIEWPORT)
    if (evt.name === "pagedown") return move(VIEWPORT)
    if (evt.name === "home" && !evt.ctrl) {
      setSelected(0)
      setScroll(0)
      return
    }
    if (evt.name === "end") {
      const last = filtered().length - 1
      setSelected(Math.max(0, last))
      setScroll(Math.max(0, last - VIEWPORT + 1))
      return
    }
    if (evt.name === "right") return void enter()
    if (evt.name === "left") return void goUp()
    if (evt.name === "return") {
      const list = filtered()
      const item = list[selected()]
      if (search() && item?.isDir) return void enter()
      props.onConfirm(cwd())
      return
    }
    if (evt.ctrl && evt.name === "h") return void goHome()
    if (evt.ctrl && (evt.name === "u" || evt.name === "w")) {
      setSearch("")
      return
    }
    if (evt.name === "backspace") {
      if (search()) setSearch(search().slice(0, -1))
      else void goUp()
      return
    }
    if (evt.sequence && !evt.ctrl && !evt.meta && evt.sequence.length === 1) {
      const ch = evt.sequence
      if (ch.charCodeAt(0) >= 32) {
        setSearch(search() + ch)
        setSelected(0)
        setScroll(0)
      }
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg}>
      <Header
        instance={props.instance.label ?? props.instance.id}
        cwd={homeify(cwd())}
        status="connected"
      />
      <SectionHeading>WHERE TO WORK</SectionHeading>
      <box marginTop={1} paddingX={2}>
        <text fg={palette.fg}>Pick a working directory for </text>
        <text fg={palette.accent} attributes={TextAttributes.BOLD}>
          {props.instance.label ?? props.instance.id}
        </text>
        <text fg={palette.fg}>.</text>
      </box>

      <box marginTop={1} flexDirection="row" paddingX={2}>
        <text fg={palette.fgMuted}>search </text>
        <text fg={palette.divider}>›</text>
        <text fg={palette.accent}> {search() || " "}</text>
        <text fg={palette.fg}>▎</text>
      </box>

      <box marginTop={1} flexDirection="row" paddingX={2}>
        <text fg={palette.fgDim}>↑↓ select  ·  → enter dir  ·  ← up  ·  ↵ open here</text>
      </box>

      <box flexDirection="column" marginTop={1} paddingX={2}>
        <Show when={filtered().length === 0}>
          <text fg={palette.fgMuted}>{search() ? `No matches for "${search()}".` : "Empty directory."}</text>
        </Show>
        <For each={visible()}>
          {(entry, i) => {
            const realIdx = createMemo(() => scroll() + i())
            const isSelected = createMemo(() => realIdx() === selected())
            return (
              <box flexDirection="row">
                <text fg={isSelected() ? palette.accent : palette.divider}>
                  {isSelected() ? "▍" : " "}
                </text>
                <text fg={entry.isDir ? palette.accent : palette.fgDim}>
                  {`  ${entry.isDir ? "📁" : "📄"}  `}
                </text>
                <text
                  fg={isSelected() ? palette.accent : entry.isDir ? palette.fg : palette.fgMuted}
                  attributes={isSelected() ? TextAttributes.BOLD : 0}
                >
                  {entry.name}
                </text>
                <Show when={entry.isDir}>
                  <text fg={palette.fgDim}>/</text>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={filtered().length > VIEWPORT}>
          <box marginTop={1}>
            <text fg={palette.fgDim}>
              showing {scroll() + 1}–{Math.min(scroll() + VIEWPORT, filtered().length)} of {filtered().length}
            </text>
          </box>
        </Show>
      </box>

      <Show when={error()}>
        <box marginTop={1} paddingX={2}>
          <text fg={palette.warn}>{error()}</text>
        </box>
      </Show>

      <box flexGrow={1} />
      <StatusBar
        hints={[
          { keys: "↵", label: search() ? "drill in / open here" : "open here" },
          { keys: "→", label: "enter dir" },
          { keys: "←/⌫", label: "up" },
          { keys: "ctrl+h", label: "home" },
          { keys: "esc", label: search() ? "clear" : "back" },
          { keys: "ctrl+c", label: "quit" },
        ]}
      />
    </box>
  )
}

// ---------- Renderer driver ----------

export async function runBootWizard(input: BootWizardInput): Promise<BootSelection | null> {
  const renderer: CliRenderer = await createCliRenderer({ targetFps: 30 })

  let resolved = false
  let resolveOuter!: (v: BootSelection | null) => void
  const outer = new Promise<BootSelection | null>((r) => {
    resolveOuter = r
  })

  const finish = async (selection: BootSelection | null) => {
    if (resolved) return
    resolved = true
    try {
      renderer.destroy()
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 30))
    resolveOuter(selection)
  }

  const [instances, setInstances] = createSignal<SavedInstance[]>(input.instances.slice())
  const [step, setStep] = createSignal<Step>("instance")
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [defaultDir] = createSignal(input.defaultDirectory ?? process.cwd())
  const [updateBusy, setUpdateBusy] = createSignal<{ message: string; percent?: number } | undefined>(undefined)
  const [updateNotice, setUpdateNotice] = createSignal<
    { variant: "success" | "warn" | "error" | "info"; message: string } | undefined
  >(undefined)

  await render(
    () => (
      <Show
        when={step() === "instance"}
        fallback={
          <Show
            when={step() === "create-local"}
            fallback={
              <DirectoryPicker
                instance={instances()[selectedIdx()] as SavedInstance}
                initialDirectory={defaultDir()}
                onConfirm={(dir) =>
                  void finish({ instance: instances()[selectedIdx()] as SavedInstance, directory: dir })
                }
                onBack={() => setStep("instance")}
                onQuit={() => void finish(null)}
              />
            }
          >
            <LocalInstanceForm
              service={input.service}
              takenIds={new Set(instances().map((i) => i.id))}
              onDone={(result) => {
                if ("cancel" in result) {
                  setStep("instance")
                  return
                }
                const next = [...instances(), result.instance]
                setInstances(next)
                setSelectedIdx(next.length - 1)
                setStep("instance")
              }}
            />
          </Show>
        }
      >
        <InstancePicker
          instances={instances()}
          selected={selectedIdx()}
          busy={updateBusy()}
          notice={updateNotice()}
          onMove={(delta) => {
            const len = instances().length
            if (len === 0) return
            const next = ((selectedIdx() + delta) % len + len) % len
            setSelectedIdx(next)
            setUpdateNotice(undefined)
          }}
          onPick={() => {
            if (instances()[selectedIdx()]) setStep("directory")
          }}
          onCreateLocal={() => setStep("create-local")}
          onDelete={async (idx) => {
            const target = instances()[idx]
            if (!target) return
            try {
              await input.service.remove(target.id)
              const next = instances().filter((_, i) => i !== idx)
              setInstances(next)
              setSelectedIdx(Math.min(idx, next.length - 1))
            } catch {
              // swallow — keep the entry visible if delete fails
            }
          }}
          onUpdate={async (idx) => {
            const target = instances()[idx]
            if (!target) return
            setUpdateNotice(undefined)
            setUpdateBusy({ message: "Starting update…" })
            try {
              const result = await input.service.updateInstance(target, (progress) => {
                setUpdateBusy({
                  message: progress.message,
                  percent: progress.phase === "downloading" ? progress.percent : undefined,
                })
              })
              // Refresh the local list so the new binaryVersion shows in
              // the picker without restarting.
              const refreshed = await input.service.list()
              setInstances(refreshed)
              switch (result.kind) {
                case "updated-local":
                  setUpdateNotice({
                    variant: "success",
                    message: `${result.label ?? target.id}: v${result.from || "?"} → v${result.to}.`,
                  })
                  break
                case "already-latest":
                  setUpdateNotice({
                    variant: "info",
                    message: `${result.label ?? target.id} is already on v${result.version}.`,
                  })
                  break
                case "remote-current":
                  setUpdateNotice({
                    variant: "info",
                    message: `${result.label ?? target.id} server is on v${result.version ?? "?"}.`,
                  })
                  break
                case "remote-update-available":
                  setUpdateNotice({
                    variant: "warn",
                    message: `${result.label ?? target.id} server v${result.current ?? "?"} → v${result.latest} available. Open the instance to apply.`,
                  })
                  break
                case "remote-unreachable":
                  setUpdateNotice({ variant: "error", message: `${result.label ?? target.id}: ${result.message}` })
                  break
                case "error":
                  setUpdateNotice({ variant: "error", message: `${result.label ?? target.id}: ${result.message}` })
                  break
              }
            } catch (err) {
              setUpdateNotice({
                variant: "error",
                message: err instanceof Error ? err.message : String(err),
              })
            } finally {
              setUpdateBusy(undefined)
            }
          }}
          onQuit={() => void finish(null)}
        />
      </Show>
    ),
    renderer,
  )

  onCleanup(() => {
    try {
      renderer.destroy()
    } catch {
      /* ignore */
    }
  })

  return outer
}
