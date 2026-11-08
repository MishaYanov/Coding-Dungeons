[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) { throw 'Install Visual Studio C++ Build Tools to build the Windows isolation probe.' }
$vc = Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$sdk = Get-ChildItem -LiteralPath (Join-Path $kits 'Include') -Directory |
    Where-Object { (Test-Path (Join-Path $_.FullName 'um/Windows.h')) -and
        (Test-Path (Join-Path $kits "Lib/$($_.Name)/um/x64/Ws2_32.Lib")) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty Name
if (-not $vc -or -not $sdk) { throw 'Install the x64 Windows SDK and MSVC toolset to build the isolation probe.' }

$output = [IO.Path]::GetFullPath($OutputPath)
$object = [IO.Path]::ChangeExtension($output, '.obj')
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'native/sandbox-probe-guest.c'
$compiler = Join-Path $vc 'bin/Hostx64/x64/cl.exe'
$buildArgs = @('/nologo', '/TC', '/MT', '/W4', '/WX', '/O1', '/utf-8', "/Fo$object", "/Fe$output")
foreach ($dir in @((Join-Path $vc 'include')) + @('ucrt','shared','um' | ForEach-Object { Join-Path $kits "Include/$sdk/$_" })) {
    $buildArgs += "/I$dir"
}
$buildArgs += @($source, '/link', '/Brepro', '/MANIFEST:EMBED', '/SUBSYSTEM:CONSOLE', 'Ws2_32.lib')
foreach ($dir in @((Join-Path $vc 'lib/x64')) + @('ucrt','um' | ForEach-Object { Join-Path $kits "Lib/$sdk/$_/x64" })) {
    $buildArgs += "/LIBPATH:$dir"
}
$originalPath = $env:PATH
try {
    $env:PATH = (Join-Path $kits "bin/$sdk/x64") + ';' + $originalPath
    & $compiler @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "Windows isolation probe build failed with exit code $LASTEXITCODE." }
} finally {
    $env:PATH = $originalPath
    if (Test-Path -LiteralPath $object) { Remove-Item -LiteralPath $object }
}
