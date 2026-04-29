export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  const result = (): T => {
    if (loaded) return value as T
    const next = fn()
    value = next
    loaded = true
    if ((typeof next === "object" || typeof next === "function") && next !== null) {
      const maybe = next as { then?: unknown }
      if (typeof maybe.then === "function") {
        void Promise.resolve(next).catch(() => {
          if (value !== next) return
          loaded = false
          value = undefined
        })
      }
    }
    return value as T
  }

  result.reset = () => {
    loaded = false
    value = undefined
  }

  return result
}
