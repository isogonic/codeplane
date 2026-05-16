import { splitProps, type ComponentProps, createMemo } from "solid-js"

/*
 * Affordance icon set — every name resolves to a real glyph from the
 * `@hugeicons/core-free-icons` package (stroke-rounded set, 24×24 viewBox,
 * 1.5px stroke). The previous incarnation of this component carried a
 * hand-rolled SVG path for every name; those were rough approximations
 * and visually inconsistent with the rest of the design. This file maps
 * each existing name to the closest semantic HugeIcon so every caller
 * that uses `<Icon name="…" />` gets the real library glyph without
 * touching its call site.
 *
 * Brand / file-type / provider / app icons stay on their own sprite
 * system — HugeIcons doesn't carry brand marks.
 */

import {
  AccessIcon,
  AlertCircleIcon,
  ArchiveIcon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowDownLeft01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  BrainIcon,
  BubbleChatIcon,
  Camera01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  ChatBotIcon,
  CheckListIcon,
  CheckmarkCircle01Icon,
  CloudUploadIcon,
  CodeIcon,
  CodeSimpleIcon,
  CodeSquareIcon,
  CollapseIcon,
  CommandLineIcon,
  Comment01Icon,
  Copy01Icon,
  CubeIcon,
  CursorPointer02Icon,
  Delete02Icon,
  DiscordIcon,
  Download01Icon,
  DragDropIcon,
  Edit01Icon,
  Edit02Icon,
  ExpandIcon,
  EyeIcon,
  FileEditIcon,
  Folder01Icon,
  FolderAddIcon,
  GitBranchIcon,
  GitForkIcon,
  Github01Icon,
  GlobeIcon,
  HashtagIcon,
  HelpCircleIcon,
  HierarchySquare01Icon,
  Home01Icon,
  Image01Icon,
  KeyboardIcon,
  LayoutBottomIcon,
  LayoutLeftIcon,
  LayoutRightIcon,
  LeftToRightListBulletIcon,
  Link01Icon,
  LinkSquare02Icon,
  McpServerIcon,
  Menu01Icon,
  MinusSignIcon,
  Notification01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  ProgressIcon,
  RefreshIcon,
  ReturnRequestIcon,
  Search01Icon,
  SearchList01Icon,
  ServerStack01Icon,
  Settings02Icon,
  Share01Icon,
  Shield01Icon,
  SidebarLeft01Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareArrowUpRightIcon,
  StopIcon,
  TerminalIcon,
  TextAlignRightIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons"

type IconData = readonly (readonly [string, { readonly [key: string]: string | number }])[]

const icons = {
  "align-right": TextAlignRightIcon,
  sparkle: SparklesIcon,
  globe: GlobeIcon,
  "arrow-up": ArrowUp01Icon,
  "arrow-left": ArrowLeft01Icon,
  "arrow-right": ArrowRight01Icon,
  archive: ArchiveIcon,
  "bubble-5": BubbleChatIcon,
  prompt: ChatBotIcon,
  brain: BrainIcon,
  fork: GitForkIcon,
  "bullet-list": LeftToRightListBulletIcon,
  "check-small": Tick01Icon,
  "chevron-down": ArrowDown01Icon,
  "chevron-left": ArrowLeft01Icon,
  "chevron-right": ArrowRight01Icon,
  "chevron-grabber-vertical": ArrowUpDownIcon,
  "chevron-double-right": ArrowRightDoubleIcon,
  "circle-x": CancelCircleIcon,
  close: Cancel01Icon,
  "close-small": Cancel01Icon,
  checklist: CheckListIcon,
  console: CommandLineIcon,
  ssh: AccessIcon,
  terminal: TerminalIcon,
  "terminal-active": TerminalIcon,
  review: FileEditIcon,
  "review-active": FileEditIcon,
  expand: ExpandIcon,
  collapse: CollapseIcon,
  code: CodeIcon,
  "code-lines": CodeSimpleIcon,
  "circle-ban-sign": CancelCircleIcon,
  "edit-small-2": Edit02Icon,
  eye: EyeIcon,
  enter: ReturnRequestIcon,
  folder: Folder01Icon,
  "file-tree": HierarchySquare01Icon,
  "file-tree-active": HierarchySquare01Icon,
  "magnifying-glass": Search01Icon,
  "plus-small": PlusSignIcon,
  plus: PlusSignIcon,
  screenshot: Camera01Icon,
  "new-session": Edit02Icon,
  "new-session-active": Edit02Icon,
  "pencil-line": PencilEdit01Icon,
  mcp: McpServerIcon,
  glasses: EyeIcon,
  "magnifying-glass-menu": SearchList01Icon,
  "window-cursor": CursorPointer02Icon,
  task: CheckListIcon,
  stop: StopIcon,
  status: ProgressIcon,
  "status-active": ProgressIcon,
  sidebar: SidebarLeft01Icon,
  "sidebar-active": SidebarLeft01Icon,
  "layout-left": LayoutLeftIcon,
  "layout-left-partial": LayoutLeftIcon,
  "layout-left-full": LayoutLeftIcon,
  "layout-right": LayoutRightIcon,
  "layout-right-partial": LayoutRightIcon,
  "layout-right-full": LayoutRightIcon,
  "square-arrow-top-right": SquareArrowUpRightIcon,
  "open-file": LinkSquare02Icon,
  "speech-bubble": BubbleChatIcon,
  comment: Comment01Icon,
  "folder-add-left": FolderAddIcon,
  home: Home01Icon,
  bell: Notification01Icon,
  github: Github01Icon,
  discord: DiscordIcon,
  "layout-bottom": LayoutBottomIcon,
  "layout-bottom-partial": LayoutBottomIcon,
  "layout-bottom-full": LayoutBottomIcon,
  "dot-grid": DragDropIcon,
  "circle-check": CheckmarkCircle01Icon,
  copy: Copy01Icon,
  check: Tick01Icon,
  photo: Image01Icon,
  share: Share01Icon,
  shield: Shield01Icon,
  download: Download01Icon,
  menu: Menu01Icon,
  server: ServerStack01Icon,
  branch: GitBranchIcon,
  edit: Edit01Icon,
  help: HelpCircleIcon,
  "settings-gear": Settings02Icon,
  dash: MinusSignIcon,
  "cloud-upload": CloudUploadIcon,
  trash: Delete02Icon,
  sliders: SlidersHorizontalIcon,
  keyboard: KeyboardIcon,
  selector: ArrowUpDownIcon,
  "arrow-down-to-line": Download01Icon,
  warning: AlertCircleIcon,
  reset: RefreshIcon,
  link: Link01Icon,
  providers: CubeIcon,
  models: SparklesIcon,
  "arrow-undo-down": ArrowDownLeft01Icon,
  name: HashtagIcon,
  "code-square": CodeSquareIcon,
  "data-transfer": ArrowDataTransferHorizontalIcon,
} as const satisfies Record<string, IconData>

export interface IconProps extends ComponentProps<"svg"> {
  name: keyof typeof icons
  size?: "x-small" | "small" | "normal" | "medium" | "large"
}

export function Icon(props: IconProps) {
  const [local, others] = splitProps(props, ["name", "size", "class", "classList"])
  const inner = createMemo(() => serializeIcon(icons[local.name]))
  return (
    <div data-component="icon" data-size={local.size || "normal"}>
      <svg
        data-slot="icon-svg"
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
        fill="none"
        viewBox="0 0 24 24"
        innerHTML={inner()}
        aria-hidden="true"
        {...others}
      />
    </div>
  )
}

const serializeIcon = (icon: IconData): string => {
  let out = ""
  for (const [tag, attrs] of icon) {
    out += `<${tag}`
    for (const k in attrs) {
      if (k === "key") continue
      const value = attrs[k]
      out += ` ${camelToKebab(k)}="${escapeAttribute(String(value))}"`
    }
    out += " />"
  }
  return out
}

const camelToKebab = (key: string): string => {
  let out = ""
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    if (ch >= 65 && ch <= 90) {
      if (i !== 0) out += "-"
      out += String.fromCharCode(ch + 32)
    } else {
      out += key[i]
    }
  }
  return out
}

const escapeAttribute = (value: string): string =>
  value.replace(/[&"<]/g, (c) => {
    if (c === "&") return "&amp;"
    if (c === '"') return "&quot;"
    return "&lt;"
  })
