[CmdletBinding()]
param([string]$Executable)

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not $Executable) { $Executable = Join-Path $projectRoot 'dist\C-TextureMaker\C-TextureMaker.exe' }
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'Build the desktop app before running clipboard checks.' }
$source = Join-Path $PSScriptRoot 'clipboard.native.cs'
$output = Join-Path $projectRoot '.tools\clipboard-native-checks.exe'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
& $compiler /nologo /target:exe /platform:x64 /optimize+ /langversion:4 /out:$output /reference:System.dll /reference:System.Drawing.dll $source
if ($LASTEXITCODE -ne 0) { throw 'Clipboard checks failed to compile.' }
& $output $Executable
if ($LASTEXITCODE -ne 0) { throw 'Clipboard decoder checks failed.' }
