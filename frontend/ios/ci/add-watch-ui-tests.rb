# Adds the watch UI test target (ios/App/OpenGymWatchUITests) and a scheme for it to App.xcodeproj,
# for one CI run (.github/workflows/ios.yml), as add-ui-tests.rb does for the iPhone app. Run it
# after add-watch-app.rb: the tests drive the OpenGymWatch app, launched on its demo session.
require 'xcodeproj'

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
watch = proj.targets.find { |t| t.name == 'OpenGymWatch' }
abort 'no OpenGymWatch target (run add-watch-app.rb first)' unless watch
tests = proj.new_target(:ui_test_bundle, 'OpenGymWatchUITests', :watchos, '10.0')
tests.add_dependency(watch)
group = proj.main_group.new_group('OpenGymWatchUITests', 'OpenGymWatchUITests')
# Every test file in the folder, so each PR adds its own file and this script stays the same.
files = Dir.children(File.join(dir, 'OpenGymWatchUITests')).grep(/\.swift\z/).sort
tests.add_file_references(files.map { |f| group.new_file(f) })
tests.build_configurations.each do |c|
  s = c.build_settings
  s['TEST_TARGET_NAME'] = 'OpenGymWatch'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'ch.opengym.app.watchkitapp.uitests'
  s['SWIFT_VERSION'] = '5.0'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['SDKROOT'] = 'watchos'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['CODE_SIGN_STYLE'] = 'Automatic'
end
proj.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(watch)
scheme.set_launch_target(watch)
scheme.add_test_target(tests)
scheme.save_as(File.join(dir, 'App.xcodeproj'), 'OpenGymWatchUITests', true)
puts 'added OpenGymWatchUITests'
