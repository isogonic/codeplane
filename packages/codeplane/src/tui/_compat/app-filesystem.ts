// TUI-local AppFileSystem barrel. Aliases the codeplane-shared
// `@codeplane/FileSystem` Effect Service so callers built against
// `@opencode-ai/core/filesystem`'s `AppFileSystem` namespace compile and
// also share the same Service tag at runtime (otherwise the layer doesn't
// satisfy our Npm/etc. modules' deps and you get
// "Service not found: @codeplane/FileSystem").
export { AppFileSystem } from "@codeplane-ai/shared/filesystem"
