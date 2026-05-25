import { describe, expect, test } from "bun:test"
import { UIRoutes } from "../../src/server/routes/ui"

describe("UIRoutes", () => {
  test("returns an explicit 503 when a build has no embedded UI and no dev UI URL", async () => {
    const app = UIRoutes()
    const response = await app.request("/")
    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("built without an embedded web UI"),
      }),
    )
  })
})
