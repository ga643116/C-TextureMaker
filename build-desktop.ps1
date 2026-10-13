[CmdletBinding()]
param(
    [switch]$StagingBuild
)

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Join-Path $projectRoot "desktop"
$cacheDir = Join-Path $desktopDir "vendor-cache"
$packageName = "microsoft.web.webview2.1.0.4258.31.nupkg"
$packagePath = Join-Path $cacheDir $packageName
$packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/$packageName"
$stagingDir = Join-Path $cacheDir "extract-1.0.4258.31"
$outputDir = if ($StagingBuild) { Join-Path $desktopDir "build-staging" } else { Join-Path $projectRoot "dist\C-TextureMaker" }
$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$frameworkDir = Split-Path -Parent $compiler
$manifestFile = Join-Path $desktopDir "C-TextureMaker.manifest"
$iconFile = Join-Path $desktopDir "C-TextureMaker.ico"

if (-not (Test-Path -LiteralPath $desktopDir -PathType Container)) {
    throw "Desktop source directory is missing: $desktopDir"
}
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw ".NET Framework C# compiler was not found: $compiler"
}
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    Write-Host "Downloading Microsoft.Web.WebView2 1.0.4258.31 from official NuGet..."
    $downloadScriptPath = Join-Path $cacheDir "download-webview2.cjs"
    $downloadScript = @'
const fs = require("fs");
const url = process.argv[2];
const destination = process.argv[3];
(async function () {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NuGet returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const temporary = destination + ".download";
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, destination);
  console.log(`Downloaded ${bytes.length} bytes.`);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
'@

    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        try {
            Set-Content -LiteralPath $downloadScriptPath -Value $downloadScript -Encoding UTF8
            & $node.Source $downloadScriptPath $packageUrl $packagePath
            if ($LASTEXITCODE -ne 0) {
                throw "Node.js failed to download the WebView2 package."
            }
        }
        finally {
            if (Test-Path -LiteralPath $downloadScriptPath -PathType Leaf) {
                Remove-Item -LiteralPath $downloadScriptPath -Force
            }
        }
    }
    else {
        Invoke-WebRequest -Uri $packageUrl -OutFile $packagePath -UseBasicParsing
    }
}

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "WebView2 NuGet package is unavailable: $packagePath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $stagingDir) {
    $resolvedCache = [IO.Path]::GetFullPath($cacheDir).TrimEnd('\') + '\'
    $resolvedStaging = [IO.Path]::GetFullPath($stagingDir)
    if (-not $resolvedStaging.StartsWith($resolvedCache, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a staging path outside vendor-cache: $resolvedStaging"
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

$archive = [IO.Compression.ZipFile]::OpenRead($packagePath)
try {
    $requiredEntries = @(
        "lib/net462/Microsoft.Web.WebView2.Core.dll",
        "lib/net462/Microsoft.Web.WebView2.WinForms.dll",
        "runtimes/win-x64/native/WebView2Loader.dll",
        "LICENSE.txt",
        "NOTICE.txt"
    )
    foreach ($entryName in $requiredEntries) {
        $entry = $archive.GetEntry($entryName)
        if (-not $entry) {
            throw "Required file is missing from the WebView2 package: $entryName"
        }

        $destination = Join-Path $stagingDir ($entryName -replace '/', '\')
        $destinationDirectory = Split-Path -Parent $destination
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
        $inputStream = $entry.Open()
        try {
            $outputStream = [IO.File]::Open($destination, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $inputStream.CopyTo($outputStream)
            }
            finally {
                $outputStream.Dispose()
            }
        }
        finally {
            $inputStream.Dispose()
        }
    }
}
finally {
    $archive.Dispose()
}

$coreDll = Join-Path $stagingDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
$winFormsDll = Join-Path $stagingDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $stagingDir "runtimes\win-x64\native\WebView2Loader.dll"
$licenseFile = Join-Path $outputDir "LICENSE-WebView2.txt"

$references = @(
    (Join-Path $frameworkDir "System.dll"),
    (Join-Path $frameworkDir "System.Core.dll"),
    (Join-Path $frameworkDir "System.Drawing.dll"),
    (Join-Path $frameworkDir "System.Windows.Forms.dll"),
    (Join-Path $frameworkDir "System.Web.Extensions.dll"),
    $coreDll,
    $winFormsDll
)
foreach ($reference in $references) {
    if (-not (Test-Path -LiteralPath $reference -PathType Leaf)) {
        throw "A required compiler reference is missing: $reference"
    }
}

$sourceFile = Join-Path $desktopDir "Program.cs"
$configFile = Join-Path $desktopDir "App.config"
if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Desktop source file is missing: $sourceFile"
}
if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) {
    throw "Desktop runtime configuration is missing: $configFile"
}
if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) {
    throw "Desktop application manifest is missing: $manifestFile"
}

Add-Type -AssemblyName System.Drawing
if (-not ("CTextureMakerNativeIconHandle" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CTextureMakerNativeIconHandle
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@
}

$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = $null
$backgroundBrush = $null
$ringPen = $null
$accentBrush = $null
$hIcon = [IntPtr]::Zero
$icon = $null
$iconStream = $null
try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $backgroundBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 29, 52))
    $graphics.FillEllipse($backgroundBrush, 2, 2, 60, 60)
    $ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 220, 200), 9)
    $ringPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $ringPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawArc($ringPen, 10, 10, 44, 44, 44, 272)
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(248, 190, 92))
    $graphics.FillEllipse($accentBrush, 43, 24, 6, 6)

    $hIcon = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $iconStream = [IO.File]::Open($iconFile, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $icon.Save($iconStream)
}
finally {
    if ($iconStream) { $iconStream.Dispose() }
    if ($icon) { $icon.Dispose() }
    if ($hIcon -ne [IntPtr]::Zero) { [CTextureMakerNativeIconHandle]::DestroyIcon($hIcon) | Out-Null }
    if ($accentBrush) { $accentBrush.Dispose() }
    if ($ringPen) { $ringPen.Dispose() }
    if ($backgroundBrush) { $backgroundBrush.Dispose() }
    if ($graphics) { $graphics.Dispose() }
    $bitmap.Dispose()
}

$exePath = Join-Path $outputDir "C-TextureMaker.exe"
$compilerArguments = @(
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/langversion:4",
    "/out:$exePath",
    "/win32manifest:$manifestFile",
    "/win32icon:$iconFile"
)
foreach ($reference in $references) {
    $compilerArguments += "/reference:$reference"
}
$compilerArguments += $sourceFile

& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) {
    throw "C# compilation failed with exit code $LASTEXITCODE."
}

Copy-Item -LiteralPath $coreDll -Destination (Join-Path $outputDir "Microsoft.Web.WebView2.Core.dll") -Force
Copy-Item -LiteralPath $winFormsDll -Destination (Join-Path $outputDir "Microsoft.Web.WebView2.WinForms.dll") -Force
Copy-Item -LiteralPath $loaderDll -Destination (Join-Path $outputDir "WebView2Loader.dll") -Force
Copy-Item -LiteralPath $configFile -Destination ($exePath + ".config") -Force

$licenseText = [IO.File]::ReadAllText((Join-Path $stagingDir "LICENSE.txt"))
$noticeText = [IO.File]::ReadAllText((Join-Path $stagingDir "NOTICE.txt"))
$combinedLicense = "Microsoft.Web.WebView2 package license`r`n`r`n$licenseText`r`n`r`nMicrosoft.Web.WebView2 third-party notices`r`n`r`n$noticeText"
[IO.File]::WriteAllText($licenseFile, $combinedLicense, (New-Object Text.UTF8Encoding($false)))

if (Test-Path -LiteralPath $stagingDir) {
    $resolvedCache = [IO.Path]::GetFullPath($cacheDir).TrimEnd('\') + '\'
    $resolvedStaging = [IO.Path]::GetFullPath($stagingDir)
    if (-not $resolvedStaging.StartsWith($resolvedCache, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a staging path outside vendor-cache: $resolvedStaging"
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}

if ($StagingBuild) {
    Write-Host "Built C-TextureMaker for Windows x64 in desktop\build-staging."
}
else {
    Write-Host "Built C-TextureMaker for Windows x64 in dist\C-TextureMaker."
}
Get-Item -LiteralPath $exePath, ($exePath + ".config"), (Join-Path $outputDir "Microsoft.Web.WebView2.Core.dll"), (Join-Path $outputDir "Microsoft.Web.WebView2.WinForms.dll"), (Join-Path $outputDir "WebView2Loader.dll"), $licenseFile |
    Select-Object Name, Length |
    Format-Table -AutoSize
Write-Host "Place the app folder beside C-TextureMaker.exe before launch."
