# C-TextureMaker

An offline Windows pattern studio for creating transparent, seamless-ready assets from 15 adjustable procedural pattern families, with SVG and PNG export.

[繁體中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

**v1.0.2 public preview** · [Download the Windows x64 portable package](https://github.com/ga643116/C-TextureMaker/releases/download/v1.0.2/C-TextureMaker-1.0.2-win-x64.zip) · [Release](https://github.com/ga643116/C-TextureMaker/releases/tag/v1.0.2) · [Source](https://github.com/ga643116/C-TextureMaker)

![Workspace in Traditional Chinese with the dark theme](docs/media/workspace-zh-dark.png)

<details>
<summary>More workspace views</summary>

![Workspace in English with the light theme](docs/media/workspace-en-light.png)

![Export panel in Japanese](docs/media/export-ja.png)

</details>

**Contour generation** — Watch contours form from the selected parameters.

![Contour generation animation](docs/media/generation-contours.gif)

**Seamless export** — Inspect a single tile and its seamless repeat.

![Seamless export animation](docs/media/seamless-export.gif)

## Features

- 15 pattern families: concentric arcs, halftone dots, HUD gauges, radial ticks, decorative barcodes, wave lines, parallel lines, dot grids, polygon grids, contours, symbol arrays, nested polygons, a globe, engineering grids, and radial beams.
- Adjust shape, color, rotation, scale, and position live. Use layers, presets, undo/redo, and .ctm projects. Projects support up to 16 layers; work and preferences are saved locally.
- Seamless mode arranges patterns to the canvas tile period. The 3 × 3 preview helps inspect seams; exports remain a single tile.
- Traditional Chinese, English, and Japanese interfaces, with dark and light themes.

## Download and launch

1. Download [C-TextureMaker-1.0.2-win-x64.zip](https://github.com/ga643116/C-TextureMaker/releases/download/v1.0.2/C-TextureMaker-1.0.2-win-x64.zip) and extract the entire archive.
2. Open C-TextureMaker.exe. Keep the app folder and DLL files beside it.
3. Place the whole folder somewhere writable so the app can save work and preferences in the adjacent data folder.

Requirements: Windows x64, .NET Framework 4.7.2 or later, and the Microsoft Edge WebView2 Runtime installed on the system. With those components present, the app runs offline and needs no Node.js, Python, account, or development server. It does not install or update system components. Before closing, check that the status bar says “Autosaved.” Save a .ctm project separately when moving or backing up a design.

## Patterns and export

Canvas dimensions range from 128 to 4096 px per side. PNG supports transparent or solid backgrounds and 1×, 2×, and 4× scale. Output is limited to an 8192 px longest edge and 32 MP total; both limits apply.

Procedural patterns export as vector SVG. Imported PNGs are embedded as raster images, so an SVG containing an imported PNG is not fully vector. Halftone patterns can use an imported PNG or SVG as a shape, or a transparent PNG as a mask. Each input file is limited to 4 MiB. Decorative barcodes are not intended for scanning.

## Build from source

Builds require Node.js/npm and Python. These commands install development dependencies, run automated tests, build the frontend and Windows desktop app, and package the portable release:

    npm ci
    npm test
    npm run build
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build-desktop.ps1
    python scripts/package.py

On the first desktop build, the script downloads the pinned WebView2 SDK from NuGet. The packaged app does not need build tools or a development server.

## License and credits

The project’s own source code is licensed under [MPL-2.0](https://www.mozilla.org/MPL/2.0/); see [LICENSE-SCOPE.md](LICENSE-SCOPE.md) for its scope. Commercial use is allowed. If you distribute modified MPL-covered files, you must make the source of those modified files available under MPL-2.0. Read the full terms in [LICENSE](LICENSE).

Transitions.dev animation and Microsoft WebView2 components retain their own terms, so the complete product should not be described as governed by MPL-2.0 alone. See [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), the [Transitions.dev license](app/vendor/LICENSE.txt), and LICENSE-WebView2.txt in the portable package.

Pattern workflow references [rahoo 素材生成](https://rahoo.online/); this local implementation does not copy its code or artwork. The opening generation animation is from the [official Transitions.dev source](https://github.com/Jakubantalik/transitions.dev/tree/main/skills/transitions-ui-generation).
