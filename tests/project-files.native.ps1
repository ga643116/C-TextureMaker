[CmdletBinding()]
param()

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sourcePath = Join-Path $projectRoot 'desktop\Program.cs'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$runRoot = Join-Path $tempRoot ('ctm-project-files-native-' + [Guid]::NewGuid().ToString('N'))
$resolvedRunRoot = [IO.Path]::GetFullPath($runRoot)

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Native source file is missing: $sourcePath"
}
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw "Framework C# compiler is unavailable: $compiler"
}
if (-not $resolvedRunRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to create test files outside the system temp directory: $resolvedRunRoot"
}

New-Item -ItemType Directory -Path $resolvedRunRoot | Out-Null
try {
    $program = [IO.File]::ReadAllText($sourcePath)
    $marker = '    internal static class AtomicProjectWriter'
    $start = $program.IndexOf($marker, [StringComparison]::Ordinal)
    if ($start -lt 0) {
        throw 'AtomicProjectWriter class was not found in Program.cs.'
    }
    $openBrace = $program.IndexOf('{', $start)
    if ($openBrace -lt 0) {
        throw 'AtomicProjectWriter class body was not found.'
    }

    $depth = 0
    $end = -1
    for ($index = $openBrace; $index -lt $program.Length; $index++) {
        if ($program[$index] -eq '{') {
            $depth++
        }
        elseif ($program[$index] -eq '}') {
            $depth--
            if ($depth -eq 0) {
                $end = $index
                break
            }
        }
    }
    if ($end -lt 0) {
        throw 'AtomicProjectWriter class body is incomplete.'
    }
    $writerClass = $program.Substring($start, $end - $start + 1)

    $prefix = @'
using System;
using System.IO;
using System.Text;
namespace CTextureMaker {
'@
    $runner = @'
    internal static class AtomicProjectWriterCheck
    {
        private static int Main(string[] args)
        {
            string root = args[0];
            string target = Path.Combine(root, "probe.ctm");
            byte[] original = Encoding.UTF8.GetBytes("old project");
            byte[] replacement = Encoding.UTF8.GetBytes("new project");

            AtomicProjectWriter.Write(target, original);
            if (File.ReadAllText(target) != "old project") return 10;

            AtomicProjectWriter.Write(target, replacement);
            if (File.ReadAllText(target) != "new project") return 11;

            bool replaceFailed = false;
            using (FileStream locked = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                try
                {
                    AtomicProjectWriter.Write(target, Encoding.UTF8.GetBytes("must not replace"));
                }
                catch (IOException)
                {
                    replaceFailed = true;
                }
                catch (UnauthorizedAccessException)
                {
                    replaceFailed = true;
                }
            }
            if (!replaceFailed) return 12;
            if (File.ReadAllText(target) != "new project") return 13;
            if (Directory.GetFiles(root, ".probe.ctm.*.tmp").Length != 0) return 14;

            Console.WriteLine("AtomicProjectWriter PASS: new file, overwrite, failed replacement preserves bytes, temp cleanup.");
            return 0;
        }
    }
}
'@
    $code = $prefix + [Environment]::NewLine + $writerClass + [Environment]::NewLine + $runner
    $harnessPath = Join-Path $resolvedRunRoot 'AtomicProjectWriterCheck.cs'
    $exePath = Join-Path $resolvedRunRoot 'AtomicProjectWriterCheck.exe'
    [IO.File]::WriteAllText($harnessPath, $code, (New-Object Text.UTF8Encoding($false)))

    & $compiler /nologo /langversion:4 /out:$exePath $harnessPath
    if ($LASTEXITCODE -ne 0) {
        throw "Atomic writer harness compilation failed with exit code $LASTEXITCODE."
    }
    & $exePath $resolvedRunRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Atomic writer harness failed with exit code $LASTEXITCODE."
    }
}
finally {
    if (Test-Path -LiteralPath $resolvedRunRoot) {
        $checked = [IO.Path]::GetFullPath($resolvedRunRoot)
        if (-not $checked.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a path outside the system temp directory: $checked"
        }
        Remove-Item -LiteralPath $checked -Recurse -Force
    }
}