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

import AccessIcon from "@hugeicons/core-free-icons/AccessIcon"
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import ArchiveIcon from "@hugeicons/core-free-icons/ArchiveIcon"
import ArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/ArrowDataTransferHorizontalIcon"
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import ArrowDownLeft01Icon from "@hugeicons/core-free-icons/ArrowDownLeft01Icon"
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import ArrowRightDoubleIcon from "@hugeicons/core-free-icons/ArrowRightDoubleIcon"
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon"
import ArrowUpDownIcon from "@hugeicons/core-free-icons/ArrowUpDownIcon"
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon"
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon"
import Camera01Icon from "@hugeicons/core-free-icons/Camera01Icon"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import CancelCircleIcon from "@hugeicons/core-free-icons/CancelCircleIcon"
import ChatBotIcon from "@hugeicons/core-free-icons/ChatBotIcon"
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon"
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon"
import CloudUploadIcon from "@hugeicons/core-free-icons/CloudUploadIcon"
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon"
import CodeSimpleIcon from "@hugeicons/core-free-icons/CodeSimpleIcon"
import CodeSquareIcon from "@hugeicons/core-free-icons/CodeSquareIcon"
import CollapseIcon from "@hugeicons/core-free-icons/CollapseIcon"
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon"
import Comment01Icon from "@hugeicons/core-free-icons/Comment01Icon"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import CubeIcon from "@hugeicons/core-free-icons/CubeIcon"
import CursorPointer02Icon from "@hugeicons/core-free-icons/CursorPointer02Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon"
import DragDropIcon from "@hugeicons/core-free-icons/DragDropIcon"
import Edit01Icon from "@hugeicons/core-free-icons/Edit01Icon"
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon"
import ExpandIcon from "@hugeicons/core-free-icons/ExpandIcon"
import EyeIcon from "@hugeicons/core-free-icons/EyeIcon"
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon"
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon"
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon"
import Github01Icon from "@hugeicons/core-free-icons/Github01Icon"
import GlobeIcon from "@hugeicons/core-free-icons/GlobeIcon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon"
import HierarchySquare01Icon from "@hugeicons/core-free-icons/HierarchySquare01Icon"
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon"
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon"
import KeyboardIcon from "@hugeicons/core-free-icons/KeyboardIcon"
import LayoutBottomIcon from "@hugeicons/core-free-icons/LayoutBottomIcon"
import LayoutLeftIcon from "@hugeicons/core-free-icons/LayoutLeftIcon"
import LayoutRightIcon from "@hugeicons/core-free-icons/LayoutRightIcon"
import LeftToRightListBulletIcon from "@hugeicons/core-free-icons/LeftToRightListBulletIcon"
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon"
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon"
import McpServerIcon from "@hugeicons/core-free-icons/McpServerIcon"
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon"
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon"
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon"
import PencilEdit01Icon from "@hugeicons/core-free-icons/PencilEdit01Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import ProgressIcon from "@hugeicons/core-free-icons/ProgressIcon"
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon"
import ReturnRequestIcon from "@hugeicons/core-free-icons/ReturnRequestIcon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import SearchList01Icon from "@hugeicons/core-free-icons/SearchList01Icon"
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon"
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon"
import Share01Icon from "@hugeicons/core-free-icons/Share01Icon"
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon"
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon"
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon"
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon"
import SquareArrowUpRightIcon from "@hugeicons/core-free-icons/SquareArrowUpRightIcon"
import StopIcon from "@hugeicons/core-free-icons/StopIcon"
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon"
import TextAlignRightIcon from "@hugeicons/core-free-icons/TextAlignRightIcon"
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon"

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
