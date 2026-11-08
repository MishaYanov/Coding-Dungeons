#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ArtifactSource,
    [Parameter(Mandatory)][string]$BuildDirectory,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$NoticesDirectory
)

$ErrorActionPreference = 'Stop'
$sources = (Resolve-Path -LiteralPath $ArtifactSource).Path
$cmake = (Get-Command cmake.exe -CommandType Application).Source
$archives = @{
    'clang+llvm-23.1.1-x86_64-pc-windows-msvc.tar.zst' = 'C8A12D754B5050C5668B56A5425C806792D46C70F7244B1216046164AA4B6462'
    'zlib-1.3.2.tar.gz' = 'BB329A0A2CD0274D05519D61C667C062E06990D72E125EE2DFA8DE64F0119D16'
    'zstd-1.5.7.tar.gz' = 'EB33E51F49A15E023950CD7825CA74A4A2B43DB8354825AC24FC1B7EE09E6FA3'
    'LLVM-LICENSE.txt' = '8D85C1057D742E597985C7D4E6320B015A9139385CFF4CBAE06FFC0EBE89AFEE'
}
foreach ($name in $archives.Keys) {
    if ((Get-FileHash -LiteralPath (Join-Path $sources $name) -Algorithm SHA256).Hash -ne $archives[$name]) {
        throw "The pinned linker artifact $name has a different SHA-256."
    }
}

if (-not $env:VSINSTALLDIR -or $env:VSCMD_ARG_TGT_ARCH -notin @('x64', 'amd64') -or
        [version]$env:VCToolsVersion -lt [version]'14.44') {
    throw 'Run the linker build from an x64 Visual Studio developer shell with MSVC 14.44 or newer.'
}
$dia = Join-Path $env:VSINSTALLDIR 'DIA SDK'

function Expand-LinkerInput([string]$Name, [string]$Directory) {
    New-Item -ItemType Directory -Path $Directory | Out-Null
    tar.exe -xf (Join-Path $sources $Name) -C $Directory --strip-components 1
    if ($LASTEXITCODE -ne 0) { throw "Cannot extract $Name." }
}

function Invoke-LinkerCMake([string[]]$Arguments) {
    & $cmake @Arguments
    if ($LASTEXITCODE -ne 0) { throw "WebAssembly linker build failed with exit code $LASTEXITCODE." }
}

New-Item -ItemType Directory -Path $BuildDirectory | Out-Null
$sdk = Join-Path $BuildDirectory 'llvm-sdk'
$zlib = Join-Path $BuildDirectory 'zlib'
$zstd = Join-Path $BuildDirectory 'zstd'
$prefix = Join-Path $BuildDirectory 'deps'
Expand-LinkerInput 'clang+llvm-23.1.1-x86_64-pc-windows-msvc.tar.zst' $sdk
Expand-LinkerInput 'zlib-1.3.2.tar.gz' $zlib
Expand-LinkerInput 'zstd-1.5.7.tar.gz' $zstd

$generator = @('-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_TRY_COMPILE_CONFIGURATION=Release')
$staticDeps = @("-DCMAKE_INSTALL_PREFIX=$prefix", '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded')
$zlibBuild = Join-Path $BuildDirectory 'build-zlib'
Invoke-LinkerCMake (@('-S', $zlib, '-B', $zlibBuild) + $generator + $staticDeps +
    @('-DZLIB_BUILD_SHARED=OFF', '-DZLIB_BUILD_TESTING=OFF'))
Invoke-LinkerCMake @('--build', $zlibBuild, '--target', 'install')

$zstdBuild = Join-Path $BuildDirectory 'build-zstd'
Invoke-LinkerCMake (@('-S', (Join-Path $zstd 'build/cmake'), '-B', $zstdBuild) + $generator + $staticDeps +
    @('-DZSTD_BUILD_SHARED=OFF', '-DZSTD_BUILD_TESTS=OFF', '-DZSTD_BUILD_PROGRAMS=OFF', '-DZSTD_USE_STATIC_RUNTIME=ON'))
Invoke-LinkerCMake @('--build', $zstdBuild, '--target', 'install')

$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'native/wasm-linker'
$build = Join-Path $BuildDirectory 'build-linker'
Invoke-LinkerCMake (@('-S', $source, '-B', $build) + $generator +
    @("-DCMAKE_PREFIX_PATH=$sdk;$prefix", "-DMSVC_DIA_SDK_DIR=$dia", '-DZLIB_USE_STATIC_LIBS=ON',
        "-DZLIB_LIBRARY=$prefix/lib/zs.lib", "-DZLIB_INCLUDE_DIR=$prefix/include"))
Invoke-LinkerCMake @('--build', $build)

New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath), $NoticesDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'wasm-linker.exe') -Destination $OutputPath
Copy-Item -LiteralPath (Join-Path $sources 'LLVM-LICENSE.txt') -Destination $NoticesDirectory
Copy-Item -LiteralPath (Join-Path $zlib 'LICENSE') -Destination (Join-Path $NoticesDirectory 'zlib-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $zstd 'LICENSE') -Destination (Join-Path $NoticesDirectory 'zstd-LICENSE.txt')
