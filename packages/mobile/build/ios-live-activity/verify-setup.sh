#!/usr/bin/env bash
#
# verify-setup.sh — sanity-check the Live Activity wiring after you've
# done the Xcode UI work in README.md.
#
# Usage (from anywhere):
#   packages/mobile/build/ios-live-activity/verify-setup.sh
#
# Exit code:
#   0  – everything looks OK
#   1  – at least one check failed; the script prints a precise hint
#
# This is a static check — it grep-validates pbxproj membership, file
# placement, and Info.plist keys. It does NOT compile or run the app;
# for that, build the App scheme in Xcode and watch the Codeplane.LA
# log breadcrumbs documented in README.md.

set -u

# Resolve repo paths regardless of where the user invokes the script.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_dir="$(cd "$script_dir/../.." && pwd)"
ios_dir="$mobile_dir/ios/App"
pbx="$ios_dir/App.xcodeproj/project.pbxproj"

red()    { printf '\033[0;31m%s\033[0m' "$1"; }
green()  { printf '\033[0;32m%s\033[0m' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m' "$1"; }

fails=0
note() { echo "  $(yellow "→") $1"; }
ok()   { echo "$(green "✓") $1"; }
bad()  { echo "$(red "✗") $1"; fails=$((fails + 1)); }

echo "Verifying Live Activity setup in $ios_dir"
echo

# 1. Files exist on disk.
require_file() {
  if [[ -f "$1" ]]; then ok "$(basename "$1") on disk"
  else bad "$1 missing — re-run \`bun run cap:sync\` or copy from build/ios-live-activity/"
  fi
}
require_file "$ios_dir/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.swift"
require_file "$ios_dir/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.m"
require_file "$ios_dir/Shared/CodeplaneActivityAttributes.swift"
require_file "$ios_dir/CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidget.swift"
require_file "$ios_dir/CodeplaneLiveActivityWidget/LockScreenView.swift"
require_file "$ios_dir/CodeplaneLiveActivityWidget/DynamicIslandViews.swift"
require_file "$ios_dir/CodeplaneLiveActivityWidget/Info.plist"

# 2. App Info.plist has both Live Activity keys.
app_info="$ios_dir/App/Info.plist"
if /usr/bin/plutil -extract NSSupportsLiveActivities raw -o - "$app_info" 2>/dev/null | grep -q true; then
  ok "App Info.plist: NSSupportsLiveActivities = true"
else
  bad "App Info.plist missing NSSupportsLiveActivities=true"
  note "Add it to $app_info"
fi
if /usr/bin/plutil -extract NSSupportsLiveActivitiesFrequentUpdates raw -o - "$app_info" 2>/dev/null | grep -q true; then
  ok "App Info.plist: NSSupportsLiveActivitiesFrequentUpdates = true"
else
  bad "App Info.plist missing NSSupportsLiveActivitiesFrequentUpdates=true"
  note "Optional but recommended — add it to $app_info"
fi

# 3. Widget Info.plist has correct extension point.
w_info="$ios_dir/CodeplaneLiveActivityWidget/Info.plist"
if /usr/bin/plutil -extract NSExtension.NSExtensionPointIdentifier raw -o - "$w_info" 2>/dev/null \
    | grep -q "com.apple.widgetkit-extension"; then
  ok "Widget Info.plist: NSExtensionPointIdentifier OK"
else
  bad "Widget Info.plist: NSExtension.NSExtensionPointIdentifier wrong (should be com.apple.widgetkit-extension)"
fi

# 4. pbxproj knows about the widget target.
if grep -q "CodeplaneLiveActivityWidget" "$pbx"; then
  ok "Xcode project knows the CodeplaneLiveActivityWidget target"
else
  bad "Xcode project does NOT contain a CodeplaneLiveActivityWidget target"
  note "Open ios/App/App.xcworkspace and follow Step 4 in README.md (File → New → Target → Widget Extension, ✓ Include Live Activity)"
fi

# 5. pbxproj references the plugin sources.
if grep -q "LiveActivitiesPlugin.swift" "$pbx" && grep -q "LiveActivitiesPlugin.m" "$pbx"; then
  ok "Plugin sources are referenced from the Xcode project"
else
  bad "Plugin sources not added to the Xcode project"
  note "Right-click App group → Add Files to \"App\"… → both files in App/plugins/LiveActivitiesPlugin (target: App)"
fi

# 6. pbxproj references the shared attributes.
if grep -q "CodeplaneActivityAttributes.swift" "$pbx"; then
  ok "Shared CodeplaneActivityAttributes.swift is referenced"
else
  bad "CodeplaneActivityAttributes.swift not in the Xcode project"
  note "Add it via File Inspector → tick BOTH App and CodeplaneLiveActivityWidget under Target Membership"
fi

# 7. Plugin name handshake — TS side & .m side must agree.
ts_name=$(grep -oE 'registerPlugin<[^>]+>\("[^"]+"' "$mobile_dir/src/platform/live-activities.ts" \
  | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
m_name=$(grep -oE 'CAP_PLUGIN\([^,]+,[[:space:]]*"[^"]+"' "$ios_dir/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.m" \
  | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [[ -n "$ts_name" && -n "$m_name" && "$ts_name" == "$m_name" ]]; then
  ok "Plugin name in sync: \"$ts_name\""
else
  bad "Plugin name out of sync (TS=\"$ts_name\" vs Obj-C=\"$m_name\")"
  note "Both must read \"CodeplaneLiveActivities\" — check live-activities.ts and the CAP_PLUGIN macro"
fi

# 8. Auto-generated boilerplate left over by the target template.
shopt -s nullglob
boilerplate=("$ios_dir/CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidget"*"Attributes.swift" \
             "$ios_dir/CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidget"*"LiveActivity.swift" \
             "$ios_dir/CodeplaneLiveActivityWidget/CodeplaneLiveActivityWidgetBundle.swift")
for f in "${boilerplate[@]}"; do
  if [[ -f "$f" ]]; then
    bad "Auto-generated boilerplate not deleted: $(basename "$f")"
    note "Delete it (Move to Trash) — our hand-written sources replace it"
  fi
done

echo
if [[ $fails -eq 0 ]]; then
  echo "$(green "All checks passed.") Build the App scheme in Xcode and watch for Codeplane.LA breadcrumbs."
  exit 0
else
  echo "$(red "$fails check(s) failed.") Fix the items above and re-run this script."
  exit 1
fi
