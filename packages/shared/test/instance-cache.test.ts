import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { clearInstanceCache, getInstanceCacheInfo } from "../src/instance-cache"

async function tempHome() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-instance-cache-"))
  return {
    agents: path.join(root, "agents"),
    bin: path.join(root, "bin"),
    cache: path.join(root, "cache"),
    commands: path.join(root, "commands"),
    config: root,
    data: path.join(root, "data"),
    globalRoot: root,
    home: root,
    instances: path.join(root, "instances.json"),
    local_server: path.join(root, "local_server"),
    local_server_binaries: path.join(root, "local_server", "binaries"),
    log: path.join(root, "log"),
    plugins: path.join(root, "plugins"),
    root,
    skills: path.join(root, "skills"),
    state: path.join(root, "state"),
  }
}

describe("instance-cache", () => {
  test("reports and clears per-instance cache folders", async () => {
    const home = await tempHome()
    await fs.mkdir(path.join(home.globalRoot, "instances", "remote-a", "cache", "nested"), { recursive: true })
    await fs.writeFile(path.join(home.globalRoot, "instances", "remote-a", "cache", "nested", "a.txt"), "abc")
    await fs.mkdir(path.join(home.local_server, "remote-a", "cache"), { recursive: true })
    await fs.writeFile(path.join(home.local_server, "remote-a", "cache", "b.txt"), "defg")

    const before = await getInstanceCacheInfo("remote-a", home)
    expect(before.exists).toBe(true)
    expect(before.bytes).toBe(7)
    expect(before.areas.map((area) => area.key).sort()).toEqual(["instance", "local-server"])

    const cleared = await clearInstanceCache("remote-a", home)
    expect(cleared.bytes).toBe(7)
    expect(await getInstanceCacheInfo("remote-a", home)).toEqual({ exists: false, bytes: 0, areas: [] })

    await fs.rm(home.root, { force: true, recursive: true })
  })

  test("rejects ids that escape cache roots", async () => {
    const home = await tempHome()
    await expect(getInstanceCacheInfo("../outside", home)).rejects.toThrow(/Invalid instance id/)
    await fs.rm(home.root, { force: true, recursive: true })
  })
})
