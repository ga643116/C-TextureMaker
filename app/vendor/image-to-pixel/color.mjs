/*
 * Adapted from Tezumie/Image-to-Pixel, lib/core/color.js, revision
 * 46f80e2da5eee005da5bd52938995f7ec2c798b3.
 * Copyright (c) 2023-2026 Tezumie
 * Licensed under the MIT License; see LICENSE in this directory.
 */

const linear = value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

export function oklab(r, g, b) {
  r = linear(r); g = linear(g); b = linear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922051 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function paletteSpread(colors) {
  if (colors.length < 2) return 1;
  let sum = 0;
  for (let i = 0; i < colors.length; i++) {
    let best = Infinity;
    for (let j = 0; j < colors.length; j++) {
      if (i === j) continue;
      const dr = colors[i][0] - colors[j][0], dg = colors[i][1] - colors[j][1], db = colors[i][2] - colors[j][2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (distance < best) best = distance;
    }
    sum += best;
  }
  return Math.max(0.04, Math.min(1, sum / colors.length / 255));
}
