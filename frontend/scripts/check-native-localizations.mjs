import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..')
const androidRoot = join(frontend, 'android/app/src/main/res')
const iosRoot = join(frontend, 'ios/App/App')
const androidEnglish = {
  rest_countdown_channel_name: 'Rest countdown',
  rest_channel_name: 'Rest timer',
  rest_quiet_channel_name: 'Rest timer, without vibration',
  rest_channel_desc: 'Rest between sets, in the notification shade. The lock screen shows it only when notifications are allowed there.',
}
const androidKeys = Object.keys(androidEnglish)
const usageKeys = ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription']
const errors = []
const fail = message => errors.push(message)

function readAndroidStrings(file, locale) {
  let xml
  try { xml = readFileSync(file, 'utf8') } catch {
    fail(`Missing ${locale} Android resource file: ${file}`)
    return
  }
  const entries = [...xml.matchAll(/<string\s+name="([^"]+)">(.*?)<\/string>/gs)]
  const names = entries.map(([, name]) => name)
  for (const key of androidKeys) {
    if (names.filter(name => name === key).length !== 1) fail(`${locale}: expected one Android ${key}`)
  }
  if (locale === 'Italian' && names.some(name => !androidKeys.includes(name))) fail(`${locale}: unexpected Android string key`)
  if (entries.some(([, , value]) => !value.trim())) fail(`${locale}: empty Android string value`)
  return new Map(entries.map(([, key, value]) => [key, value]))
}

function readIosStrings(locale) {
  const path = join(iosRoot, `${locale}.lproj/InfoPlist.strings`)
  let source
  try { source = readFileSync(path, 'utf8') } catch {
    fail(`Missing iOS ${locale} resource file: ${path}`)
    return new Map()
  }
  const entries = new Map()
  for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")\s*=\s*("(?:\\.|[^"\\])*");\s*$/)
    if (!match) {
      fail(`${locale}: invalid InfoPlist.strings syntax on line ${lineNumber + 1}`)
      continue
    }
    try {
      const key = JSON.parse(match[1])
      const value = JSON.parse(match[2])
      if (entries.has(key)) fail(`${locale}: duplicate iOS key ${key}`)
      entries.set(key, value)
    } catch {
      fail(`${locale}: invalid quoted string on line ${lineNumber + 1}`)
    }
  }
  for (const key of usageKeys) {
    if (!entries.get(key)?.trim()) fail(`${locale}: missing or empty iOS ${key}`)
  }
  if ([...entries.keys()].some(key => !usageKeys.includes(key))) fail(`${locale}: unexpected iOS usage description key`)
  return entries
}

// Android's default values are the English fallback; only Italian has an override.
const englishAndroid = readAndroidStrings(join(androidRoot, 'values/strings.xml'), 'English fallback')
const italianAndroid = readAndroidStrings(join(androidRoot, 'values-it/strings.xml'), 'Italian')
for (const [key, value] of Object.entries(androidEnglish)) {
  if (englishAndroid?.get(key) !== value) fail(`${key}: English fallback changed`)
  if (italianAndroid?.get(key) === value) fail(`${key}: Italian must have localized copy`)
}
const englishIos = readIosStrings('en')
const italianIos = readIosStrings('it')
for (const key of usageKeys) {
  if (englishIos.get(key) === italianIos.get(key)) fail(`${key}: Italian must have localized copy`)
}

const project = readFileSync(join(frontend, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
for (const locale of ['en', 'it']) {
  if (!project.includes(`${locale}.lproj/InfoPlist.strings`)) fail(`Xcode project does not include ${locale}.lproj/InfoPlist.strings`)
}
if (/\w+(?:-\w+)?\.lproj\/InfoPlist\.strings/.test(project.replace(/(?:en|it)\.lproj\/InfoPlist\.strings/g, ''))) {
  fail('Xcode project includes an unexpected localized InfoPlist.strings resource')
}

if (errors.length) {
  console.error(errors.map(error => `✗ ${error}`).join('\n'))
  process.exitCode = 1
} else {
  console.log('Native localization resources cover English fallback and Italian.')
}
