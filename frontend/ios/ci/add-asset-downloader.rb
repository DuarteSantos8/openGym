# Adds the Background Assets downloader extension (ios/App/AnimationPacksDownloader) to
# App.xcodeproj and embeds it in the app: the system runs it to fetch the Apple-hosted asset
# packs of the exercise animations (App/AnimationPacksPlugin.swift). Unlike the UI tests
# (add-ui-tests.rb) this is a real shipping target: run it once on a machine with the xcodeproj
# gem (it ships with CocoaPods) and commit the project it writes. Running it again changes
# nothing. Until the result is committed, CI runs it before every build (.github/workflows/ios.yml).
#
#   ruby frontend/ios/ci/add-asset-downloader.rb
#
# App Store Connect needs, before a signed build: the App Group group.ch.opengym.app on both
# bundle ids, the extension's bundle id ch.opengym.app.AnimationPacksDownloader, and an App Store
# provisioning profile for each (docs/MOBILE.md, "Animation packs").
require 'xcodeproj'

NAME = 'AnimationPacksDownloader'
BUNDLE_ID = 'ch.opengym.app.AnimationPacksDownloader'

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
app = proj.targets.find { |t| t.name == 'App' }
abort 'no App target' unless app
if proj.targets.any? { |t| t.name == NAME }
  puts "#{NAME} is already in the project"
  exit 0
end

# An ExtensionKit extension (iOS 26): built like an app extension, packaged as one, embedded
# under Extensions/ rather than PlugIns/.
ext = proj.new_target(:app_extension, NAME, :ios, '26.0')
ext.product_type = 'com.apple.product-type.extensionkit-extension'
ext.product_reference.explicit_file_type = 'wrapper.extensionkit-extension'

group = proj.main_group.new_group(NAME, NAME)
ext.add_file_references([group.new_file("#{NAME}.swift")])
group.new_file('Info.plist')
group.new_file("#{NAME}.entitlements")

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
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['MARKETING_VERSION'] = app_settings['MARKETING_VERSION']
  s['CURRENT_PROJECT_VERSION'] = app_settings['CURRENT_PROJECT_VERSION']
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# Built before the app, and copied into App.app/Extensions.
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed ExtensionKit Extensions')
embed.symbol_dst_subfolder_spec = :products_directory
embed.dst_path = '$(EXTENSIONS_FOLDER_PATH)'
file = embed.add_file_reference(ext.product_reference, true)
file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

proj.save
puts "added #{NAME} (#{BUNDLE_ID}), embedded in App"
