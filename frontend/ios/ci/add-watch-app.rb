# Adds the Apple Watch app (ios/App/Watch) to App.xcodeproj as its own target and embeds it in the
# iPhone app (App.app/Watch), in the style of add-ui-tests.rb: the project Capacitor generated stays
# as it is in the repository, and CI runs this before every iOS build while the watch app is being
# built up. Running it twice changes nothing. Once it ships, run it once and commit the project.
#
#   ruby frontend/ios/ci/add-watch-app.rb
#
# App Store Connect needs, before a signed build: the bundle ids ch.opengym.app.watchkitapp
# (HealthKit, App Group group.ch.opengym.app) and ch.opengym.app.watchkitapp.widgets (App Group
# group.ch.opengym.app), an App Store provisioning profile for each; the release script
# (scripts/ios/finish-ipa.sh) signs the watch app with WATCH_PROFILE and its widget extension with
# WATCH_WIDGET_PROFILE.
require 'xcodeproj'

NAME = 'OpenGymWatch'
BUNDLE_ID = 'ch.opengym.app.watchkitapp'
DIR = 'Watch'

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
app = proj.targets.find { |t| t.name == 'App' }
abort 'no App target' unless app
if proj.targets.any? { |t| t.name == NAME }
  puts "#{NAME} is already in the project"
  exit 0
end

# A single-target watchOS app (watchOS 7 and later): a plain application built for watchOS.
watch = proj.new_target(:application, NAME, :watchos, '10.0')
group = proj.main_group.new_group(DIR, DIR)
sources = Dir.children(File.join(dir, DIR)).select { |f| f.end_with?('.swift') }.sort
watch.add_file_references(sources.map { |f| group.new_file(f) })
# WatchCore (the session logic and the animation codec, tested with `swift test`), compiled in.
CORE = 'WatchCore/Sources/WatchCore'
cgroup = proj.main_group.new_group('WatchCore', CORE)
core = Dir.children(File.join(dir, CORE)).select { |f| f.end_with?('.swift') }.sort.map { |f| cgroup.new_file(f) }
watch.add_file_references(core)
group.new_file('Info.plist')
# The icon, from the iPhone app's (Watch/Assets.xcassets/AppIcon), and the strings in every language.
watch.add_resources([group.new_file('Assets.xcassets')])
Dir.children(File.join(dir, DIR)).select { |f| f.end_with?('.lproj') }.sort.each do |lproj|
  ref = group.new_file(lproj)
  ref.last_known_file_type = 'folder'
  watch.add_resources([ref])
end
entitlements = File.join(dir, DIR, "#{NAME}.entitlements")
group.new_file("#{NAME}.entitlements") if File.exist?(entitlements)

app_settings = app.build_configurations.first.build_settings
watch.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['INFOPLIST_FILE'] = "#{DIR}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{DIR}/#{NAME}.entitlements" if File.exist?(entitlements)
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['SDKROOT'] = 'watchos'
  s['WATCHOS_DEPLOYMENT_TARGET'] = '10.0'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['SKIP_INSTALL'] = 'YES'
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks']
  s['ENABLE_PREVIEWS'] = 'NO'
end

# Built before the app, and copied into App.app/Watch, where iOS looks for the companion watch app.
app.add_dependency(watch)
embed = app.new_copy_files_build_phase('Embed Watch Content')
embed.symbol_dst_subfolder_spec = :products_directory
embed.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
file = embed.add_file_reference(watch.product_reference, true)
file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# The complications and the Smart Stack widget (ios/App/WatchWidgets), a WidgetKit extension in the
# watch app (OpenGymWatch.app/PlugIns), reading the state the app writes (Watch/WidgetState.swift,
# compiled into both) through the App Group group.ch.opengym.app.
WIDGET = 'OpenGymWatchWidgets'
WIDGET_DIR = 'WatchWidgets'
widget = proj.new_target(:app_extension, WIDGET, :watchos, '10.0')
wgroup = proj.main_group.new_group(WIDGET_DIR, WIDGET_DIR)
wsources = Dir.children(File.join(dir, WIDGET_DIR)).select { |f| f.end_with?('.swift') }.sort.map { |f| wgroup.new_file(f) }
shared = group.files.find { |f| f.path == 'WidgetState.swift' }
widget.add_file_references(wsources + [shared].compact)
wgroup.new_file('Info.plist')
Dir.children(File.join(dir, WIDGET_DIR)).select { |f| f.end_with?('.lproj') }.sort.each do |lproj|
  ref = wgroup.new_file(lproj)
  ref.last_known_file_type = 'folder'
  widget.add_resources([ref])
end
wgroup.new_file("#{WIDGET}.entitlements")
widget.add_system_framework('WidgetKit')
widget.add_system_framework('SwiftUI')
widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{BUNDLE_ID}.widgets"
  s['INFOPLIST_FILE'] = "#{WIDGET_DIR}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{WIDGET_DIR}/#{WIDGET}.entitlements"
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['SDKROOT'] = 'watchos'
  s['WATCHOS_DEPLOYMENT_TARGET'] = '10.0'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end
watch.add_dependency(widget)
wembed = watch.new_copy_files_build_phase('Embed Foundation Extensions')
wembed.symbol_dst_subfolder_spec = :plug_ins
wfile = wembed.add_file_reference(widget.product_reference, true)
wfile.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# A scheme of its own, so CI can build and run just the watch app in a watch simulator.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(watch)
scheme.set_launch_target(watch)
scheme.save_as(File.join(dir, 'App.xcodeproj'), NAME, true)

proj.save
puts "added #{NAME} (#{BUNDLE_ID}), embedded in App"
