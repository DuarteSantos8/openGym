# Adds Garmin's Connect IQ Mobile SDK (the Swift package github.com/garmin/connectiq-companion-app-sdk-ios,
# a binary ConnectIQ.xcframework) to the iPhone app, in the style of add-watch-app.rb: the project in
# the repository builds without it, and CI and the App Store archive (ios.yml) run this before the
# build. With the package there, `canImport(ConnectIQ)` is true and GarminLink.swift is the real
# Garmin link; without it, the same file compiles to "no Garmin" (docs/GARMIN.md). Running it twice
# changes nothing. Once the Garmin app ships, run it once and commit the project.
#
#   ruby frontend/ios/ci/add-garmin.rb
#
# The SDK is closed source (Garmin's Connect IQ SDK licence, docs/GARMIN.md "Licence and builds"):
# it is fetched at build time from Garmin's own repository, pinned to one version, never committed.
require 'xcodeproj'

URL = 'https://github.com/garmin/connectiq-companion-app-sdk-ios'
VERSION = '1.8.0'
PRODUCT = 'ConnectIQ'

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
app = proj.targets.find { |t| t.name == 'App' }
abort 'no App target' unless app
if proj.root_object.package_references.any? { |r| r.respond_to?(:repositoryURL) && r.repositoryURL == URL }
  puts 'the Connect IQ SDK is already in the project'
  exit 0
end

# Swift packages need project format 52 or later (Xcode 11); the Capacitor template is older.
proj.instance_variable_set(:@object_version, '55') if proj.object_version.to_i < 52

ref = proj.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
ref.repositoryURL = URL
ref.requirement = { 'kind' => 'exactVersion', 'version' => VERSION }
proj.root_object.package_references << ref

dep = proj.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
dep.package = ref
dep.product_name = PRODUCT
app.package_product_dependencies << dep

file = proj.new(Xcodeproj::Project::Object::PBXBuildFile)
file.product_ref = dep
app.frameworks_build_phase.files << file

# The SDK uses Objective-C categories internally: -ObjC, as Garmin's guide asks.
app.build_configurations.each do |c|
  flags = c.build_settings['OTHER_LDFLAGS'] || ['$(inherited)']
  flags = flags.split(' ') if flags.is_a?(String)
  flags << '-ObjC' unless flags.include?('-ObjC')
  c.build_settings['OTHER_LDFLAGS'] = flags
end

proj.save
puts "added #{PRODUCT} #{VERSION} (#{URL}) to the App target"
