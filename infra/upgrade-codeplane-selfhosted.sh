#!/usr/bin/env bash
# Codeplane self-hosted upgrade hook.
#
# Invoked by Installation.upgrade(method="selfhosted") with:
#   VERSION              - target semver, e.g. 26.5.3
#   CODEPLANE_PARENT_PID - pid of the running codeplane process to kill after
#                          binary swap, so the container restarts on it.
#
# Configurable env (all optional):
#   CODEPLANE_REPO_ROOT       - path to bind-mounted source (default: /workspace/codeplane)
#   CODEPLANE_UPGRADE_WORKDIR - scratch dir for tarballs/builds (default: /workspace/.codeplane-upgrade)
#   CODEPLANE_TARBALL_URL     - override tarball template; %s is replaced by VERSION

set -euo pipefail

: "${VERSION:?VERSION env var required}"
PARENT_PID="${CODEPLANE_PARENT_PID:-}"
REPO_ROOT="${CODEPLANE_REPO_ROOT:-/workspace/codeplane}"
WORK_DIR="${CODEPLANE_UPGRADE_WORKDIR:-/workspace/.codeplane-upgrade}"
TARBALL_URL_TEMPLATE="${CODEPLANE_TARBALL_URL:-https://api.github.com/repos/isogonic/codeplane/tarball/v%s}"

DEST_BIN="${REPO_ROOT}/packages/codeplane/dist/codeplane-linux-x64/bin/codeplane"

log() { printf '[codeplane-upgrade] %s\n' "$*"; }

if [[ ! -x "$DEST_BIN" ]]; then
  log "expected current binary at $DEST_BIN — refusing to upgrade"
  exit 1
fi

mkdir -p "$WORK_DIR"

# Use a fresh per-run staging dir so we never pick up a stale extraction from
# an earlier run (e.g. codeplane-26.5.4 left over alphabetically would get
# mistakenly renamed to the new version's dir by a generic find).
STAGE_DIR=$(mktemp -d "$WORK_DIR/stage-${VERSION}.XXXXXX")
cleanup() { rm -rf "$STAGE_DIR"; }
trap cleanup EXIT

cd "$STAGE_DIR"

# Private repos require auth. Prefer GITHUB_TOKEN env, fall back to gh CLI.
GH_AUTH_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [[ -z "$GH_AUTH_TOKEN" ]] && command -v gh >/dev/null 2>&1; then
  GH_AUTH_TOKEN=$(gh auth token 2>/dev/null || true)
fi

# shellcheck disable=SC2059
TARBALL_URL=$(printf "$TARBALL_URL_TEMPLATE" "$VERSION")
log "downloading $TARBALL_URL into $STAGE_DIR"
CURL_AUTH=()
if [[ -n "$GH_AUTH_TOKEN" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer $GH_AUTH_TOKEN" -H "Accept: application/vnd.github+json")
fi
curl -fsSL "${CURL_AUTH[@]}" "$TARBALL_URL" | tar -xz

# The tarball extracts to a single top-level directory (codeplane-<sha> or
# isogonic-codeplane-<sha>). Pick whichever dir tar produced.
SRC_DIR=$(find . -maxdepth 1 -mindepth 1 -type d | head -n 1)
if [[ -z "$SRC_DIR" || ! -d "$SRC_DIR" ]]; then
  log "tarball did not produce an extracted directory - aborting"
  exit 1
fi

cd "$SRC_DIR"

# Sanity-check: the extracted source must actually contain the workspace.
if [[ ! -f packages/codeplane/package.json ]]; then
  log "extracted source missing packages/codeplane/package.json - aborting"
  exit 1
fi

export CODEPLANE_VERSION="$VERSION"
export CODEPLANE_CHANNEL=latest

log "running bun install"
bun install --frozen-lockfile

log "building linux-x64 binary"
bun run --cwd packages/codeplane build --single

NEW_BIN="$PWD/packages/codeplane/dist/codeplane-linux-x64/bin/codeplane"
if [[ ! -x "$NEW_BIN" ]]; then
  log "build did not produce $NEW_BIN — aborting"
  exit 1
fi

# verify before swap
NEW_VER=$("$NEW_BIN" --version 2>/dev/null || true)
if [[ "$NEW_VER" != "$VERSION" ]]; then
  log "built binary reports '$NEW_VER', expected '$VERSION' — aborting"
  exit 1
fi

log "swapping binary at $DEST_BIN"
cp "$NEW_BIN" "$DEST_BIN.new"
chmod +x "$DEST_BIN.new"
mv -f "$DEST_BIN.new" "$DEST_BIN"

log "binary swapped to v${VERSION}"
log "upgrade to v${VERSION} complete — codeplane will self-exit so the container restarts"
