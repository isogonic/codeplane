// TUI-local stub for @/tool/shell. The TUI references this namespace mostly
// for type purposes (shell tool kind in renders); the actual shell execution
// happens server-side. We re-export ShellID for compatibility, and provide a
// minimal `ShellTool` placeholder shape used by the session route's Shell
// renderer. The shape is intentionally loose — only `id`/`Parameters` get
// referenced via inferred types.
export * from "./tool-shell-id"

export const ShellTool = {
  id: "bash" as const,
  Parameters: {} as {
    command: string
    description?: string
    timeout?: number
    workdir?: string
  },
  Metadata: {} as { command: string; cwd: string; output: string; exit: number },
}
export type ShellTool = typeof ShellTool
