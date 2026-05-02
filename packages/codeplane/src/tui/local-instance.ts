// Thin re-export — the actual manager lives in @codeplane-ai/shared/local-instance
// so the TUI and the Desktop main process stay perfectly in lockstep.
export {
  createLocalInstanceManager,
  findListeningPort,
  type LocalInstanceManager,
  type LocalInstanceManagerInput,
  type LocalInstanceProgress,
  type LocalInstanceStatus,
  type RunningLocalInstance,
} from "@codeplane-ai/shared/local-instance"
import { resolveCodeplaneLocalTarget } from "@codeplane-ai/shared/local-runtime"

export type LocalTarget = ReturnType<typeof resolveCodeplaneLocalTarget>
export const resolveLocalTarget = async (): Promise<LocalTarget> => resolveCodeplaneLocalTarget()
