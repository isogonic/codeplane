import type { CronRunStatus } from "@/utils/cron-client"
import { canCancelCronRunStatus, cronSidebarStopButtonClass } from "./cron-stop"

export type StopClick = (event: MouseEvent) => void

export function getCronTaskStopAction(props: {
  status?: CronRunStatus
  label: string
  disabled?: boolean
  onClick: StopClick
}) {
  if (!canCancelCronRunStatus(props.status)) return
  return props
}

export function getCronSidebarStopAction(props: {
  status: CronRunStatus
  label: string
  disabled?: boolean
  mobile?: boolean
  onClick: StopClick
}) {
  if (!canCancelCronRunStatus(props.status)) return
  return {
    ...props,
    class: `absolute right-1 top-1/2 -translate-y-1/2 ${cronSidebarStopButtonClass(props.mobile)}`,
  }
}

export function getCronSessionStopAction(props: {
  visible?: boolean
  label: string
  stopping?: boolean
  onClick: StopClick
}) {
  if (!props.visible) return
  return props
}
