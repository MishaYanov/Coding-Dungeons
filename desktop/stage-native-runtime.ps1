<#
.SYNOPSIS
Builds the Windows x64 Rust, Go, and Wasmtime assets for the desktop package.

.PARAMETER RustToolchain
The Rust 1.99.1 MSVC toolchain directory with the wasm32-wasip1 target installed.

.PARAMETER GoToolchain
The Go 1.27.4 Windows amd64 installation directory from the official verified distribution.

.PARAMETER ArtifactSource
A local folder containing wasmtime.50.0.1.nupkg, the Microsoft.NETCore.App.Runtime.win-x64
and Microsoft.NETCore.App.Host.win-x64 packages at 10.0.15, and wasmtime-dotnet-LICENSE
from Wasmtime .NET commit 4aac1a5958f4da2dadca4ae84e16004516372dd6. Also provide
the pinned LLVM, zlib, and zstd archives and LLVM license from build-wasm-linker.ps1.

.NOTES
Use Visual Studio C++ Build Tools, CMake, Ninja, and the .NET 10 SDK. The script verifies the input package
hashes and publishes from the supplied offline source. Stage these assets before packaging.
The installed engine still requires the broker's Windows isolation probe to succeed.
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RustToolchain,
    [string]$GoToolchain = (Join-Path $env:ProgramFiles 'Go'),
    [Parameter(Mandatory)][string]$ArtifactSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'Native runtime staging requires Windows x64.'
}

function Resolve-DirectChild([string]$Parent, [string]$Name) {
    $fullPath = [IO.Path]::GetFullPath((Join-Path $Parent $Name))
    if ([IO.Path]::GetDirectoryName($fullPath) -ne $Parent) {
        throw "Expected a direct child of $Parent."
    }
    if (Test-Path -LiteralPath $fullPath) {
        $entry = Get-Item -LiteralPath $fullPath -Force
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to stage through a reparse point at $fullPath."
        }
    }
    return $fullPath
}

function Copy-IntoFolder([string[]]$Files, [string]$Folder) {
    New-Item -ItemType Directory -Path $Folder -Force | Out-Null
    Copy-Item -LiteralPath $Files -Destination $Folder
}

function Invoke-WithBuildEnvironment([hashtable]$Values, [scriptblock]$Action) {
    $original = @{}
    try {
        foreach ($key in $Values.Keys) {
            $original[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $Values[$key], 'Process')
        }
        & $Action
    } finally {
        foreach ($key in $original.Keys) {
            [Environment]::SetEnvironmentVariable($key, $original[$key], 'Process')
        }
    }
}

$rustRoot = (Resolve-Path -LiteralPath $RustToolchain).Path
$goRoot = (Resolve-Path -LiteralPath $GoToolchain).Path
$artifacts = (Resolve-Path -LiteralPath $ArtifactSource).Path
$desktopRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$projectRoot = [IO.Path]::GetDirectoryName($desktopRoot)
$outRoot = Resolve-DirectChild $projectRoot 'out'
$runtimeRoot = Resolve-DirectChild $desktopRoot 'runtime'

$rustVersion = (& (Join-Path $rustRoot 'bin/rustc.exe') --version) -join ' '
if ($LASTEXITCODE -ne 0 -or $rustVersion -notmatch '^rustc 1\.99\.1(?: |$)') {
    throw 'Supply the pinned Rust 1.99.1 Windows x64 MSVC toolchain.'
}
$goVersion = (& (Join-Path $goRoot 'bin/go.exe') version) -join ' '
if ($LASTEXITCODE -ne 0 -or $goVersion -ne 'go version go1.27.4 windows/amd64') {
    throw 'Supply the pinned Go 1.27.4 Windows amd64 toolchain.'
}
$rustDrivers = @(Get-ChildItem -LiteralPath (Join-Path $rustRoot 'bin') -File -Filter 'rustc_driver-*.dll')
if ($rustDrivers.Count -ne 1) { throw 'Expected one Rust compiler driver DLL.' }

$dotnetRuntimeVersion = '10.0.15'
$runtimePackName = "microsoft.netcore.app.runtime.win-x64.$dotnetRuntimeVersion.nupkg"
$packageHashes = @{
    $runtimePackName = '7423F58917342B9E4BF276FB164D5726D2C90FE2FE989C552B9E39056256A035'
    "microsoft.netcore.app.host.win-x64.$dotnetRuntimeVersion.nupkg" = '41D6989224D9E273880072041C0FA7A2D8C92F1CF11E989E8967D3D589A066AD'
    'wasmtime.50.0.1.nupkg' = '661228005770C4A0E1435E1A606A52557F3FD1FDA3993927559B40A900867208'
    'wasmtime-dotnet-LICENSE' = 'A6C48161A09ACC75A0E25503BAB66A731EB5FBA5392ED4BB4743E4BA5085327A'
}
foreach ($name in $packageHashes.Keys) {
    $inputFile = Resolve-DirectChild $artifacts $name
    if ((Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash -ne $packageHashes[$name]) {
        throw "The pinned artifact $name has a different SHA-256."
    }
}

New-Item -ItemType Directory -Path $outRoot, $runtimeRoot -Force | Out-Null
$scratchName = ".native-stage-$([guid]::NewGuid().ToString('N'))"
$scratch = Resolve-DirectChild $outRoot $scratchName
New-Item -ItemType Directory -Path $scratch | Out-Null
$payload = Resolve-DirectChild $scratch 'standalone-runner'
$destination = Resolve-DirectChild $runtimeRoot 'standalone-runner'
$previous = Resolve-DirectChild $scratch 'previous'
$lockPath = Resolve-DirectChild $outRoot '.native-stage.lock'
$stageLock = $null

try {
    $stageLock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    $nativeSource = Join-Path $projectRoot 'native'
    $workerSource = Join-Path $scratch 'wasm-worker'
    $workerDestination = Join-Path $payload 'wasm-worker'
    Copy-IntoFolder @(
        (Join-Path $nativeSource 'wasm-worker/WasmWorker.csproj')
        (Join-Path $nativeSource 'wasm-worker/Program.cs')
    ) $workerSource
    Invoke-WithBuildEnvironment @{
        DOTNET_CLI_HOME = (Join-Path $scratch 'dotnet-home')
        NUGET_PACKAGES = (Join-Path $scratch 'nuget-cache')
        DOTNET_NOLOGO = '1'
        DOTNET_CLI_TELEMETRY_OPTOUT = '1'
        DOTNET_ADD_GLOBAL_TOOLS_TO_PATH = 'false'
        DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE = 'true'
        NUGET_CERT_REVOCATION_MODE = 'offline'
    } {
        $publishArgs = @(
            'publish', (Join-Path $workerSource 'WasmWorker.csproj'), '-c', 'Release',
            '-r', 'win-x64', '--self-contained', 'true', '--output', $workerDestination,
            '--source', $artifacts, "-p:RuntimeFrameworkVersion=$dotnetRuntimeVersion",
            '-p:DisableTransitiveFrameworkReferenceDownloads=true', '-p:NuGetAudit=false',
            '-p:DebugType=None', '-p:DebugSymbols=false'
        )
        dotnet @publishArgs
        if ($LASTEXITCODE -ne 0) { throw "Wasmtime worker publish failed with exit code $LASTEXITCODE." }
    }
    foreach ($file in @('wasm-worker.exe', 'hostfxr.dll', 'hostpolicy.dll', 'coreclr.dll', 'wasmtime.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $workerDestination $file) -PathType Leaf)) {
            throw "The self-contained worker is missing $file."
        }
    }

    $compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $broker = Join-Path $payload 'broker.exe'
    $brokerArgs = @(
        '/nologo', '/target:exe', '/platform:x64', '/main:NativeBroker', '/optimize+', "/out:$broker",
        (Join-Path $nativeSource 'WindowsSandbox.cs'), (Join-Path $nativeSource 'SandboxProbe.cs'),
        (Join-Path $nativeSource 'NativeBroker.cs')
    )
    & $compiler @brokerArgs
    if ($LASTEXITCODE -ne 0) { throw "Windows broker build failed with exit code $LASTEXITCODE." }
    & (Join-Path $desktopRoot 'build-sandbox-probe.ps1') -OutputPath (Join-Path $payload 'sandbox-probe.exe')

    $rust = Join-Path $payload 'rust'
    Copy-IntoFolder @((Join-Path $rustRoot 'bin/rustc.exe'), $rustDrivers[0].FullName) (Join-Path $rust 'bin')
    & (Join-Path $desktopRoot 'build-wasm-linker.ps1') -ArtifactSource $artifacts -BuildDirectory (Join-Path $scratch 'linker') `
        -OutputPath (Join-Path $rust 'wasm-linker.exe') -NoticesDirectory (Join-Path $payload 'licenses')
    $wasi = 'lib/rustlib/wasm32-wasip1'
    $wasiDestination = Join-Path $rust $wasi
    New-Item -ItemType Directory -Path $wasiDestination -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $rustRoot "$wasi/lib") -Destination $wasiDestination -Recurse

    $go = Join-Path $payload 'go'
    $goTools = 'pkg/tool/windows_amd64'
    $goExecutables = @("$goTools/compile.exe", "$goTools/link.exe")
    Copy-IntoFolder @('go.env', 'VERSION', 'LICENSE', 'PATENTS' | ForEach-Object { Join-Path $goRoot $_ }) $go
    New-Item -ItemType Directory -Path (Join-Path $go $goTools) -Force | Out-Null

    $goCache = Join-Path $scratch 'go-cache'
    $goBuildEnvironment = @{
        GOROOT = $goRoot; CGO_ENABLED = '0'; GOCACHE = $goCache; GOENV = 'off'; GOFLAGS = ''
        GOEXPERIMENT = ''; GOWASM = ''; GO111MODULE = 'off'; GOWORK = 'off'
        GOTOOLCHAIN = 'local'; GOPROXY = 'off'; GOSUMDB = 'off'
    }
    # Keep Winsock errors for sockets while allowing the Windows host tools to
    # initialize ordinary files. Apply the patch only to the build's overlay.
    $pollFile = Join-Path $goRoot 'src/internal/poll/fd_windows.go'
    $poll = [IO.File]::ReadAllText($pollFile)
    $oldCheck = 'if initErr != nil {'
    if (-not $poll.Contains($oldCheck) -or $poll.IndexOf($oldCheck) -ne $poll.LastIndexOf($oldCheck)) {
        throw 'The pinned Go Windows file initialization has changed.'
    }
    $fixedCheck = 'if initErr != nil && net != "file" && net != "console" && net != "pipe" {'
    $patchedPoll = Join-Path $scratch 'fd_windows.go'
    [IO.File]::WriteAllText($patchedPoll, $poll.Replace($oldCheck, $fixedCheck))
    $replace = @{}
    $replace[$pollFile] = $patchedPoll
    $overlay = Join-Path $scratch 'go-windows-overlay.json'
    @{Replace = $replace} | ConvertTo-Json | Set-Content -LiteralPath $overlay -Encoding utf8NoBOM
    Invoke-WithBuildEnvironment ($goBuildEnvironment + @{GOOS = 'windows'; GOARCH = 'amd64'}) {
        foreach ($tool in 'compile', 'link') {
            & (Join-Path $goRoot 'bin/go.exe') build -p=2 -trimpath -overlay $overlay -o (Join-Path $go "$goTools/$tool.exe") "cmd/$tool"
            if ($LASTEXITCODE -ne 0) { throw "Go Windows $tool build failed with exit code $LASTEXITCODE." }
        }
    }

    # Bundle the target standard library so the broker can start both tools
    # directly without a Go driver, build cache, or source tree at runtime.
    $goStdlib = Join-Path $go 'stdlib'
    New-Item -ItemType Directory -Path $goStdlib | Out-Null
    $exports = Invoke-WithBuildEnvironment ($goBuildEnvironment + @{GOOS = 'wasip1'; GOARCH = 'wasm'}) {
        & (Join-Path $goRoot 'bin/go.exe') list -p=2 -deps -export -f '{{if .Export}}{{.ImportPath}}|{{.Export}}{{end}}' std
        if ($LASTEXITCODE -ne 0) { throw "Go standard library build failed with exit code $LASTEXITCODE." }
    }
    $index = 0
    $packages = foreach ($entry in ($exports | Where-Object { $_ } | Sort-Object)) {
        $name, $archive = $entry -split '\|', 2
        if ($name -notmatch '^[a-zA-Z0-9_./-]+$' -or
            -not ([IO.Path]::GetFullPath($archive)).StartsWith($goCache + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Unexpected Go standard library export.'
        }
        $file = '{0:D4}.a' -f (++$index)
        Copy-Item -LiteralPath $archive -Destination (Join-Path $goStdlib $file)
        "$name $file"
    }
    if (-not ($packages -match '^runtime [0-9]{4}\.a$')) { throw 'The Go standard library archive list is incomplete.' }
    Set-Content -LiteralPath (Join-Path $goStdlib 'packages.txt') -Value $packages -Encoding utf8NoBOM

    $notices = Join-Path $payload 'licenses'
    Copy-IntoFolder @(
        (Join-Path $rustRoot 'share/doc/rust/COPYRIGHT.html')
        (Join-Path $rustRoot 'share/doc/rust/COPYRIGHT-library.html')
        (Join-Path $artifacts 'wasmtime-dotnet-LICENSE')
    ) $notices
    $runtimePack = [IO.Compression.ZipFile]::OpenRead((Join-Path $artifacts $runtimePackName))
    try {
        foreach ($entry in @('LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT')) {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($runtimePack.GetEntry($entry), (Join-Path $notices "dotnet-$entry"))
        }
    } finally {
        $runtimePack.Dispose()
    }

    $executables = [ordered]@{}
    $runtimeFiles = @('broker.exe', 'sandbox-probe.exe', 'wasm-worker/wasm-worker.exe', 'rust/bin/rustc.exe',
        'rust/wasm-linker.exe', 'go/stdlib/packages.txt') + ($goExecutables | ForEach-Object { "go/$_" })
    foreach ($name in $runtimeFiles) {
        $executables[$name] = (Get-FileHash -LiteralPath (Join-Path $payload $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [ordered]@{
        version = 1
        languages = @('rust', 'go')
        executables = $executables
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $payload 'native-runner.json') -Encoding utf8NoBOM

    if (Test-Path -LiteralPath $destination) { [IO.Directory]::Move($destination, $previous) }
    try {
        [IO.Directory]::Move((Resolve-DirectChild $scratch 'standalone-runner'), $destination)
    } catch {
        if (Test-Path -LiteralPath $previous) { [IO.Directory]::Move($previous, $destination) }
        throw
    }
    Write-Output "Native runtime staged at $destination"
    Write-Output 'Code Workbench requires the packaged broker to pass its Windows isolation probe before grading.'
} finally {
    if ($stageLock) { $stageLock.Dispose() }
    Remove-Item -LiteralPath (Resolve-DirectChild $outRoot $scratchName) -Recurse -Force
}
