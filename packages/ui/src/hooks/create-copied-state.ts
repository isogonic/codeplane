import { createSignal, onCleanup } from "solid-js"

export function createCopiedState(delayMs = 2000) {
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const flash = () => {
    if (timer) clearTimeout(timer)
    setCopied(true)
    timer = setTimeout(() => {
      timer = undefined
      setCopied(false)
    }, delayMs)
  }

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  return {
    copied,
    flash,
  }
}
