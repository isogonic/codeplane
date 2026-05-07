#!/usr/bin/env ruby
# frozen_string_literal: true
#
# wire-widget-target.rb — programmatically wire the Live Activity widget
# extension into ios/App/App.xcodeproj. Idempotent: safe to re-run.
#
# Run via build/ios-live-activity/wire-widget-target.sh, which sets up
# the load paths for the system Ruby (the xcodeproj gem ships inside
# the Homebrew cocoapods install, not in system rubygems).
#
# What this script does:
#   1.  Adds the App-side plugin sources to the App target.
#   2.  Adds the shared CodeplaneActivityAttributes.swift to the App
#       target's Compile Sources.
#   3.  Creates the CodeplaneLiveActivityWidget native target (Widget
#       Extension product type) if it doesn't exist.
#   4.  Adds the widget Swift sources + Info.plist to the new target.
#   5.  Also adds CodeplaneActivityAttributes.swift to the widget
#       target (the IPC contract has to be in both processes).
#   6.  Configures Build Settings for the widget target (iOS 16.1
#       deployment target, bundle ID, Swift version, signing).
#   7.  Wires an Embed Foundation Extensions copy phase + target
#       dependency on the App target so the extension ships with the
#       App.
#
# After running, the user just needs to open the workspace and Build
# & Run on a device or simulator (iOS 16.1+). No Xcode UI work needed.

require "xcodeproj"
require "pathname"

PROJECT_PATH         = "ios/App/App.xcodeproj"
APP_TARGET_NAME      = "App"
WIDGET_TARGET_NAME   = "CodeplaneLiveActivityWidget"
WIDGET_BUNDLE_ID     = "ai.codeplane.mobile.LiveActivityWidget"
WIDGET_DEPLOYMENT    = "16.2"  # 16.1 lacks `context.isStale`
SWIFT_VERSION        = "5.0"

abort "ERROR: project not found at #{PROJECT_PATH} — run from packages/mobile" unless File.exist?(PROJECT_PATH)

proj = Xcodeproj::Project.open(PROJECT_PATH)

app_target = proj.targets.find { |t| t.name == APP_TARGET_NAME } or
  abort "ERROR: App target not found"

# ─── helpers ────────────────────────────────────────────────────────────

# Find or create a PBXGroup at a given relative path under main_group.
def ensure_group(parent, segments)
  segments.reduce(parent) do |grp, name|
    grp.children.find { |c| c.is_a?(Xcodeproj::Project::Object::PBXGroup) && c.display_name == name } \
      || grp.new_group(name, name)
  end
end

# Find or create a file reference at the given absolute path inside the
# given group. Re-uses an existing reference if one points at the same
# real path; doesn't make duplicates.
def ensure_file_ref(group, abs_path)
  rel = Pathname.new(abs_path).relative_path_from(Pathname.new(File.expand_path("ios/App"))).to_s
  existing = group.files.find { |f| f.real_path.to_s == abs_path }
  return existing if existing
  group.new_reference(abs_path)
end

# Add a source file to a target's Compile Sources phase if not already.
def ensure_source_in_target(target, file_ref)
  phase = target.source_build_phase
  return if phase.files_references.include?(file_ref)
  phase.add_file_reference(file_ref)
end

# Add a resource (Info.plist is NOT a resource — but Assets.xcassets
# would be, so this helper is here for symmetry).
def ensure_resource_in_target(target, file_ref)
  phase = target.resources_build_phase
  return if phase.files_references.include?(file_ref)
  phase.add_file_reference(file_ref)
end

abs = ->(rel) { File.expand_path(rel) }

# ─── (1) + (2) App target sources ───────────────────────────────────────
# The App target builds an executable so we add the plugin and shared
# attributes to its Compile Sources.

app_group = proj.main_group.children.find { |g| g.is_a?(Xcodeproj::Project::Object::PBXGroup) && g.display_name == "App" } \
  or abort "ERROR: 'App' group not found in project"

plugins_group = ensure_group(app_group, ["plugins", "LiveActivitiesPlugin"])
shared_group  = ensure_group(proj.main_group, ["Shared"])

plugin_swift_ref = ensure_file_ref(plugins_group, abs.call("ios/App/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.swift"))
plugin_objc_ref  = ensure_file_ref(plugins_group, abs.call("ios/App/App/plugins/LiveActivitiesPlugin/LiveActivitiesPlugin.m"))
shared_attrs_ref = ensure_file_ref(shared_group,  abs.call("ios/App/Shared/CodeplaneActivityAttributes.swift"))

ensure_source_in_target(app_target, plugin_swift_ref)
ensure_source_in_target(app_target, plugin_objc_ref)
ensure_source_in_target(app_target, shared_attrs_ref)

puts "✓ App target sources: plugin (.swift+.m) + shared attributes wired"

# ─── (3) Create widget target if missing ────────────────────────────────

widget_target = proj.targets.find { |t| t.name == WIDGET_TARGET_NAME }
if widget_target.nil?
  widget_target = proj.new_target(
    :app_extension,
    WIDGET_TARGET_NAME,
    :ios,
    WIDGET_DEPLOYMENT,
    proj.products_group,
    :swift
  )
  puts "✓ Created widget target #{WIDGET_TARGET_NAME}"
else
  puts "= Widget target #{WIDGET_TARGET_NAME} already exists"
end

# Pull App's signing settings so the widget signs with the same team
# and style — otherwise a default of CODE_SIGN_STYLE=Automatic with no
# team can fail to embed in archives.
app_debug_cfg = app_target.build_configurations.find { |c| c.name == "Debug" }
app_release_cfg = app_target.build_configurations.find { |c| c.name == "Release" }

inherited_signing = {
  "DEVELOPMENT_TEAM"  => app_debug_cfg.build_settings["DEVELOPMENT_TEAM"],
  "CODE_SIGN_STYLE"   => app_debug_cfg.build_settings["CODE_SIGN_STYLE"] || "Automatic",
}

widget_target.build_configurations.each do |cfg|
  s = cfg.build_settings
  s["PRODUCT_NAME"]                          = "$(TARGET_NAME)"  # without this the linker output is just ".appex"
  s["IPHONEOS_DEPLOYMENT_TARGET"]            = WIDGET_DEPLOYMENT
  s["PRODUCT_BUNDLE_IDENTIFIER"]             = WIDGET_BUNDLE_ID
  s["INFOPLIST_FILE"]                        = "CodeplaneLiveActivityWidget/Info.plist"
  s["SWIFT_VERSION"]                         = SWIFT_VERSION
  s["SWIFT_EMIT_LOC_STRINGS"]                = "YES"
  s["GENERATE_INFOPLIST_FILE"]               = "NO"   # we ship our own
  s["TARGETED_DEVICE_FAMILY"]                = "1,2"
  s["SKIP_INSTALL"]                          = "YES"  # extensions never install standalone
  s["CODE_SIGN_STYLE"]                       = inherited_signing["CODE_SIGN_STYLE"]
  s["DEVELOPMENT_TEAM"]                      = inherited_signing["DEVELOPMENT_TEAM"] if inherited_signing["DEVELOPMENT_TEAM"]
  s["MARKETING_VERSION"]                     = app_debug_cfg.build_settings["MARKETING_VERSION"] || "1.0"
  s["CURRENT_PROJECT_VERSION"]               = app_debug_cfg.build_settings["CURRENT_PROJECT_VERSION"] || "1"
  s["INFOPLIST_KEY_CFBundleDisplayName"]     = "Codeplane"
  s["INFOPLIST_KEY_NSHumanReadableCopyright"] = "Copyright © #{Time.now.year} Codeplane. All rights reserved."
  s["LD_RUNPATH_SEARCH_PATHS"]               = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"
  s["MTL_FAST_MATH"]                         = "YES"
  s["ENABLE_PREVIEWS"]                       = "YES"  # SwiftUI #Preview works in Xcode canvas
  s["DEBUG_INFORMATION_FORMAT"]              = (cfg.name == "Debug" ? "dwarf" : "dwarf-with-dsym")
  s["SWIFT_OPTIMIZATION_LEVEL"]              = (cfg.name == "Debug" ? "-Onone" : "-O")
  if cfg.name == "Debug"
    s["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = "DEBUG"
    s["GCC_PREPROCESSOR_DEFINITIONS"]        = ["DEBUG=1", "$(inherited)"]
  end
  # The widget product is bundle-shaped, not an app — the .appex
  # extension is auto-derived from product_type.
  s["WRAPPER_EXTENSION"]                     = "appex"
end

# ─── (4) + (5) Widget sources ───────────────────────────────────────────

widget_group = proj.main_group.children.find { |g| g.is_a?(Xcodeproj::Project::Object::PBXGroup) && g.display_name == WIDGET_TARGET_NAME } \
  || proj.main_group.new_group(WIDGET_TARGET_NAME, WIDGET_TARGET_NAME)

widget_swift_files = %w[
  CodeplaneLiveActivityWidget.swift
  LockScreenView.swift
  DynamicIslandViews.swift
]

widget_swift_files.each do |fname|
  ref = ensure_file_ref(widget_group, abs.call("ios/App/CodeplaneLiveActivityWidget/#{fname}"))
  ensure_source_in_target(widget_target, ref)
end

# Widget needs the shared attributes too — same reference, both targets.
ensure_source_in_target(widget_target, shared_attrs_ref)

# Info.plist — declared via INFOPLIST_FILE build setting above; don't
# add it to a build phase, just create a file reference for navigation.
ensure_file_ref(widget_group, abs.call("ios/App/CodeplaneLiveActivityWidget/Info.plist"))

puts "✓ Widget target sources: 3 widget swifts + shared attributes wired"

# ─── (6) Embed extension into App target ────────────────────────────────

# Create an "Embed App Extensions" copy-files phase on the App target
# (dst subfolder = PluginsAndExtensions = 13). Idempotent.
embed_phase = app_target.copy_files_build_phases.find do |p|
  p.dst_subfolder_spec == "13" || p.name == "Embed App Extensions" || p.name == "Embed Foundation Extensions"
end
if embed_phase.nil?
  embed_phase = app_target.new_copy_files_build_phase("Embed App Extensions")
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
  app_target.build_phases.move(embed_phase, app_target.build_phases.count - 1)
  puts "✓ Added Embed App Extensions phase to App target"
end

product_ref = widget_target.product_reference
already_embedded = embed_phase.files_references.include?(product_ref)
unless already_embedded
  build_file = embed_phase.add_file_reference(product_ref)
  build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
  puts "✓ Widget extension embedded into App's Plugins folder"
end

# Target dependency: App needs widget built first.
unless app_target.dependencies.any? { |d| d.target == widget_target }
  app_target.add_dependency(widget_target)
  puts "✓ App now depends on widget target"
end

# ─── save ───────────────────────────────────────────────────────────────

proj.save
puts
puts "Saved #{PROJECT_PATH}."
puts "Open ios/App/App.xcworkspace and Build & Run on iOS 16.1+."
