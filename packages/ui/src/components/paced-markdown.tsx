import { Show, type JSX } from "solid-js"
import { createComponent } from "solid-js/web"
import { Markdown } from "./markdown"
import { createPacedValue } from "./message-part-pacing"

type NonKeyedShowProps = {
  when: string | false | null | undefined
  children: JSX.Element
}

const NonKeyedShow = Show as (props: NonKeyedShowProps) => JSX.Element

export function PacedMarkdown(props: { text: string; cacheKey: string; streaming: boolean }) {
  const value = createPacedValue(
    () => props.text,
    () => props.streaming,
  )
  const markdown = createComponent(Markdown, {
    get text() {
      return value()
    },
    get cacheKey() {
      return props.cacheKey
    },
    get streaming() {
      return props.streaming
    },
  })

  return createComponent(NonKeyedShow, {
    get when() {
      return value() || false
    },
    get children() {
      return markdown
    },
  })
}
