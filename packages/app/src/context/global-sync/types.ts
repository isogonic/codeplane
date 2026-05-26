import type {
  Agent,
  Command,
  Config,
  LspStatus,
  McpStatus,
  Message,
  Part,
  Path,
  PermissionRequest,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
  VcsInfo,
} from "@codeplane-ai/sdk/v2/client"
import type { Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

export type ProjectMeta = {
  name?: string
  icon?: {
    override?: string
    color?: string
  }
  commands?: {
    start?: string
  }
}

export type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  command: Command[]
  project: string
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
  provider_ready: boolean
  provider: ProviderListResponse
  config: Config
  path: Path
  session: Session[]
  sessionTotal: number
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: SnapshotFileDiff[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  mcp_ready: boolean
  mcp: {
    [name: string]: McpStatus
  }
  lsp_ready: boolean
  lsp: LspStatus[]
  vcs: VcsInfo | undefined
  limit: number
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
  /**
   * Buffer for `message.part.delta` events that arrive before the
   * corresponding `message.part.updated` has created the part in the store.
   *
   * The server publishes `message.part.updated` via `SyncEvent.run` which
   * schedules its bus publish asynchronously (`void publish(...)`), while
   * `message.part.delta` goes through `bus.publish` directly via `yield*`.
   * The two Effect fibers can interleave so that a delta reaches the
   * client before the `message.part.updated` that introduces its part.
   * Without buffering, the dropped first delta(s) made streaming text
   * appear frozen until the next full part snapshot — which is exactly
   * what users saw as "switch session and back to see changes".
   *
   * Keyed by `messageID -> partID -> field -> accumulated delta string`.
   */
  pendingDelta: {
    [messageID: string]: {
      [partID: string]: {
        [field: string]: string
      }
    }
  }
}

export type VcsCache = {
  store: Store<{ value: VcsInfo | undefined }>
  setStore: SetStoreFunction<{ value: VcsInfo | undefined }>
  ready: Accessor<boolean>
}

export type MetaCache = {
  store: Store<{ value: ProjectMeta | undefined }>
  setStore: SetStoreFunction<{ value: ProjectMeta | undefined }>
  ready: Accessor<boolean>
}

export type IconCache = {
  store: Store<{ value: string | undefined }>
  setStore: SetStoreFunction<{ value: string | undefined }>
  ready: Accessor<boolean>
}

export type ChildOptions = {
  bootstrap?: boolean
}

export type DirState = {
  lastAccessAt: number
}

export type EvictPlan = {
  stores: string[]
  state: Map<string, DirState>
  pins: Set<string>
  max: number
  ttl: number
  now: number
}

export type DisposeCheck = {
  directory: string
  hasStore: boolean
  pinned: boolean
  booting: boolean
  loadingSessions: boolean
}

export type RootLoadArgs = {
  directory: string
  limit?: number
  list: (query: { directory: string; roots: true; limit?: number; archived?: boolean }) => Promise<{ data?: Session[] }>
}

export type RootLoadResult = {
  data?: Session[]
  limit?: number
  limited: boolean
}

export const MAX_DIR_STORES = 30
export const DIR_IDLE_TTL_MS = 20 * 60 * 1000
export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000
export const SESSION_RECENT_LIMIT = 50
export const SESSION_ALL_LIMIT = 10_000
