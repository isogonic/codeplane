import type { JSX } from "solid-js"

// Auto-linkify URLs inside the question prompt body. The bash_interactive
// tool embeds OAuth URLs etc. directly in the question, and the user needs
// to be able to click instead of having to copy/paste. Greedy match for
// http(s)://… up to whitespace, with trailing punctuation pulled back so a
// URL ending a sentence ("…visit https://…/auth.") isn't slurped along
// with the closing dot.
const URL_RE = /https?:\/\/[^\s<>"]+/g
const TRAIL = /[.,;:!?)\]}'"]+$/

/** Split `text` into a list of segments. Each segment is either a plain
 *  string or a `{kind: "link", href, text}` descriptor. Used by the
 *  question dock to render `<a>` tags for URLs while leaving the
 *  surrounding prose alone. */
export type QuestionTextSegment = { kind: "text"; value: string } | { kind: "link"; href: string; value: string }

export function splitQuestionText(text: string | undefined): QuestionTextSegment[] {
  if (!text) return []
  const out: QuestionTextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    let raw = match[0]
    let trailing = ""
    const trail = raw.match(TRAIL)
    if (trail) {
      trailing = trail[0]
      raw = raw.slice(0, raw.length - trailing.length)
    }
    if (start > cursor) out.push({ kind: "text", value: text.slice(cursor, start) })
    out.push({ kind: "link", href: raw, value: raw })
    if (trailing) out.push({ kind: "text", value: trailing })
    cursor = start + match[0].length
  }
  if (cursor < text.length) out.push({ kind: "text", value: text.slice(cursor) })
  return out
}

export function renderQuestionText(text: string | undefined): JSX.Element {
  const segments = splitQuestionText(text)
  return (
    <>
      {segments.map((segment) => {
        if (segment.kind === "text") return segment.value
        return (
          <a
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            data-slot="question-link"
            // Stop propagation so clicking the link inside the prompt doesn't
            // trigger the surrounding option-pick / focus shifts.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {segment.value}
          </a>
        )
      })}
    </>
  )
}
