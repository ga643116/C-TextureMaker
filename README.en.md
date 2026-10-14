# C-TextureMaker

An offline Windows pattern studio for creating transparent, seamless-ready assets from 16 adjustable procedural pattern families, with SVG and PNG export.

[繁體中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

**v1.4.0 public preview** · [Download the Windows x64 portable package](https://github.com/ga643116/C-TextureMaker/releases/download/v1.4.0/C-TextureMaker-1.4.0-win-x64.zip) · [Release](https://github.com/ga643116/C-TextureMaker/releases/tag/v1.4.0) · [Source](https://github.com/ga643116/C-TextureMaker)

[See what's new in 1.4.0](docs/releases/v1.4.0.md#english)

**New in this release**: Low Poly, image coloring, contour depth and improved Save / Save As.

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

- 16 pattern families: concentric arcs, halftone dots, HUD gauges, radial ticks, decorative barcodes, wave lines, parallel lines, dot grids, polygon grids, contours, Low Poly, symbol arrays, nested polygons, a globe, engineering grids, and radial beams.
- Adjust shape, color, rotation, scale, and position live. Use layers, presets, undo/redo, and .ctm projects. Projects support up to 16 layers; work and preferences are saved locally.
- Seamless mode arranges patterns to the canvas tile period. The 3 × 3 preview helps inspect seams; exports remain a single tile.
- Separate cursor and hand tools; hold Space and drag to pan temporarily. Dot and polygon cells support adjustable paint/erase brushes with one undo per stroke.
- Rename shared PNG/SVG shapes and reuse them across halftone, dots, polygon lattices and symbols. Each layer can keep the original colors or tint with its primary color while preserving transparency.
- Connect dot or polygon cells with adjustable-width lines that appear in exports. Image masks are saved as independent layers, with threshold controls in the lower-left layer list. Changing any pattern's density or rotation leaves the mask fixed to the canvas.
- Base grid and diagonal lines have independent dash settings.
- Traditional Chinese, English, and Japanese interfaces, with dark and light themes.

## Download and launch

1. Download [C-TextureMaker-1.4.0-win-x64.zip](https://github.com/ga643116/C-TextureMaker/releases/download/v1.4.0/C-TextureMaker-1.4.0-win-x64.zip) and extract the entire archive.
2. Open C-TextureMaker.exe. Keep the app folder and DLL files beside it.
3. Place the whole folder somewhere writable so the app can save work and preferences in the adjacent data folder.

Requirements: Windows x64, .NET Framework 4.7.2 or later, and the Microsoft Edge WebView2 Runtime installed on the system. With those components present, the app runs offline and needs no Node.js, Python, account, or development server. It does not install or update system components. Before closing, check that the status bar says “Autosaved.” Save a .ctm project separately when moving or backing up a design.

## Patterns and export

Canvas dimensions range from 128 to 4096 px per side. PNG supports transparent or solid backgrounds and 1×, 2×, and 4× scale. Output is limited to an 8192 px longest edge and 32 MP total; both limits apply.

Procedural patterns export as vector SVG. Imported PNGs are embedded as raster images, so an SVG containing an imported PNG is not fully vector. Halftone, dots, polygon lattices and symbols share imported PNG/SVG shapes, keeping original colors or tinting with the layer's primary color while preserving transparency. The local library holds up to 40 shapes and 32 MiB in total, with a 4 MiB limit per file. Applied shapes are embedded in projects and survive library removal. Halftone also supports alpha masks. Decorative barcodes are not intended for scanning.

Use the image button beside Layers to add a mask. It accepts PNG/JPG/WebP (up to 16 MiB) or SVG (up to 4 MiB), up to 8192 px per side. Dark areas are kept by default; transparent areas stay empty. Adjust threshold and inversion at any time. Select the image layer to move, scale, rotate, or flip it independently; drag its frame and handles in tile view. Masks apply to all pattern layers, multiple masks intersect, and existing cell edits remain intact. Source images are saved in .ctm projects and embedded as SVG masks; PNG exports retain the same effect. Image edges are not automatically made seamless; inspect them in the 3 × 3 preview.

To remove a connection, connect the same two cells again. Esc cancels the start point.

Image layers can switch between Black / white mask and Image colors while preserving their threshold settings. The topmost visible color layer colors all patterns: Low Poly samples a flat color per triangle; other patterns project the image through their shapes. Density, rotation and image transforms update the result live. Use Color from image under Appearance to add a color layer directly.

Low Poly offers vertex density, shape variation, primary / secondary colors, gradient angle and color variation. Contour Depth shading adds inner / outer shadows with softness, distance, angle, color and opacity; turn it off to return to contour lines.

Save project asks for a location once, then updates that file. Use the adjacent arrow or Ctrl+Shift+S for Save As. Opening a .ctm also sets its save destination. Each layer remembers every pattern's settings and cell edits, including across project saves; Reset affects only the current pattern.

1.4.0 opens older projects. Projects with the new pattern, image colors or depth settings require 1.4.0 or later.

## Build from source

Builds require Node.js/npm and Python. These commands install development dependencies, run automated tests, build the frontend and Windows desktop app, and package the portable release:

    npm ci
    npm test
    npm run build
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build-desktop.ps1
    python scripts/package.py

For browser interaction regression tests, install Playwright and Microsoft Edge, run `npm run build`, then `node tests/editor.browser.cjs` / `node tests/features.browser.cjs`.

On the first desktop build, the script downloads the pinned WebView2 SDK from NuGet. The packaged app does not need build tools or a development server.

## License and credits

The project’s own source code is licensed under [MPL-2.0](https://www.mozilla.org/MPL/2.0/); see [LICENSE-SCOPE.md](LICENSE-SCOPE.md) for its scope. Commercial use is allowed. If you distribute modified MPL-covered files, you must make the source of those modified files available under MPL-2.0. Read the full terms in [LICENSE](LICENSE).

Transitions.dev animation and Microsoft WebView2 components retain their own terms, so the complete product should not be described as governed by MPL-2.0 alone. See [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), the [Transitions.dev license](app/vendor/LICENSE.txt), and LICENSE-WebView2.txt in the portable package.

Pattern workflow references [rahoo 素材生成](https://rahoo.online/); this local implementation does not copy its code or artwork. The opening generation animation is from the [official Transitions.dev source](https://github.com/Jakubantalik/transitions.dev/tree/main/skills/transitions-ui-generation).
