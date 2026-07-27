require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'NearbyNetwork'
  s.version          = package['version']
  s.summary          = package['description']
  s.description      = package['description']
  s.license          = package['license']
  s.author           = 'JE Trivia'
  s.homepage         = 'https://github.com/johankiilavirta/je-trivia'
  s.platforms        = { :ios => '16.4' }
  s.source           = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['AudioToolbox', 'CoreBluetooth', 'CoreHaptics', 'MultipeerConnectivity']
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
