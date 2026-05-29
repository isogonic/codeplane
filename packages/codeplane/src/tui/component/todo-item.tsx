import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  // Tolerate non-canonical casing/spacing the model may emit ("Completed",
  // "In Progress") even though the server normalizes most paths.
  const status = () => (props.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  const marker = () => {
    switch (status()) {
      case "completed":
        return "✓"
      case "in_progress":
        return "•"
      case "cancelled":
        return "✕"
      default:
        return " "
    }
  }
  const fg = () => (status() === "in_progress" ? theme.warning : theme.textMuted)

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
