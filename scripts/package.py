# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Package runtime files into a versioned folder without touching earlier user data."""
import argparse
from pathlib import Path
import shutil
import zipfile
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description="Package the portable C-TextureMaker runtime.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Output root for the versioned folder and ZIP (default: project release directory)",
    )
    args = parser.parse_args()

    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    source = root / "dist" / "C-TextureMaker"
    output_root = (args.output_dir or root / "release").resolve()
    release = output_root / f"C-TextureMaker-{version}"
    release.mkdir(parents=True, exist_ok=True)

    # This explicit list is the complete portable payload; application data is never packaged.
    files = [
        "C-TextureMaker.exe",
        "C-TextureMaker.exe.config",
        "Microsoft.Web.WebView2.Core.dll",
        "Microsoft.Web.WebView2.WinForms.dll",
        "WebView2Loader.dll",
        "LICENSE-WebView2.txt",
    ]
    for name in files:
        shutil.copy2(source / name, release / name)

    app_files = [
        "index.html",
        "bundle.js",
        "redraw-worker.js",
        "style.css",
        "icon.svg",
        "vendor/ui-generation.css",
        "vendor/LICENSE.txt",
    ]
    for name in app_files:
        relative = Path("app") / name
        (release / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, release / relative)
        files.append(str(relative))

    additional_files = {
        "LICENSE": root / "LICENSE",
        "LICENSE-SCOPE.md": root / "LICENSE-SCOPE.md",
        "SOURCE.txt": root / "SOURCE.txt",
        "README.txt": root / "docs" / "QUICKSTART.txt",
        "THIRD-PARTY-NOTICES.txt": root / "THIRD-PARTY-NOTICES.txt",
    }
    for name, path in additional_files.items():
        shutil.copy2(path, release / name)
        files.append(name)

    # A clean checkout can name its exact source without creating a release tag.
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True, timeout=10
        ).strip()
        dirty = subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=root, text=True, timeout=10
        ).strip()
        if not dirty:
            source_note = (release / "SOURCE.txt").read_text(encoding="utf-8")
            source_note = source_note.replace("/tree/main", f"/tree/{revision}")
            source_note = source_note.replace("/archive/refs/heads/main.zip", f"/archive/{revision}.zip")
            (release / "SOURCE.txt").write_text(source_note, encoding="utf-8")
    except (OSError, subprocess.SubprocessError):
        pass  # Source archives retain the repository URL from SOURCE.txt.

    archive = output_root / f"C-TextureMaker-{version}-win-x64.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name in files:
            package.write(release / name, str(Path("C-TextureMaker") / name))
    print(f"Runtime files: {len(files)}; {sum((release / name).stat().st_size for name in files):,} bytes")
    print(f"ZIP: {archive.stat().st_size:,} bytes")
    print(f"SHA-256: {hashlib.sha256(archive.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
