type State = {
  readers: number
  writer: boolean
  waitingReaders: (() => void)[]
  waitingWriters: (() => void)[]
}

const locks = new Map<string, State>()

function get(key: string) {
  if (!locks.has(key)) {
    locks.set(key, {
      readers: 0,
      writer: false,
      waitingReaders: [],
      waitingWriters: [],
    })
  }
  return locks.get(key)!
}

function processQueue(key: string) {
  const lock = locks.get(key)
  if (!lock || lock.writer || lock.readers > 0) return

  // Prioritize writers to prevent starvation
  if (lock.waitingWriters.length > 0) {
    const nextWriter = lock.waitingWriters.shift()!
    nextWriter()
    return
  }

  // Wake up all waiting readers
  while (lock.waitingReaders.length > 0) {
    const nextReader = lock.waitingReaders.shift()!
    nextReader()
  }

  // Clean up empty locks
  if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
    locks.delete(key)
  }
}

function reader(key: string, lock: State): Disposable {
  let disposed = false
  return {
    [Symbol.dispose]: () => {
      if (disposed) return
      disposed = true
      lock.readers--
      processQueue(key)
    },
  }
}

function writer(key: string, lock: State): Disposable {
  let disposed = false
  return {
    [Symbol.dispose]: () => {
      if (disposed) return
      disposed = true
      lock.writer = false
      processQueue(key)
    },
  }
}

export async function read(key: string): Promise<Disposable> {
  const lock = get(key)

  return new Promise((resolve) => {
    if (!lock.writer && lock.waitingWriters.length === 0) {
      lock.readers++
      resolve(reader(key, lock))
      return
    }
    lock.waitingReaders.push(() => {
      lock.readers++
      resolve(reader(key, lock))
    })
  })
}

export async function write(key: string): Promise<Disposable> {
  const lock = get(key)

  return new Promise((resolve) => {
    if (!lock.writer && lock.readers === 0) {
      lock.writer = true
      resolve(writer(key, lock))
      return
    }
    lock.waitingWriters.push(() => {
      lock.writer = true
      resolve(writer(key, lock))
    })
  })
}
