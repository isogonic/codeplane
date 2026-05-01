import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("skill route", () => {
  test("lists skills with instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    const skillDir = path.join(tmp.path, ".codeplane", "skills", "release-helper")
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      ["---", "name: release-helper", "description: Helps with releases.", "---", "", "Release instructions."].join(
        "\n",
      ),
    )

    const res = await Server.Default().app.request(`/skill?directory=${encodeURIComponent(tmp.path)}`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Array<{
      name: string
      description: string
      location: string
      content: string
    }>
    const skill = body.find((item) => item.name === "release-helper")

    expect(skill?.description).toBe("Helps with releases.")
    expect(skill?.location).toContain("/.codeplane/skills/release-helper/SKILL.md")
    expect(skill?.content).toContain("Release instructions.")
  })
})
