export function shouldParseMarkdown(cached: string | undefined, _streaming: boolean) {
  // Always parse via marked when we don't already have a cached HTML result —
  // this is what makes markdown render LIVE during streaming instead of only
  // after the stream completes. The previous `&& !streaming` clause caused the
  // async parser to be skipped entirely while a delta was in flight, so the
  // user saw raw `**bold**` / `# heading` text until the stream finished.
  return cached === undefined
}

export function selectMarkdownContent(input: {
  text: string
  cached?: string
  live?: string
  parsed?: string
  streaming: boolean
}) {
  if (!input.text) return ""
  const parsed = input.parsed || undefined
  // `cached` is the canonical marked.parse result for the CURRENT text —
  // every block hashed and looked up. When it's defined, nothing else can
  // be more correct, so always prefer it.
  if (input.cached) return input.cached
  // While streaming and `cached` misses, the async parse for the latest
  // delta hasn't completed yet. `parsed` therefore holds the result for an
  // EARLIER text — it's stale by 1+ deltas and visibly missing the newest
  // characters (the "deletes things / parts shown removed shown" bug).
  // `live` always reflects the current text: it joins cached parsed blocks
  // for the stable head with `wrapWords` for the still-streaming tail, so
  // the user sees real markdown for everything that's been parsed at least
  // once, with the live tail filling in as it arrives.
  if (input.streaming) return input.live ?? parsed ?? ""
  return parsed ?? input.live ?? ""
}
