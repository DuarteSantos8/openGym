# Windows-compatible checks. The complete, unchanged suites run on Ubuntu in ci.yml.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$nodeBin = Join-Path $env:LOCALAPPDATA 'Programs/openGym-Node22/node-v22.23.2-win-x64'
if (Test-Path "$nodeBin/node.exe") { $env:PATH = "$nodeBin;$env:PATH" }
$gitShell = Join-Path $env:ProgramFiles 'Git/usr/bin'
if (Test-Path "$gitShell/sh.exe") { $env:PATH = "$gitShell;$env:PATH" }
if ((& node.exe --version) -notmatch '^v22\.') { throw 'Use Node.js 22.' }
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Check failed (exit $LASTEXITCODE)." } }
Push-Location nutrition
try {
    & dotnet.exe test tests/OpenGym.Nutrition.Tests/OpenGym.Nutrition.Tests.csproj -c Release
    Check-Exit
} finally { Pop-Location }
Push-Location frontend
try {
    # The mobile bundle test assumes POSIX paths; this task develops the web app.
    & npm.cmd test -- --exclude scripts/check-mobile-bundle.test.mjs
    Check-Exit
    & npm.cmd run build
    Check-Exit
    & node.exe scripts/check-locales.mjs
    Check-Exit
    & npm.cmd run test:fatigue-probe
    Check-Exit
} finally { Pop-Location }
Push-Location api
try {
    # These files exercise POSIX chmod or the fixture CLI's POSIX file URL.
    # Keep them unchanged and run them in the full Linux CI suite.
    $linuxOnly = @('coach-limits.test.js','jobs.test.js','routes.test.js',
        'credential.test.js','durable.test.js','server-db-unreadable.test.js',
        'server-media.test.js','server-push-prune-save.test.js')
    $tests = @(Get-ChildItem test -Filter '*.test.js' | Where-Object Name -NotIn $linuxOnly | ForEach-Object { "test/$($_.Name)" })
    Write-Host "API: running $($tests.Count) files; eight Linux-dependent files remain covered by CI."
    & node.exe --test @tests
    Check-Exit
} finally { Pop-Location }
Push-Location mcp
try {
    # state.test.js tests Unix access permissions and filesystem watching semantics.
    & npm.cmd test -- --exclude test/state.test.js
    Check-Exit
    & npm.cmd run check:node-loadable
    Check-Exit
} finally { Pop-Location }
& node.exe api/scripts/check-core-loadable.mjs
Check-Exit
& node.exe scripts/build-coach-assets.mjs --check
Check-Exit
& node.exe scripts/build-api-docs.mjs --check
Check-Exit
Write-Host 'Windows checks passed. Full regression suites run on Linux in GitHub Actions.'
