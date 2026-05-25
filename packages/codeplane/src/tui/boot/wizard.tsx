// Boot wizard: instance picker → (optional create-local form) → directory
// picker. Renders before the main TUI hands off to `tui()` from `app.tsx`.
// Steps share a single CliRenderer that is fully destroyed before this
// promise resolves so the main TUI starts on a clean screen.
import { createSignal, createMemo, For, Show, batch, onCleanup } from "solid-js"
import { render, useKeyboard } from "@opentui/solid"
import { CliRenderEvents, createCliRenderer, type CliRenderer, TextAttributes } from "@opentui/core"
import path from "node:path"
import fs from "node:fs/promises"
import { homedir } from "node:os"
import { instanceEditorKind, type SavedInstance } from "@codeplane-ai/shared/instance"
import type { InstanceService } from "../instance-service"
import { tuiT } from "@/tui/i18n"
import {
  BootPaletteProvider,
  createBootPaletteFromTerminal,
  defaultBootPalette,
  Header,
  SectionHeading,
  StatusBar,
  useBootPalette,
} from "./primitives"
import { LocalInstanceForm } from "./local-form"
import { RemoteInstanceForm } from "./remote-form"

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

type Step =
  | "instance"
  | "create-local"
  | "edit-local"
  | "create-remote"
  | "edit-remote"
  | "directory"

function remoteAccessHost(instance: SavedInstance) {
  try {
    return new URL(instance.url).host
  } catch {
    return undefined
  }
}

// ---------- Step 1: instance picker ----------

function InstancePicker(props: {
  instances: SavedInstance[]
  selected: number
  onMove: (delta: number) => void
  onPick: (i: number) => void
  onCreateLocal: () => void
  onCreateRemote: () => void
  onEdit: (i: number) => void
  onDelete: (i: number) => void
  onUpdate: (i: number) => void
  onQuit: () => void
  busy?: { message: string; percent?: number }
  notice?: { variant: "success" | "warn" | "error" | "info"; message: string }
}) {
  const palette = useBootPalette()
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
    // `n` was historically "new (local)". Keeping it bound to local
    // creation preserves muscle memory for existing users; the new `r`
    // key adds the remote-creation path that didn't exist before.
    // `l` stays as a pure local alias.
    else if (evt.name === "n" || evt.name === "l") props.onCreateLocal()
    else if (evt.name === "r") props.onCreateRemote()
    else if (evt.name === "e") props.onEdit(props.selected)
    else if (evt.name === "d" || evt.name === "delete") props.onDelete(props.selected)
    else if (evt.name === "u") props.onUpdate(props.selected)
    else if (evt.name === "q" || (evt.ctrl && evt.name === "c")) props.onQuit()
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette().bg}>
      <Header instance="setup" cwd={homeify(process.cwd())} status="Ready" />
      <SectionHeading>{tuiT("boot.instancePicker.heading")}</SectionHeading>
      <Show when={props.instances.length === 0}>
        <box marginTop={1} paddingX={2} flexDirection="row">
          <text fg={palette().fgMuted}>{tuiT("boot.instancePicker.emptyPrefix")}</text>
          <text fg={palette().accent}>n</text>
          <text fg={palette().fgMuted}>{tuiT("boot.instancePicker.emptyMiddle")}</text>
          <text fg={palette().accent}>r</text>
          <text fg={palette().fgMuted}>{tuiT("boot.instancePicker.emptySuffix")}</text>
        </box>
      </Show>
      <box flexDirection="column" marginTop={1} paddingX={2}>
        <For each={props.instances}>
          {(inst, i) => {
            const isSelected = createMemo(() => i() === props.selected)
            const local = inst.url.startsWith("local://") || !!inst.local
            const accessHost = remoteAccessHost(inst)
            return (
              <box flexDirection="column">
                <box flexDirection="row">
                  <text fg={isSelected() ? palette().accent : palette().divider}>
                    {isSelected() ? "▍" : " "}
                  </text>
                  <text fg={local ? palette().success : palette().info}>
                    {`  ${local ? tuiT("boot.instancePicker.kind.local") : tuiT("boot.instancePicker.kind.remote")}  `}
                  </text>
                  <text
                    fg={isSelected() ? palette().fg : palette().fgMuted}
                    attributes={isSelected() ? TextAttributes.BOLD : 0}
                  >
                    {inst.label ?? inst.id}
                  </text>
                  <text fg={palette().fgDim}>{`   ${inst.url}`}</text>
                </box>
                <Show when={isSelected()}>
                  <box flexDirection="row" paddingLeft={4}>
                    <text fg={palette().fgDim}>
                      {local
                        ? accessHost
                          ? tuiT("boot.instancePicker.localHostedHint", {
                              version: inst.local?.binaryVersion || "auto",
                              host: accessHost,
                            })
                          : tuiT("boot.instancePicker.localHint", { version: inst.local?.binaryVersion || "auto" })
                        : tuiT("boot.instancePicker.remoteHint", { host: accessHost ?? inst.url })}
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
                ? palette().success
                : props.notice!.variant === "error"
                  ? palette().error
                  : props.notice!.variant === "warn"
                    ? palette().warn
                    : palette().info
            }
            attributes={TextAttributes.BOLD}
          >
            {props.notice!.variant === "success"
              ? "Ready"
              : props.notice!.variant === "error"
                ? "Error"
                : props.notice!.variant === "warn"
                  ? "Warning"
                  : "Info"}
          </text>
          <text fg={palette().fgDim}>  </text>
          <text fg={palette().fg}>{props.notice!.message}</text>
        </box>
      </Show>
      <Show when={props.busy}>
        <box marginTop={1} paddingX={2} flexDirection="row">
          <text fg={palette().accent} attributes={TextAttributes.BOLD}>
            Working
          </text>
          <text fg={palette().fgDim}>  </text>
          <text fg={palette().fg}>{props.busy!.message}</text>
          <Show when={typeof props.busy!.percent === "number"}>
            <text fg={palette().fgDim}>{`  ${Math.round(props.busy!.percent ?? 0)}%`}</text>
          </Show>
        </box>
      </Show>
      <box flexGrow={1} />
      <StatusBar
        hints={[
          { keys: "↵", label: tuiT("common.open") },
          { keys: "e", label: tuiT("common.edit") },
          { keys: "u", label: tuiT("common.update") },
          { keys: "n", label: tuiT("common.newLocal") },
          { keys: "r", label: tuiT("common.newRemote") },
          { keys: "d", label: tuiT("common.delete") },
          { keys: "↑↓", label: tuiT("common.navigate") },
          { keys: "q", label: tuiT("common.quit") },
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
  const palette = useBootPalette()
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
    <box flexDirection="column" flexGrow={1} backgroundColor={palette().bg}>
      <Header
        instance={props.instance.label ?? props.instance.id}
        cwd={homeify(cwd())}
        status="Connected"
      />
      <SectionHeading>{tuiT("boot.directory.heading")}</SectionHeading>
      <box marginTop={1} paddingX={2}>
        <text fg={palette().fg}>{tuiT("boot.directory.pickForPrefix")}</text>
        <text fg={palette().accent} attributes={TextAttributes.BOLD}>
          {props.instance.label ?? props.instance.id}
        </text>
        <text fg={palette().fg}>.</text>
      </box>

      <box marginTop={1} flexDirection="row" paddingX={2}>
        <text fg={palette().fgMuted}>{tuiT("boot.directory.search")} </text>
        <text fg={palette().divider}>›</text>
        <text fg={palette().accent}> {search() || " "}</text>
        <text fg={palette().fg}>▎</text>
      </box>

      <box marginTop={1} flexDirection="row" paddingX={2}>
        <text fg={palette().fgDim}>{tuiT("boot.directory.controls")}</text>
      </box>

      <box flexDirection="column" marginTop={1} paddingX={2}>
        <Show when={filtered().length === 0}>
          <text fg={palette().fgMuted}>
            {search() ? tuiT("boot.directory.noMatches", { search: search() }) : tuiT("boot.directory.empty")}
          </text>
        </Show>
        <For each={visible()}>
          {(entry, i) => {
            const realIdx = createMemo(() => scroll() + i())
            const isSelected = createMemo(() => realIdx() === selected())
            return (
              <box flexDirection="row">
                <text fg={isSelected() ? palette().accent : palette().divider}>
                  {isSelected() ? "▍ " : "  "}
                </text>
                <text
                  fg={isSelected() ? palette().fg : entry.isDir ? palette().fg : palette().fgMuted}
                  attributes={isSelected() ? TextAttributes.BOLD : 0}
                >
                  {entry.name}
                </text>
                <Show when={entry.isDir}>
                  <text fg={palette().fgDim}>/</text>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={filtered().length > VIEWPORT}>
          <box marginTop={1}>
            <text fg={palette().fgDim}>
              {tuiT("boot.directory.showing", {
                start: scroll() + 1,
                end: Math.min(scroll() + VIEWPORT, filtered().length),
                total: filtered().length,
              })}
            </text>
          </box>
        </Show>
      </box>

      <Show when={error()}>
        <box marginTop={1} paddingX={2}>
          <text fg={palette().warn}>{error()}</text>
        </box>
      </Show>

      <box flexGrow={1} />
      <StatusBar
        hints={[
          { keys: "↵", label: search() ? tuiT("boot.directory.openHereOrDrillIn") : tuiT("common.openHere") },
          { keys: "→", label: tuiT("common.enterDir") },
          { keys: "←/⌫", label: tuiT("common.up") },
          { keys: "ctrl+h", label: tuiT("common.home") },
          { keys: "esc", label: search() ? tuiT("common.clear") : tuiT("common.back") },
          { keys: "ctrl+c", label: tuiT("common.quit") },
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
      renderer.off(CliRenderEvents.THEME_MODE, handleThemeMode)
      renderer.destroy()
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 30))
    resolveOuter(selection)
  }

  const [instances, setInstances] = createSignal(input.instances.slice())
  const [step, setStep] = createSignal<Step>("instance")
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [defaultDir] = createSignal(input.defaultDirectory ?? process.cwd())
  const [updateBusy, setUpdateBusy] = createSignal<{ message: string; percent?: number } | undefined>(undefined)
  const [updateNotice, setUpdateNotice] = createSignal<
    { variant: "success" | "warn" | "error" | "info"; message: string } | undefined
  >(undefined)
  const initialMode = (await renderer.waitForThemeMode(250).catch(() => undefined)) ?? "dark"
  const [bootPalette, setBootPalette] = createSignal(defaultBootPalette)

  const refreshBootPalette = async (mode = initialMode) => {
    try {
      const colors = await renderer.getPalette({ size: 16 })
      setBootPalette(createBootPaletteFromTerminal(colors, mode))
    } catch {
      setBootPalette(defaultBootPalette)
    }
  }

  await refreshBootPalette(initialMode)
  const handleThemeMode = (mode: "dark" | "light") => {
    void refreshBootPalette(mode)
  }
  renderer.on(CliRenderEvents.THEME_MODE, handleThemeMode)

  // Reused by both create-local and create-remote `onDone` callbacks so
  // the post-creation behavior (append to picker, select the new entry,
  // navigate back) is identical regardless of which form the user came
  // from. Also handles the edit case: if the saved id matches an entry
  // already in the list, replace it in place instead of appending so
  // the picker doesn't grow a duplicate row.
  const acceptNewInstance = (instance: SavedInstance) => {
    const list = instances()
    const existingIdx = list.findIndex((i) => i.id === instance.id)
    if (existingIdx >= 0) {
      const next = list.map((entry, idx) => (idx === existingIdx ? instance : entry))
      setInstances(next)
      setSelectedIdx(existingIdx)
    } else {
      const next = [...list, instance]
      setInstances(next)
      setSelectedIdx(next.length - 1)
    }
    setStep("instance")
  }

  await render(
    () => (
      <BootPaletteProvider palette={bootPalette}>
        <Show
          when={step() === "instance"}
          fallback={
            <Show
              when={step() === "create-local" || step() === "edit-local"}
              fallback={
                <Show
                  when={step() === "create-remote" || step() === "edit-remote"}
                  fallback={
                    <DirectoryPicker
                      instance={instances()[selectedIdx()]}
                      initialDirectory={defaultDir()}
                      onConfirm={(dir) =>
                        void finish({ instance: instances()[selectedIdx()], directory: dir })
                      }
                      onBack={() => setStep("instance")}
                      onQuit={() => void finish(null)}
                    />
                  }
                >
                  <RemoteInstanceForm
                    service={input.service}
                    takenIds={
                      new Set(
                        instances()
                          .filter((i) => i.id !== instances()[selectedIdx()]?.id || step() !== "edit-remote")
                          .map((i) => i.id),
                      )
                    }
                    existing={step() === "edit-remote" ? instances()[selectedIdx()] : undefined}
                    onDone={(result) => {
                      if ("cancel" in result) {
                        setStep("instance")
                        return
                      }
                      acceptNewInstance(result.instance)
                    }}
                  />
                </Show>
              }
            >
              <LocalInstanceForm
                service={input.service}
                takenIds={
                  new Set(
                    instances()
                      .filter((i) => i.id !== instances()[selectedIdx()]?.id || step() !== "edit-local")
                      .map((i) => i.id),
                  )
                }
                existing={step() === "edit-local" ? instances()[selectedIdx()] : undefined}
                onDone={(result) => {
                  if ("cancel" in result) {
                    setStep("instance")
                    return
                  }
                  acceptNewInstance(result.instance)
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
              const picked = instances()[selectedIdx()]
              if (!picked) return
              const isLocal = picked.url.startsWith("local://") || !!picked.local
              if (isLocal) {
                setStep("directory")
              } else {
                void finish({ instance: picked })
              }
            }}
            onCreateLocal={() => setStep("create-local")}
            onCreateRemote={() => setStep("create-remote")}
            onEdit={(idx) => {
              const target = instances()[idx]
              if (!target) return
              setSelectedIdx(idx)
              setUpdateNotice(undefined)
              setStep(instanceEditorKind(target) === "local" ? "edit-local" : "edit-remote")
            }}
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
              setUpdateBusy({ message: "Starting update..." })
              try {
                const result = await input.service.updateInstance(target, (progress) => {
                  setUpdateBusy({
                    message: progress.message,
                    percent: progress.phase === "downloading" ? progress.percent : undefined,
                  })
                })
                const refreshed = await input.service.list()
                setInstances(refreshed)
                switch (result.kind) {
                  case "updated-local":
                    setUpdateNotice({
                      variant: "success",
                      message: `${result.label ?? target.id}: v${result.from || "?"} -> v${result.to}.`,
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
                      message: `${result.label ?? target.id} server v${result.current ?? "?"} -> v${result.latest} available. Open the instance to apply.`,
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
      </BootPaletteProvider>
    ),
    renderer,
  )

  onCleanup(() => {
    try {
      renderer.off(CliRenderEvents.THEME_MODE, handleThemeMode)
      renderer.destroy()
    } catch {
      /* ignore */
    }
  })

  return outer
}
