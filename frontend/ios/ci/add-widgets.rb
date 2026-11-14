# Adds the widget extension (ios/App/OpenGymWidgets: the Home Screen and Lock Screen widgets and
# the workout's Live Activity) to App.xcodeproj and embeds it in the app (App.app/PlugIns), in the
# style of add-asset-downloader.rb. Two files of the app are compiled into it too: what the Live
# Activity carries and its Done button (App/WorkoutActivity.swift) and the views
# (App/WidgetViews.swift), which the app also draws for CI's pictures (App/WidgetPreview.swift).
# Running it again changes nothing. Until the project with it is committed, CI runs it before
# every build (.github/workflows/ios.yml).
#
#   ruby frontend/ios/ci/add-widgets.rb
#
# App Store Connect needs, before a signed build: the bundle id ch.opengym.app.widgets with the
# App Group group.ch.opengym.app, and an App Store provisioning profile for it, which the release
# script signs the extension with (scripts/ios/finish-ipa.sh, WIDGETS_PROFILE).
require 'xcodeproj'

NAME = 'OpenGymWidgets'
BUNDLE_ID = 'ch.opengym.app.widgets'
SHARED = %w[WorkoutActivity.swift WidgetViews.swift].freeze

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
app = proj.targets.find { |t| t.name == 'App' }
abort 'no App target' unless app
if proj.targets.any? { |t| t.name == NAME }
  puts "#{NAME} is already in the project"
  exit 0
end

# A WidgetKit extension: an ordinary app extension (com.apple.widgetkit-extension in its Info.plist).
ext = proj.new_target(:app_extension, NAME, :ios, '17.0')

group = proj.main_group.new_group(NAME, NAME)
sources = Dir.children(File.join(dir, NAME)).select { |f| f.end_with?('.swift') }.sort
ext.add_file_references(sources.map { |f| group.new_file(f) })
# The shared files, by the references the app's own group already has.
app_group = proj.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' }
abort 'no App group' unless app_group
shared = SHARED.map do |f|
  ref = app_group.files.find { |r| r.path == f }
  abort "App/#{f} is not in the project" unless ref
  ref
end
ext.add_file_references(shared)
group.new_file('Info.plist')
group.new_file("#{NAME}.entitlements")
# The gallery's words in every language the app speaks (ios/ci/widget-strings.mjs).
Dir.children(File.join(dir, NAME)).select { |f| f.end_with?('.lproj') }.sort.each do |lproj|
  ref = group.new_file(lproj)
  ref.last_known_file_type = 'folder'
  ext.add_resources([ref])
end

app_settings = app.build_configurations.first.build_settings
ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['INFOPLIST_FILE'] = "#{NAME}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{NAME}/#{NAME}.entitlements"
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['ENABLE_PREVIEWS'] = 'NO'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# Built before the app, and copied into App.app/PlugIns.
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
file = embed.add_file_reference(ext.product_reference, true)
file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

proj.save
puts "added #{NAME} (#{BUNDLE_ID}), embedded in App"
