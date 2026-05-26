import { describe, expect, test } from "bun:test"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { RemoteInstanceForm } from "@/tui/boot/remote-form"
import type { InstanceService } from "@/tui/instance-service"
import { withHarness } from "../harness"

const service = {
  cacheInfo: async () => ({ exists: false, bytes: 0, areas: [] }),
  clearCache: async () => ({ bytes: 0, areas: [] }),
  probe: async () => ({ ok: true, version: "29.0.0" }),
  save: async () => undefined,
} as unknown as InstanceService

function basic(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`
}

function RemoteFixture(props: { existing: SavedInstance }) {
  return (
    <RemoteInstanceForm
      service={service}
      takenIds={new Set()}
      existing={props.existing}
      onDone={() => undefined}
    />
  )
}

describe("remote instance form hardening", () => {
  test("does not render password characters while the password field is focused", async () => {
    await withHarness(
      () => (
        <RemoteFixture
          existing={{
            id: "remote",
            label: "Remote",
            url: "https://codeplane.example.com",
            headers: {
              Authorization: basic("devin", "SecretTailQ"),
            },
          }}
        />
      ),
      async (h) => {
        await h.pressSeq(["tab", "tab", "tab"])
        const text = h.text()

        expect(text).not.toContain("SecretTailQ")
        expect(text).not.toContain("Q▎")
        expect(text).toContain("•••••••••••▎")
      },
      { width: 110, height: 34 },
    )
  })

  test("redacts sensitive header values in the form display", async () => {
    await withHarness(
      () => (
        <RemoteFixture
          existing={{
            id: "remote",
            label: "Remote",
            url: "https://codeplane.example.com",
            headers: {
              Cookie: "session=topsecret",
              "X-API-Key": "key-12345",
              "X-Custom-Token": "token-67890",
              "X-Trace": "visible-trace-id",
            },
          }}
        />
      ),
      async (h) => {
        const text = h.text()

        expect(text).not.toContain("session=topsecret")
        expect(text).not.toContain("key-12345")
        expect(text).not.toContain("token-67890")
        expect(text).toContain("Cookie: <redacted>")
        expect(text).toContain("X-API-Key: <redacted>")
        expect(text).toContain("X-Custom-Token: <redacted>")
        expect(text).toContain("X-Trace: visible-trace-id")
      },
      { width: 120, height: 36 },
    )
  })
})
