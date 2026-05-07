#!/usr/bin/env bash
#
# wire-widget-target.sh — auto-wire the Live Activity widget extension
# into ios/App/App.xcodeproj using the xcodeproj Ruby gem that ships
# with Homebrew's cocoapods.
#
# This is the alternative to doing the Xcode UI work manually
# (README.md Steps 2–6). Idempotent: safe to re-run after every
# `cap:sync` if you change the source files.
#
# Usage (from anywhere):
#   packages/mobile/build/ios-live-activity/wire-widget-target.sh
#
# After running, run the verifier:
#   packages/mobile/build/ios-live-activity/verify-setup.sh
#
# Then open ios/App/App.xcworkspace and Build & Run.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "$script_dir/../.." && pwd)"

# Locate the xcodeproj gem inside Homebrew's cocoapods install. The
# system Ruby doesn't ship it, but cocoapods bundles it as a vendored
# dep. We just stitch the load path together at the shell level so we
# don't need bundler / `gem install`.
brew_pods_libexec=$(ls -d /opt/homebrew/Cellar/cocoapods/*/libexec 2>/dev/null | tail -1 || true)
if [[ -z "$brew_pods_libexec" ]]; then
  echo "ERROR: cocoapods not installed via Homebrew at /opt/homebrew/Cellar/cocoapods" >&2
  echo "       Install with: brew install cocoapods" >&2
  exit 1
fi

declare -a LOAD_PATHS=()
for gem in xcodeproj nanaimo colored2 claide atomos; do
  path=$(ls -d "$brew_pods_libexec/gems/${gem}-"*/lib 2>/dev/null | tail -1 || true)
  if [[ -z "$path" ]]; then
    echo "ERROR: required gem '$gem' not found under $brew_pods_libexec/gems" >&2
    exit 1
  fi
  LOAD_PATHS+=("-I" "$path")
done

cd "$mobile_dir"
ruby "${LOAD_PATHS[@]}" "$script_dir/wire-widget-target.rb"
