import { Show } from "solid-js"
import { Button } from "@codeplane-ai/ui/button"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Tooltip } from "@codeplane-ai/ui/tooltip"
import type { CronRunStatus } from "@/utils/cron-client"
import {
  getCronSessionStopAction,
  getCronSidebarStopAction,
  getCronTaskStopAction,
  type StopClick,
} from "./cron-stop-model"

export function CronTaskStopAction(props: {
  status?: CronRunStatus
  label: string
  disabled?: boolean
  onClick: StopClick
}) {
  const action = getCronTaskStopAction(props)
  return (
    <Show when={action} keyed>
      {(action) => (
        <Tooltip value={props.label} placement="top">
          <IconButton
            icon="stop"
            variant="ghost"
            size="normal"
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
          />
        </Tooltip>
      )}
    </Show>
  )
}

export function CronSidebarStopAction(props: {
  status: CronRunStatus
  label: string
  disabled?: boolean
  mobile?: boolean
  onClick: StopClick
}) {
  const action = getCronSidebarStopAction(props)
  return (
    <Show when={action} keyed>
      {(action) => (
        <div class={action.class}>
          <Tooltip value={action.label} placement="top">
            <IconButton
              icon="stop"
              variant="ghost"
              size="small"
              aria-label={action.label}
              disabled={action.disabled}
              onClick={action.onClick}
            />
          </Tooltip>
        </div>
      )}
    </Show>
  )
}

export function CronSessionStopAction(props: {
  visible?: boolean
  label: string
  stopping?: boolean
  onClick: StopClick
}) {
  const action = getCronSessionStopAction(props)
  return (
    <Show when={action} keyed>
      {(action) => (
        <Button
          type="button"
          variant="secondary"
          size="small"
          icon="stop"
          disabled={action.stopping}
          onClick={action.onClick}
          class="shrink-0"
        >
          {action.label}
        </Button>
      )}
    </Show>
  )
}
