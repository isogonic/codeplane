import fs from "node:fs/promises"
import path from "node:path"
import type { SavedInstance } from "@codeplane-ai/shared/instance"

type State = {
  instances: SavedInstance[]
  lastInstanceID?: string
}

async function read(file: string): Promise<State> {
  return fs
    .readFile(file, "utf8")
    .then((value) => JSON.parse(value) as State)
    .then((value) => ({
      instances: Array.isArray(value.instances) ? value.instances : [],
      lastInstanceID: value.lastInstanceID,
    }))
    .catch(() => ({ instances: [] }))
}

async function write(file: string, value: State) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function createInstanceStore(file: string) {
  const list = () => read(file).then((state) => state.instances)
  const getLast = () => read(file).then((state) => state.lastInstanceID)

  async function save(instance: SavedInstance) {
    const state = await read(file)
    const existing = state.instances.findIndex((item) => item.id === instance.id)
    const instances =
      existing === -1
        ? [...state.instances, instance]
        : state.instances.map((item, index) => (index === existing ? instance : item))
    await write(file, {
      instances,
      lastInstanceID: instance.id,
    })
    return instances
  }

  async function remove(id: string) {
    const state = await read(file)
    const instances = state.instances.filter((item) => item.id !== id)
    await write(file, {
      instances,
      lastInstanceID: state.lastInstanceID === id ? instances[0]?.id : state.lastInstanceID,
    })
    return instances
  }

  async function setLast(id: string | undefined) {
    const state = await read(file)
    await write(file, {
      instances: state.instances,
      lastInstanceID: id,
    })
    return id
  }

  return {
    file,
    getLast,
    list,
    remove,
    save,
    setLast,
  }
}
