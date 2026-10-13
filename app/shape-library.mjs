/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { validateDataImage } from './engine.mjs';

export const MAX_SHAPES = 40;
export const MAX_LIBRARY_BYTES = 32 * 1024 * 1024;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 6_000_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,48}$/;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
  'title', 'desc', 'use'
]);
const DANGEROUS_ELEMENTS = new Set([
  'script', 'foreignObject', 'iframe', 'object', 'embed', 'animate', 'animateMotion',
  'animateTransform', 'set'
]);
const SVG_ATTRIBUTES = new Set([
  'xmlns', 'xmlns:xlink', 'version', 'width', 'height', 'viewBox', 'preserveAspectRatio',
  'id', 'class', 'transform', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'fx', 'fy', 'fr', 'd', 'points', 'fill', 'fill-rule', 'fill-opacity', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'opacity', 'offset', 'stop-color', 'stop-opacity',
  'clip-path', 'clip-rule', 'mask', 'mask-type', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'href', 'xlink:href'
]);
const STYLE_PRESENTATION_ATTRIBUTES = new Set([
  'fill', 'stroke', 'fill-rule', 'fill-opacity', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-opacity', 'opacity', 'stop-color', 'stop-opacity', 'clip-path', 'clip-rule', 'mask',
  'mask-type'
]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function dataImageBytes(data) {
  const payload = data.slice(data.indexOf(',') + 1);
  return payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
}

function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeShape(value) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid shape');
  assert(Object.keys(value).every(key => ['id', 'name', 'data'].includes(key)), 'Invalid shape fields');
  const { id, name, data } = value;
  assert(typeof id === 'string' && SAFE_ID.test(id), 'Invalid shape id');
  assert(typeof name === 'string' && name.length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/.test(name), 'Invalid shape name');
  assert(typeof data === 'string' && data.length <= MAX_DATA_URL_LENGTH, 'Invalid shape data');
  validateDataImage(data, 'shape data');
  assert(dataImageBytes(data) <= MAX_IMAGE_BYTES, 'Shape image is too large');
  return { id, name, data };
}

export function normalizeShapeLibrary(value) {
  assert(Array.isArray(value), 'Invalid shape library');
  const library = [];
  const ids = new Set();
  const dataUrls = new Set();
  for (const item of value) {
    const shape = normalizeShape(item);
    assert(!ids.has(shape.id), 'Duplicate shape id');
    ids.add(shape.id);
    if (dataUrls.has(shape.data)) continue;
    dataUrls.add(shape.data);
    library.push(shape);
  }
  assert(library.length <= MAX_SHAPES, 'Shape library has too many shapes');
  assert(serializedBytes(library) <= MAX_LIBRARY_BYTES, 'Shape library is too large');
  return library;
}

export function renameShape(library, id, name) {
  assert(typeof name === 'string' && name.trim().length > 0, 'Invalid shape name');
  const normalized = normalizeShapeLibrary(library);
  assert(normalized.some(shape => shape.id === id), 'Shape not found');
  return normalizeShapeLibrary(normalized.map(shape => shape.id === id ? {...shape, name: name.trim()} : shape));
}

export function addShape(library, value) {
  const current = normalizeShapeLibrary(library);
  const shape = normalizeShape(value);
  const existing = current.find(item => item.data === shape.data);
  if (existing) return { library: current, shape: existing };
  if (current.length >= MAX_SHAPES || serializedBytes([...current, shape]) > MAX_LIBRARY_BYTES) {
    throw new Error('ShapeLibraryFull');
  }
  assert(!current.some(item => item.id === shape.id), 'Duplicate shape id');
  return { library: [...current, shape], shape };
}

export function removeShape(library, id) {
  return normalizeShapeLibrary(library).filter(shape => shape.id !== id);
}

function svgDataUrl(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function localSvgUrl(value) {
  const match = /^url\(\s*(?:(["'])#([A-Za-z_][A-Za-z0-9_.:-]*)\1|#([A-Za-z_][A-Za-z0-9_.:-]*))\s*\)$/i.exec(value);
  return match ? `url(#${match[2] || match[3]})` : null;
}

function assertSafeCss(text) {
  assert(!/(?:@import|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding\s*:)/i.test(text), 'Unsafe SVG');
  const urls = [...text.matchAll(/url\s*\(([^)]*)\)/ig)];
  const openings = text.match(/url\s*\(/ig) || [];
  assert(urls.length === openings.length && urls.every(match => localSvgUrl(`url(${match[1]})`)), 'Unsafe SVG');
}

function stylePresentationAttributes(value) {
  assertSafeCss(value);
  const style = document.createElement('span').style;
  style.cssText = value;
  const attributes = [];
  const maskImage = style.getPropertyValue('mask-image').trim();
  if (maskImage && maskImage !== 'none') {
    const localUrl = localSvgUrl(maskImage);
    assert(localUrl, 'Unsafe SVG');
    attributes.push(['mask', localUrl]);
  } else {
    const mask = style.getPropertyValue('mask').trim();
    if (mask && mask !== 'none') {
      const localUrl = localSvgUrl(mask);
      assert(localUrl, 'Unsafe SVG');
      attributes.push(['mask', localUrl]);
    }
  }
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index).toLowerCase();
    if (name === 'mask' || name === 'mask-image') continue;
    const cssValue = style.getPropertyValue(name).trim();
    assert(!/(?:expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding\s*:)/i.test(cssValue), 'Unsafe SVG');
    const localUrl = /url\s*\(/i.test(cssValue) ? localSvgUrl(cssValue) : null;
    assert(!/url\s*\(/i.test(cssValue) || localUrl, 'Unsafe SVG');
    if (STYLE_PRESENTATION_ATTRIBUTES.has(name)) attributes.push([name, localUrl || cssValue]);
  }
  return attributes;
}

function sanitizeSvg(text) {
  assert(!/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text), 'Unsafe SVG');
  const svgDocument = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = svgDocument.documentElement;
  assert(!svgDocument.querySelector('parsererror') && root?.localName === 'svg', 'Invalid SVG');
  assert(!root.namespaceURI || root.namespaceURI === SVG_NAMESPACE, 'Invalid SVG namespace');
  if (!root.namespaceURI) root.setAttributeNS(XMLNS_NAMESPACE, 'xmlns', SVG_NAMESPACE);

  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (DANGEROUS_ELEMENTS.has(element.localName)) throw new TypeError('Unsafe SVG');
    const inlineStyles = new Map();
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      const lowerName = name.toLowerCase();
      const value = attribute.value.trim();
      if (lowerName.startsWith('on')) throw new TypeError('Unsafe SVG');
      if (lowerName === 'style') {
        for (const [property, styleValue] of stylePresentationAttributes(attribute.value)) {
          inlineStyles.set(property, styleValue);
        }
        element.removeAttribute(name);
        continue;
      }
      if ((lowerName === 'href' || lowerName === 'xlink:href') && value && !value.startsWith('#')) {
        throw new TypeError('Unsafe SVG');
      }
      if (/url\s*\(/i.test(value)) {
        const localUrl = localSvgUrl(value);
        if (!localUrl) throw new TypeError('Unsafe SVG');
        if (localUrl !== value) element.setAttribute(name, localUrl);
      }
      if (lowerName.startsWith('xmlns:') && [SVG_NAMESPACE, XLINK_NAMESPACE].includes(value)) {
        continue;
      }
      if (!SVG_ATTRIBUTES.has(name)) {
        element.removeAttribute(name);
      }
    }
    for (const [property, styleValue] of inlineStyles) element.setAttribute(property, styleValue);
    if (!SVG_ELEMENTS.has(element.localName)) element.remove();
  }
  return new XMLSerializer().serializeToString(root);
}

function readPng(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Image read failed'));
    reader.readAsDataURL(file);
  });
}

export async function importShapeFile(file) {
  assert(file && Number.isFinite(file.size) && file.size > 0 && file.size <= MAX_IMAGE_BYTES, 'Invalid image file');
  let data;
  if (file.name?.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml') {
    const text = await file.text();
    data = svgDataUrl(sanitizeSvg(text));
  } else if (file.type === 'image/png') {
    data = await readPng(file);
  } else {
    throw new TypeError('Invalid image file');
  }

  validateDataImage(data, 'shape image');
  assert(dataImageBytes(data) <= MAX_IMAGE_BYTES && data.length <= MAX_DATA_URL_LENGTH, 'Image is too large');
  const image = new Image();
  image.src = data;
  await image.decode();
  assert(image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth <= 8192 && image.naturalHeight <= 8192, 'Invalid image dimensions');
  return data;
}
