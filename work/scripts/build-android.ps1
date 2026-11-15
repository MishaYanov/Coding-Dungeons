param(
  [ValidateSet('release', 'debug')][string]$Variant = 'release',
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$names = @('JAVA_HOME', 'ANDROID_HOME', 'DUNGEONS_ANDROID_KEYSTORE', 'DUNGEONS_ANDROID_STORE_PASSWORD', 'DUNGEONS_ANDROID_KEY_ALIAS', 'DUNGEONS_ANDROID_KEY_PASSWORD')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location -LiteralPath $project
try {
  if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $env:ProgramFiles 'Android/Android Studio/jbr' }
  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
  if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { throw 'Set JAVA_HOME to a supported JDK or install Android Studio.' }
  if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms/android-37.0/android.jar'))) { throw 'Install Android SDK Platform 37.0 in Android Studio.' }
  foreach ($pack in @('mobile-go-pack', 'mobile-rust-pack')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project ('out/' + $pack + '/manifest.json')))) { throw "Stage $pack before building the complete Android app." }
  }
  if (-not $SkipWebBuild) {
    & npm.cmd run mobile:build
    if ($LASTEXITCODE -ne 0) { throw 'Mobile web build failed.' }
  }
  if ($Variant -eq 'release' -and -not $env:DUNGEONS_ANDROID_KEYSTORE) {
    # Keep the durable update identity outside Git and outside disposable outputs.
    # DPAPI protects the generated password for the current Windows account.
    $signingDirectory = Join-Path $env:LOCALAPPDATA 'CodingDungeonsBuild/android'
    $keyFile = Join-Path $signingDirectory 'local-release.p12'
    $metadataFile = Join-Path $signingDirectory 'local-signing.json'
    New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
    if ((Test-Path -LiteralPath $keyFile) -ne (Test-Path -LiteralPath $metadataFile)) {
      throw 'The local Android signing identity is incomplete. Restore its existing key and metadata; do not replace an update key.'
    }
    if (-not (Test-Path -LiteralPath $keyFile)) {
      $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
      $env:DUNGEONS_ANDROID_STORE_PASSWORD = $password
      $env:DUNGEONS_ANDROID_KEY_PASSWORD = $password
      & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -storetype PKCS12 -keystore $keyFile -storepass:env DUNGEONS_ANDROID_STORE_PASSWORD -keypass:env DUNGEONS_ANDROID_KEY_PASSWORD -alias coding-dungeons-local -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Coding Dungeons Local, OU=Private Build'
      if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Android signing key.' }
      $protected = ConvertFrom-SecureString (ConvertTo-SecureString $password -AsPlainText -Force)
      @{format='windows-dpapi-v1'; alias='coding-dungeons-local'; protectedPassword=$protected} | ConvertTo-Json | Set-Content -LiteralPath $metadataFile -Encoding utf8
      $password = $null
    }
    $metadata = Get-Content -LiteralPath $metadataFile -Raw | ConvertFrom-Json
    if ($metadata.format -ne 'windows-dpapi-v1' -or $metadata.alias -ne 'coding-dungeons-local') { throw 'Unrecognized Android signing metadata.' }
    $secret = ConvertTo-SecureString $metadata.protectedPassword
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $env:DUNGEONS_ANDROID_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $env:DUNGEONS_ANDROID_KEYSTORE = $keyFile
    $env:DUNGEONS_ANDROID_KEY_ALIAS = $metadata.alias
    $env:DUNGEONS_ANDROID_KEY_PASSWORD = $env:DUNGEONS_ANDROID_STORE_PASSWORD
  }
  $buildVariant = if ($Variant -eq 'release') { 'Release' } else { 'Debug' }
  # AGP 9 creates the shared Java policy tests only for the debug variant.
  & (Join-Path $project 'android/gradlew.bat') -p (Join-Path $project 'android') --no-daemon --console plain --max-workers=2 ':app:testDebugUnitTest' (':app:lint' + $buildVariant) (':app:assemble' + $buildVariant)
  if ($LASTEXITCODE -ne 0) { throw 'Android tests, lint or packaging failed.' }
  $apk = Join-Path $project ('android/app/build/outputs/apk/' + $Variant + '/app-' + $Variant + '.apk')
  if (-not (Test-Path -LiteralPath $apk)) { throw 'Android build did not produce its expected APK.' }
  Write-Output "Built $apk"
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
  Pop-Location
}
