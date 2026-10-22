#!/usr/bin/env ruby
# Adds the OpenGymWatch watchOS app target to App.xcodeproj and embeds it in the App target.
# Run once from anywhere: `ruby frontend/ios/App/scripts/add-watch-target.rb`. It refuses to run
# twice. Uses the xcodeproj gem that ships with CocoaPods; the existing objects are left as they
# are, the gem only adds the new ones.
#
# Every bundle id here is spelled from ch.duartesantos.opengym and nothing else: the install
# script rewrites that prefix in the pbxproj to the user's own id, which has to move the watch
# app's id and its companion id together.
require 'xcodeproj'

APP_DIR = File.expand_path('..', __dir__)
PROJECT_PATH = File.join(APP_DIR, 'App.xcodeproj')
WATCH_DIR = 'OpenGymWatch'
TARGET = 'OpenGymWatch'
APP_ID = 'ch.duartesantos.opengym'
WATCH_ID = "#{APP_ID}.watchkitapp"
HEALTH_SHARE = 'openGym reads heart rate recorded during your workouts.'
HEALTH_UPDATE = 'openGym writes your finished workouts and weigh-ins to Health.'

project = Xcodeproj::Project.open(PROJECT_PATH)
abort "#{TARGET} already exists in #{PROJECT_PATH}" if project.targets.any? { |t| t.name == TARGET }
app = project.targets.find { |t| t.name == 'App' } or abort 'No App target'

app_setting = lambda do |key|
  app.build_configurations.map { |c| c.build_settings[key] }.compact.first
end

watch = project.new_target(:application, TARGET, :watchos, '11.0', project.products_group, :swift)
# The gem links Foundation by a path into one SDK version; Swift links it on its own.
watch.frameworks_build_phase.files.to_a.each do |file|
  ref = file.file_ref
  file.remove_from_project
  parent = ref&.parent
  ref&.remove_from_project
  parent.remove_from_project if parent.is_a?(Xcodeproj::Project::Object::PBXGroup) && parent.children.empty? && parent != project.frameworks_group
end
watch.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = WATCH_ID
  s['SDKROOT'] = 'watchos'
  s['WATCHOS_DEPLOYMENT_TARGET'] = '11.0'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['SWIFT_VERSION'] = '5.0'
  s['SWIFT_STRICT_CONCURRENCY'] = 'complete'
  s['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  s['ENABLE_PREVIEWS'] = 'YES'
  s['SKIP_INSTALL'] = 'YES'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{WATCH_DIR}/OpenGymWatch.entitlements"
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = 'AccentColor'
  s['LD_RUNPATH_SEARCH_PATHS'] = '$(inherited) @executable_path/Frameworks'
  s['MARKETING_VERSION'] = app_setting.call('MARKETING_VERSION') || '1.0'
  s['CURRENT_PROJECT_VERSION'] = app_setting.call('CURRENT_PROJECT_VERSION') || '1'
  # Generated, plus a small Info.plist for what has no INFOPLIST_KEY_ setting: the
  # workout-processing background mode an HKWorkoutSession needs.
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['INFOPLIST_FILE'] = "#{WATCH_DIR}/Info.plist"
  s['INFOPLIST_KEY_CFBundleDisplayName'] = 'openGym'
  s['INFOPLIST_KEY_WKCompanionAppBundleIdentifier'] = APP_ID
  s['INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp'] = 'NO'
  s['INFOPLIST_KEY_NSHealthShareUsageDescription'] = HEALTH_SHARE
  s['INFOPLIST_KEY_NSHealthUpdateUsageDescription'] = HEALTH_UPDATE
  s['INFOPLIST_KEY_UISupportedInterfaceOrientations'] = 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown'
  if config.name == 'Debug'
    s['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG'
  else
    s['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = ''
  end
end

# Sources: every Swift file under OpenGymWatch/, in groups that follow the folders.
group = project.main_group.new_group(WATCH_DIR, WATCH_DIR)
group_for = lambda do |dir|
  dir.split('/').reject(&:empty?).inject(group) do |parent, name|
    parent.children.find { |c| c.isa == 'PBXGroup' && c.path == name } || parent.new_group(name, name)
  end
end
watch_root = File.join(APP_DIR, WATCH_DIR)
Dir.glob('**/*.swift', base: watch_root).sort.each do |rel|
  ref = group_for.call(File.dirname(rel) == '.' ? '' : File.dirname(rel)).new_reference(File.basename(rel))
  watch.source_build_phase.add_file_reference(ref, true)
end
assets = group.new_reference('Assets.xcassets')
watch.resources_build_phase.add_file_reference(assets, true)
group.new_reference('Info.plist')
group.new_reference('OpenGymWatch.entitlements')

# The App target builds the watch app first and carries it in Watch/.
app.add_dependency(watch)
embed = app.new_copy_files_build_phase('Embed Watch Content')
embed.dst_subfolder_spec = '16'
embed.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
embed_file = embed.add_file_reference(watch.product_reference, true)
embed_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

attributes = project.root_object.attributes['TargetAttributes'] ||= {}
attributes[watch.uuid] = { 'CreatedOnToolsVersion' => '16.0', 'ProvisioningStyle' => 'Automatic' }

project.save
puts "Added #{TARGET} (#{WATCH_ID}) to #{PROJECT_PATH}"
