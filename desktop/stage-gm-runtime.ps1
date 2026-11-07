[CmdletBinding()]
param([string] $CacheDirectory = (Join-Path $PSScriptRoot '../out/gm-cache'))

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Force -Path $CacheDirectory, $runtime | Out-Null
$cache = (Resolve-Path -LiteralPath $CacheDirectory).Path

function Get-VerifiedAsset([string] $Name, [string] $Url, [string] $Sha256) {
    $file = Join-Path $cache $Name
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
        $partial = "$file.part"
        curl.exe --fail --location --silent --show-error --retry 2 --max-time 600 --output $partial $Url
        if ($LASTEXITCODE -ne 0) { throw "Unable to download $Name." }
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $partial).Hash -ne $Sha256) {
            throw "Checksum mismatch for $Name."
        }
        Move-Item -LiteralPath $partial -Destination $file
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash -ne $Sha256) {
        throw "Checksum mismatch for cached $Name."
    }
    return $file
}

$llamaVersion = 'b12189'
$llamaFile = "llama-$llamaVersion-bin-win-cpu-x64.zip"
$llama = Get-VerifiedAsset $llamaFile `
    "https://github.com/ggml-org/llama.cpp/releases/download/$llamaVersion/$llamaFile" `
    'f912ea5e3e397c63405c81e732131ab0fa6e72411c80546bb5ad643f7dd82aac'
$llamaLicense = Get-VerifiedAsset 'llama-LICENSE' `
    "https://raw.githubusercontent.com/ggml-org/llama.cpp/$llamaVersion/LICENSE" `
    '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d'
$modelRevision = '23749fefcc72300e3a2ad315e1317431b06b590a'
$modelOrigin = "https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/$modelRevision"
$model = Get-VerifiedAsset 'Qwen3-0.6B-Q8_0.gguf' "$modelOrigin/Qwen3-0.6B-Q8_0.gguf" `
    '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031'
$modelLicense = Get-VerifiedAsset 'qwen-LICENSE' "$modelOrigin/LICENSE" `
    '5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd'

$extracted = Join-Path $cache "llama-$llamaVersion"
Expand-Archive -LiteralPath $llama -DestinationPath $extracted -Force
$completion = Get-ChildItem -LiteralPath $extracted -Filter 'llama-completion.exe' -Recurse -File | Select-Object -First 1
if (!$completion) { throw 'The verified release is missing llama-completion.exe.' }
$required = @('llama-completion.exe', 'llama-completion-impl.dll', 'llama-common.dll', 'llama.dll',
    'ggml.dll', 'ggml-base.dll', 'libomp.dll', 'mtmd.dll', 'LICENSE-LLVM-OpenMP')
foreach ($name in $required) {
    Copy-Item -LiteralPath (Join-Path $completion.DirectoryName $name) -Destination $runtime
}
Get-ChildItem -LiteralPath $completion.DirectoryName -Filter 'ggml-cpu-*.dll' -File | Copy-Item -Destination $runtime
Copy-Item -LiteralPath $model -Destination (Join-Path $runtime 'gm-model.gguf')
Copy-Item -LiteralPath $llamaLicense -Destination (Join-Path $runtime 'LICENSE-llama.cpp.txt')
Copy-Item -LiteralPath $modelLicense -Destination (Join-Path $runtime 'LICENSE-Qwen3.txt')
Write-Output "Staged llama.cpp $llamaVersion and Qwen3-0.6B at $runtime"
