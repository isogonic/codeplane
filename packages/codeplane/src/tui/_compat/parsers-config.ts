// TUI-local stub for parsers-config. Tree-sitter parser metadata used by the
// session route's syntax highlighting. Empty list keeps codepaths happy until
// the user wires real parsers in. Typed against opentui's
// `FiletypeParserOptions` so the call site doesn't need a cast.
import type { FiletypeParserOptions } from "@opentui/core"

const parsersConfig: { parsers: FiletypeParserOptions[] } = {
  parsers: [],
}
export default parsersConfig
