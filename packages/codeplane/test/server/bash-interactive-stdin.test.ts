import { describe, expect, test } from "bun:test"
import { spawn as ptySpawn } from "bun-pty"
import { register, writeInput, killProc } from "../../src/tool/bash_interactive_runtime"

// Drive the low-level runtime stdin primitive end-to-end without the LLM:
//   1. Spawn a real PTY through bun-pty.
//   2. Register it with the bash_interactive_runtime under a known callID.
//   3. Call writeInput(callID, …) — same primitive the bash_interactive tool
//      uses internally after the agent supplies an answer or asks a question.
//   4. Assert the PTY's `read` / shell process actually saw the bytes by
//      capturing stdout and looking for the echo.
describe("bash_interactive_runtime stdin round-trip", () => {
  if (process.platform === "win32") return

  test("writeInput delivers raw data into the running PTY's stdin and the command sees it", async () => {
    const callID = "rt-test-" + Math.random().toString(36).slice(2, 8)
    const proc = ptySpawn("/bin/sh", ["-c", "printf 'go: '; read x; printf 'GOT=%s\\n' \"$x\""], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
    })

    let output = ""
    proc.onData((chunk) => {
      output += chunk
    })

    register(callID, { proc, sessionID: "ses_test" })

    // Wait for the prompt to appear before writing.
    const start = Date.now()
    while (!output.includes("go: ") && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(output).toContain("go: ")

    const ok = writeInput(callID, "MY-CODE\r")
    expect(ok).toBe(true)

    // Wait for the command to process and exit.
    const exited = await new Promise<{ exitCode: number }>((resolve) => {
      proc.onExit(({ exitCode }) => resolve({ exitCode: exitCode ?? -1 }))
    })

    expect(exited.exitCode).toBe(0)
    expect(output).toContain("GOT=MY-CODE")
  }, 10_000)

  test("writeInput returns false for an unknown callID", () => {
    expect(writeInput("definitely-not-registered", "anything")).toBe(false)
  })

  test("killProc returns false for an unknown callID", () => {
    expect(killProc("definitely-not-registered")).toBe(false)
  })
})
