import fs from "node:fs/promises"
import path from "node:path"
import type { SavedInstance } from "./instance"

export type State = {
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

const mutationQueues = new Map<string, Promise<unknown>>()

async function queuedRead(file: string) {
  await mutationQueues.get(file)?.catch(() => undefined)
  return read(file)
}

async function mutate<T>(file: string, fn: (state: State) => Promise<{ state: State; value: T }> | { state: State; value: T }) {
  let result: T | undefined
  const prev = mutationQueues.get(file) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const output = await fn(await read(file))
    result = output.value
    await write(file, output.state)
  })
  mutationQueues.set(file, next)
  void next.finally(() => {
    if (mutationQueues.get(file) === next) mutationQueues.delete(file)
  }).catch(() => undefined)
  await next
  return result as T
}

async function write(file: string, value: State) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function createInstanceStore(file: string) {
  const getState = () => queuedRead(file)
  const list = () => queuedRead(file).then((state) => state.instances)
  const getLast = () => queuedRead(file).then((state) => state.lastInstanceID)

  async function replace(value: State) {
    const next = {
      instances: Array.isArray(value.instances) ? value.instances : [],
      lastInstanceID: value.lastInstanceID,
    }
    return mutate(file, () => ({ state: next, value: next }))
  }

  async function save(instance: SavedInstance) {
    return mutate(file, (state) => {
      const existing = state.instances.findIndex((item) => item.id === instance.id)
      const instances =
        existing === -1
          ? [...state.instances, instance]
          : state.instances.map((item, index) => (index === existing ? instance : item))
      return {
        state: {
          instances,
          lastInstanceID: state.lastInstanceID,
        },
        value: instances,
      }
    })
  }

  async function remove(id: string) {
    return mutate(file, (state) => {
      const instances = state.instances.filter((item) => item.id !== id)
      return {
        state: {
          instances,
          lastInstanceID: state.lastInstanceID === id ? undefined : state.lastInstanceID,
        },
        value: instances,
      }
    })
  }

  async function setLast(id: string | undefined) {
    return mutate(file, (state) => {
      return {
        state: {
          instances: state.instances,
          lastInstanceID: id,
        },
        value: id,
      }
    })
  }

  async function migrate(legacyFile: string) {
    return mutate(file, async (current) => {
      if (current.instances.length > 0 || current.lastInstanceID) return { state: current, value: current }
      if (legacyFile === file) return { state: current, value: current }
      const legacy = await read(legacyFile)
      if (legacy.instances.length === 0 && !legacy.lastInstanceID) return { state: current, value: current }
      return { state: legacy, value: legacy }
    })
  }

  return {
    file,
    getLast,
    getState,
    list,
    migrate,
    remove,
    replace,
    save,
    setLast,
  }
}
