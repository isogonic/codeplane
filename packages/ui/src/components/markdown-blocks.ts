// Rich markdown blocks were removed. Keep this thin compatibility seam so the
// main markdown renderer can ask whether a fenced block has a native renderer
// without knowing the feature no longer exists.

export function isMarkdownBlockLang(_lang?: string | null): boolean {
  return false
}

export function renderMarkdownBlock(_code: string, _lang: string): string | null {
  return null
}
