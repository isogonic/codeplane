import type { CronRunStatus } from "@/utils/cron-client"

export const canCancelCronRunStatus = (status: CronRunStatus | undefined) =>
  status === "queued" || status === "running"

export const cronSidebarStopButtonClass = (mobile?: boolean) =>
  mobile
    ? "pointer-events-auto opacity-100"
    : "pointer-events-none opacity-0 transition-opacity group-hover/session:pointer-events-auto group-hover/session:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"

export const canShowCronSessionStop = (options: {
  sessionID?: string
  runID?: string
  busy: boolean
}) => !!options.sessionID && !!options.runID && options.busy
