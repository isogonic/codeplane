import { useTheme } from "../context/theme"
import { isCancelled, isCompleted, isInProgress, todoStatus } from "@codeplane-ai/shared/todo-progress"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const marker = () => {
    if (isCompleted({ status: props.status })) return "✓"
    if (isInProgress({ status: props.status })) return "•"
    if (isCancelled({ status: props.status })) return "✕"
    return " "
  }
  const fg = () => (isInProgress({ status: props.status }) ? theme.warning : theme.textMuted)

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: fg() }}>
        [{marker()}]{" "}
      </text>
      <text flexGrow={1} wrapMode="word" style={{ fg: fg() }}>
        {props.content}
      </text>
    </box>
  )
}
