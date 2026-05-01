// The desktop shell ships fully bundled JS, so electron-builder should not
// try to resolve or copy runtime node_modules into the packaged app.
export function beforeBuild() {
  return false
}
