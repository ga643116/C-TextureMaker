/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const transparent = () => [0, 0, 0, 0];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createImageSources({ isImageMaskLayer, imageMaskGeometry, createImageColorSampler }) {
  function resolveColorSources(doc, layer) {
    const selection = layer?.imageSource ?? 'auto';
    if (selection === 'none') return [];
    const images = (doc?.layers ?? []).filter(isImageMaskLayer);
    if (selection === 'all') return images.filter(image => image.visible && image.mode === 'color');
    if (selection === 'auto') {
      const source = images.findLast(image => image.visible && image.mode === 'color');
      return source ? [source] : [];
    }
    const explicit = images.find(image => image.id === selection && image.visible && (image.mode === 'color' || image.mode === 'image'));
    return explicit ? [explicit] : [];
  }

  function hasColorSource(doc, layer) {
    const selection = layer?.imageSource ?? 'auto';
    if (selection === 'none') return false;
    if (selection === 'all' || selection === 'auto') {
      return (doc?.layers ?? []).some(image => isImageMaskLayer(image) && image.mode === 'color');
    }
    return true;
  }

  function createCompositeColorSampler(doc, layer, options = {}) {
    const samplers = resolveColorSources(doc, layer)
      .filter(source => source.colorMap)
      .map(source => createImageColorSampler(source, imageMaskGeometry(source, doc), options))
      .filter(Boolean);
    if (!samplers.length) return hasColorSource(doc, layer) ? transparent : null;
    return (x, y) => {
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (const sample of samplers) {
        const rgba = sample(x, y) ?? transparent();
        const sourceAlpha = clamp(Number(rgba[3]) || 0, 0, 255) / 255;
        const retain = 1 - sourceAlpha;
        red = clamp(Number(rgba[0]) || 0, 0, 255) * sourceAlpha + red * retain;
        green = clamp(Number(rgba[1]) || 0, 0, 255) * sourceAlpha + green * retain;
        blue = clamp(Number(rgba[2]) || 0, 0, 255) * sourceAlpha + blue * retain;
        alpha = sourceAlpha + alpha * retain;
      }
      return alpha > 0
        ? [Math.round(red / alpha), Math.round(green / alpha), Math.round(blue / alpha), Math.round(alpha * 255)]
        : transparent();
    };
  }

  return { resolveColorSources, hasColorSource, createCompositeColorSampler };
}
