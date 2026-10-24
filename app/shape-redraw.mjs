/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import ShapeRedraw from './vendor/constructivism-redraw/redraw-core.mjs';

const MAX_EDGE = 1024;
const MIN_EDGE = 8;
const MAX_REGIONS = 2048;
const MAX_COORDINATES = 500000;
const PREPARED_REDRAW_DATA = new WeakSet();
const REDRAW_GEOMETRY_CACHE = new WeakMap();
const MAX_CACHED_GEOMETRIES = 3;
const HEX = /^#[0-9a-fA-F]{6}$/;
const PALETTES = {
  poster: ['#e8dcc0', '#d52b1e', '#1a1a1a'],
  ocean: ['#e4f2f4', '#4589a4', '#193c53'],
  forest: ['#e8edcf', '#71904c', '#263d2c'],
};

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value, keys, name) {
  if (!record(value)) throw new TypeError('Invalid ' + name);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid ' + name + ' fields');
}
function validDimension(value) {
  return Number.isSafeInteger(value) && value >= MIN_EDGE && value <= MAX_EDGE;
}
function validHex(value) {
  return typeof value === 'string' && HEX.test(value);
}
function canonicalHex(value) {
  return value.toLowerCase();
}
function ringArea(ring) {
  let area = 0;
  for (let i = 0, n = ring.length; i < n; i += 2) {
    const j = (i + 2) % n;
    area += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return area / 2;
}
function ringBounds(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minY = Math.min(minY, ring[i + 1]); maxY = Math.max(maxY, ring[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}
function pointOnSegment(x, y, ax, ay, bx, by) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-8) return false;
  return x >= Math.min(ax, bx) - 1e-8 && x <= Math.max(ax, bx) + 1e-8 &&
    y >= Math.min(ay, by) - 1e-8 && y <= Math.max(ay, by) + 1e-8;
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], ay = ring[j + 1], bx = ring[i], by = ring[i + 1];
    if (pointOnSegment(x, y, ax, ay, bx, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function pointInRingInterior(x, y, ring) {
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if (pointOnSegment(x, y, ring[j], ring[j + 1], ring[i], ring[i + 1])) return false;
  }
  return pointInRing(x, y, ring);
}
function boundsOverlapInterior(a, b) {
  return Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) &&
    Math.min(a.maxY, b.maxY) > Math.max(a.minY, b.minY);
}
function crossValue(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
function oppositeSides(a, b) {
  return (a > 1e-8 && b < -1e-8) || (a < -1e-8 && b > 1e-8);
}
function segmentsCrossInterior(ax, ay, bx, by, cx, cy, dx, dy) {
  return oppositeSides(crossValue(ax, ay, bx, by, cx, cy), crossValue(ax, ay, bx, by, dx, dy)) &&
    oppositeSides(crossValue(cx, cy, dx, dy, ax, ay), crossValue(cx, cy, dx, dy, bx, by));
}
function interiorProbeOverlaps(ring, other) {
  const winding = Math.sign(ringArea(ring));
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const dx = ring[j] - ring[i], dy = ring[j + 1] - ring[i + 1], length = Math.hypot(dx, dy);
    if (!length) continue;
    const mx = (ring[i] + ring[j]) / 2, my = (ring[i + 1] + ring[j + 1]) / 2;
    for (const fraction of [1e-4, 1e-6, 1e-7, 1e-8, 1e-9]) {
      const offset = length * fraction;
      const x = mx - dy / length * winding * offset;
      const y = my + dx / length * winding * offset;
      if (pointInRingInterior(x, y, ring) && pointInRingInterior(x, y, other)) return true;
    }
  }
  return false;
}
function ringsOverlapInterior(first, second, firstBounds = ringBounds(first), secondBounds = ringBounds(second)) {
  if (!boundsOverlapInterior(firstBounds, secondBounds)) return false;
  for (let i = 0; i < first.length; i += 2) {
    if (pointInRingInterior(first[i], first[i + 1], second)) return true;
  }
  for (let i = 0; i < second.length; i += 2) {
    if (pointInRingInterior(second[i], second[i + 1], first)) return true;
  }
  for (let i = 0; i < first.length; i += 2) {
    const nextFirst = (i + 2) % first.length;
    for (let j = 0; j < second.length; j += 2) {
      const nextSecond = (j + 2) % second.length;
      if (segmentsCrossInterior(
        first[i], first[i + 1], first[nextFirst], first[nextFirst + 1],
        second[j], second[j + 1], second[nextSecond], second[nextSecond + 1],
      )) return true;
    }
  }
  return interiorProbeOverlaps(first, second) || interiorProbeOverlaps(second, first);
}
function ringsContain(outer, inner) {
  const ob = ringBounds(outer), ib = ringBounds(inner);
  if (ib.minX < ob.minX || ib.minY < ob.minY || ib.maxX > ob.maxX || ib.maxY > ob.maxY) return false;
  for (let i = 0; i < inner.length; i += 2) {
    if (!pointInRing(inner[i], inner[i + 1], outer)) return false;
    const j = (i + 2) % inner.length;
    if (!pointInRing((inner[i] + inner[j]) / 2, (inner[i + 1] + inner[j + 1]) / 2, outer)) return false;
  }
  return true;
}
function validateFlatRing(ring, width, height, counter, label) {
  if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0) throw new TypeError('Invalid ' + label);
  counter.value += ring.length;
  if (counter.value > MAX_COORDINATES) throw new TypeError('RedrawOutputTooComplex');
  let previousX = NaN, previousY = NaN;
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i], y = ring[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) ||
        x < 0 || y < 0 || x > width || y > height || (x === previousX && y === previousY)) {
      throw new TypeError('Invalid ' + label + ' coordinate');
    }
    previousX = x; previousY = y;
  }
  if (ring[0] === ring[ring.length - 2] && ring[1] === ring[ring.length - 1]) throw new TypeError('Repeated closing point');
  if (Math.abs(ringArea(ring)) < 1e-8) throw new TypeError('Degenerate ' + label);
  return ring.slice();
}

export function normalizeRedrawData(value) {
  if (value === undefined || value === null) return null;
  if (PREPARED_REDRAW_DATA.has(value)) return value;
  exactKeys(value, ['version', 'width', 'height', 'detail', 'regions', 'lines'], 'redraw data');
  if (value.version !== 1 || !validDimension(value.width) || !validDimension(value.height) ||
      !Number.isInteger(value.detail) || value.detail < 0 || value.detail > 100 ||
      !Array.isArray(value.regions) || value.regions.length > MAX_REGIONS || !Array.isArray(value.lines)) {
    throw new TypeError('Invalid redraw data');
  }
  const counter = { value: 0 };
  const regions = [];
  for (let index = 0; index < value.regions.length; index++) {
    const source = value.regions[index];
    exactKeys(source, ['id', 'color', 'role', 'rings'], 'redraw region');
    if (source.id !== 'r' + index || !validHex(source.color) || !Number.isInteger(source.role) ||
        source.role < 0 || source.role > 2 || !Array.isArray(source.rings) || source.rings.length < 1) {
      throw new TypeError('Invalid redraw region');
    }
    const rings = source.rings.map((ring, ringIndex) => validateFlatRing(ring, value.width, value.height, counter, ringIndex ? 'redraw hole' : 'redraw ring'));
    if (rings.length > 1) {
      let work = 0;
      for (let ringIndex = 1; ringIndex < rings.length; ringIndex++) {
        work += rings[0].length * rings[ringIndex].length;
        if (work > 20000000 || !ringsContain(rings[0], rings[ringIndex])) throw new TypeError('Invalid redraw hole');
      }
      const bounds = rings.map(ringBounds);
      let overlapWork = 0;
      for (let a = 1; a < rings.length; a++) for (let b = a + 1; b < rings.length; b++) {
        if (!boundsOverlapInterior(bounds[a], bounds[b])) continue;
        overlapWork += rings[a].length * rings[b].length;
        if (overlapWork > 20000000) throw new TypeError('RedrawOutputTooComplex');
        if (ringsOverlapInterior(rings[a], rings[b], bounds[a], bounds[b])) throw new TypeError('Overlapping redraw holes');
      }
    }
    regions.push({ id: source.id, color: canonicalHex(source.color), role: source.role, rings });
  }
  const lines = [];
  for (const line of value.lines) {
    if (!Array.isArray(line) || line.length < 1) throw new TypeError('Invalid redraw line');
    lines.push(line.map(ring => validateFlatRing(ring, value.width, value.height, counter, 'redraw line')));
  }
  return { version: 1, width: value.width, height: value.height, detail: value.detail, regions, lines };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function prepareRedrawData(value) {
  const data = normalizeRedrawData(value);
  if (!data) return null;
  deepFreeze(data);
  PREPARED_REDRAW_DATA.add(data);
  return data;
}

export function normalizeRedrawEdits(value, data) {
  if (value === undefined || value === null) return {};
  if (!record(value)) throw new TypeError('Invalid redraw edits');
  const ids = new Set((data?.regions || []).map(region => region.id));
  const result = {};
  for (const [id, edit] of Object.entries(value)) {
    if (!ids.has(id) || !record(edit)) throw new TypeError('Invalid redraw edit');
    const keys = Object.keys(edit);
    if (keys.length < 1 || keys.length > 2 || keys.some(key => key !== 'hidden' && key !== 'color')) throw new TypeError('Invalid redraw edit fields');
    const copy = {};
    if (Object.hasOwn(edit, 'hidden')) {
      if (typeof edit.hidden !== 'boolean') throw new TypeError('Invalid redraw visibility edit');
      copy.hidden = edit.hidden;
    }
    if (Object.hasOwn(edit, 'color')) {
      if (!validHex(edit.color)) throw new TypeError('Invalid redraw color edit');
      copy.color = canonicalHex(edit.color);
    }
    result[id] = copy;
  }
  return result;
}

function parseHex(color) {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}
function toHex(rgb) {
  return '#' + rgb.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
}
function lab(rgb) {
  const result = new Float64Array(3);
  ShapeRedraw._internal.rgbToLab(rgb[0], rgb[1], rgb[2], result, 0);
  return result;
}
function colorDistance(a, b) {
  const x = lab(parseHex(a)), y = lab(parseHex(b));
  return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
}
function regionArea(region) {
  if (!region.rings.length) return 0;
  let area = Math.abs(ringArea(region.rings[0]));
  for (let i = 1; i < region.rings.length; i++) area -= Math.abs(ringArea(region.rings[i]));
  return Math.max(0.1, area);
}
function rolePalette(data) {
  const fallback = PALETTES.poster.slice();
  if (!data?.regions?.length) return fallback;
  const sums = [0, 0, 0].map(() => [0, 0, 0, 0]);
  for (const region of data.regions) {
    const role = region.role, rgb = parseHex(region.color), weight = regionArea(region), sum = sums[role];
    sum[0] += rgb[0] * weight; sum[1] += rgb[1] * weight; sum[2] += rgb[2] * weight; sum[3] += weight;
  }
  return sums.map((sum, role) => sum[3] ? toHex(sum.slice(0, 3).map(value => value / sum[3])) : fallback[role]);
}
export function getRedrawPalette(layer) {
  const params = layer?.params || {};
  const mode = ['blocks', 'three'].includes(params.mode) ? params.mode : 'blocks';
  const paletteMode = ['original', 'poster', 'ocean', 'forest', 'custom'].includes(params.paletteMode) ? params.paletteMode : 'original';
  const data = layer?.redrawData;
  if (paletteMode === 'original') {
    if (mode === 'three') return rolePalette(data);
    const unique = [], seen = new Set();
    for (const region of data?.regions || []) {
      if (!seen.has(region.color)) { seen.add(region.color); unique.push(region.color); }
      if (unique.length === 32) break;
    }
    return unique.length ? unique : rolePalette(data);
  }
  if (paletteMode === 'custom') {
    const custom = layer?.redrawPalette;
    if (Array.isArray(custom)) {
      const filtered = custom.filter(validHex).slice(0, 32).map(canonicalHex);
      if (filtered.length) return filtered;
    }
    return PALETTES.poster.slice();
  }
  return PALETTES[paletteMode].slice();
}
function resolveRegionColor(region, layer, palette) {
  const edit = layer?.redrawEdits?.[region?.id];
  if (validHex(edit?.color)) return canonicalHex(edit.color);
  const params = layer?.params || {};
  if (params.mode === 'three') {
    const colors = palette.length ? palette : PALETTES.poster;
    const index = [0, Math.floor((colors.length - 1) / 2), colors.length - 1][region.role] ?? 0;
    return colors[index] || PALETTES.poster[region.role] || PALETTES.poster[0];
  }
  if (params.paletteMode === 'original' || !palette.length) return region.color;
  let best = palette[0], distance = Infinity;
  for (const color of palette) {
    const candidate = colorDistance(region.color, color);
    if (candidate < distance) { distance = candidate; best = color; }
  }
  return best;
}
export function redrawRegionColor(region, layer) {
  return resolveRegionColor(region, layer, getRedrawPalette(layer));
}
function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function fmt(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
function cleanId(value) {
  return String(value || 'layer').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48) || 'layer';
}
function pointCount(ring) {
  return ring.length / 2;
}
function simplifyRing(ring, epsilon) {
  if (!(epsilon > 0) || pointCount(ring) <= 3) return ring;
  const simplified = ShapeRedraw._internal.dpClosed(ring, epsilon);
  if (!simplified || simplified.length < 6) return ring;
  const copy = Array.from(simplified);
  if (Math.abs(ringArea(copy)) < 1e-8) return ring;
  return copy;
}
function simplifyRings(rings, epsilon) {
  const result = rings.map(ring => simplifyRing(ring, epsilon));
  if (result.length > 1) {
    for (let i = 1; i < result.length; i++) {
      if (!ringsContain(result[0], result[i])) return rings;
    }
  }
  return result;
}
function pathData(rings, scaleX, scaleY) {
  const commands = [];
  for (const ring of rings) {
    if (ring.length < 6) continue;
    commands.push('M' + fmt(ring[0] * scaleX) + ' ' + fmt(ring[1] * scaleY));
    for (let i = 2; i < ring.length; i += 2) commands.push('L' + fmt(ring[i] * scaleX) + ' ' + fmt(ring[i + 1] * scaleY));
    commands.push('Z');
  }
  return commands.join('');
}
function buildRedrawGeometry(data, epsilon) {
  const regionPaths = [];
  const outerPaths = [];
  for (const region of data.regions) {
    const rings = simplifyRings(region.rings, epsilon);
    regionPaths.push(pathData(rings, 1, 1));
    outerPaths.push(pathData([rings[0]], 1, 1));
  }
  const linePaths = data.lines.map(line => pathData(simplifyRings(line, epsilon), 1, 1));
  return { regionPaths, outerPaths, linePaths };
}
function redrawGeometry(data, epsilon) {
  if (!PREPARED_REDRAW_DATA.has(data)) return buildRedrawGeometry(data, epsilon);
  let cache = REDRAW_GEOMETRY_CACHE.get(data);
  if (!cache) {
    cache = new Map();
    REDRAW_GEOMETRY_CACHE.set(data, cache);
  }
  const cached = cache.get(epsilon);
  if (cached) {
    cache.delete(epsilon);
    cache.set(epsilon, cached);
    return cached;
  }
  const geometry = buildRedrawGeometry(data, epsilon);
  if (cache.size >= MAX_CACHED_GEOMETRIES) cache.delete(cache.keys().next().value);
  cache.set(epsilon, geometry);
  return geometry;
}
function areaBounds(rings) {
  let minY = Infinity, minX = Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i += 2) {
    if (ring[i + 1] < minY || (ring[i + 1] === minY && ring[i] < minX)) { minY = ring[i + 1]; minX = ring[i]; }
  }
  return { minX, minY };
}
function optionNumber(params, key, fallback) {
  return clamp(params?.[key], 0, 12, fallback);
}
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderRedraw(layer, doc, { preview = false, lineArt = null } = {}) {
  const data = normalizeRedrawData(layer?.redrawData);
  if (!data || !data.regions.length) return '';
  const edits = normalizeRedrawEdits(layer?.redrawEdits, data);
  const params = layer?.params || {};
  const outlineMode = params.mode === 'outline';
  const docWidth = Number.isFinite(doc?.width) && doc.width > 0 ? doc.width : data.width;
  const docHeight = Number.isFinite(doc?.height) && doc.height > 0 ? doc.height : data.height;
  const scaleX = docWidth / data.width, scaleY = docHeight / data.height;
  const maxScale = Math.max(scaleX, scaleY, 1e-6);
  const straightness = optionNumber(params, 'straightness', 0);
  const epsilon = straightness / maxScale;
  const geometry = redrawGeometry(data, epsilon);
  const lineWidth = optionNumber(params, 'lineWidth', 1);
  const outlineWidth = optionNumber(params, 'outlineWidth', 0);
  const lineColor = validHex(params.lineColor) ? canonicalHex(params.lineColor) : '#202020';
  const showLines = params.lines === true && lineWidth > 0 && data.lines.length > 0 && lineArt === null;
  const id = cleanId(layer?.id);
  const escapedLayerId = escapeAttr(layer?.id);
  const lineColorAttrs = preview ? ' data-redraw-line-color="' + escapedLayerId + '"' : '';
  const lineFillAttrs = preview ? ' data-redraw-line-fill="' + escapedLayerId + '"' : '';
  const clipId = 'redraw-' + id + '-visible';
  const visibleIndices = [];
  for (let index = 0; index < data.regions.length; index++) {
    if (edits[data.regions[index].id]?.hidden !== true) visibleIndices.push(index);
  }
  const output = ['<g transform="scale(' + fmt(scaleX) + ' ' + fmt(scaleY) + ')">'];

  if (!outlineMode && outlineWidth > 0 && visibleIndices.length) {
    output.push('<g fill="none" stroke="' + lineColor + '" stroke-width="' + fmt(outlineWidth / maxScale) + '" stroke-linejoin="round" pointer-events="none"' + lineColorAttrs + '>');
    for (const index of visibleIndices) output.push('<path d="' + geometry.outerPaths[index] + '"/>');
    output.push('</g>');
  }

  output.push('<defs><clipPath id="' + clipId + '" clipPathUnits="userSpaceOnUse">');
  for (const index of visibleIndices) output.push('<path d="' + geometry.regionPaths[index] + '" fill-rule="evenodd" clip-rule="evenodd"/>');
  output.push('</clipPath></defs>');

  const paletteLayer = { ...layer, redrawData: data, redrawEdits: edits };
  const palette = outlineMode ? [] : getRedrawPalette(paletteLayer);
  const paintOrder = preview
    ? data.regions.map((region, index) => ({ region, index }))
    : visibleIndices.map(index => ({ region: data.regions[index], index }));
  for (const { region, index } of paintOrder) {
    const hidden = edits[region.id]?.hidden === true;
    const color = outlineMode ? region.color : resolveRegionColor(region, paletteLayer, palette);
    const d = geometry.regionPaths[index];
    const attrs = preview ? ' data-redraw-region="' + region.id + '" data-layer="' + escapedLayerId + '" pointer-events="all"' : '';
    if (preview && hidden) {
      output.push('<path id="redraw-' + id + '-' + region.id + '" d="' + d + '" fill="' + color + '" fill-opacity="0" fill-rule="evenodd"' + attrs + '/>');
    } else if (outlineMode) {
      if(lineArt!==null){
        if(preview)output.push('<path id="redraw-' + id + '-' + region.id + '" d="' + d + '" fill="' + color + '" fill-opacity="0" fill-rule="evenodd"' + attrs + '/>');
      } else output.push('<path id="redraw-' + id + '-' + region.id + '" d="' + d + '" fill="none" fill-rule="evenodd" clip-rule="evenodd" stroke="' + lineColor + '" stroke-width="' + fmt(lineWidth / maxScale) + '" stroke-linejoin="round"' + lineColorAttrs + attrs + '/>');
    } else {
      const seam = straightness > 0 ? Math.min(0.75, straightness * 0.06) : 0;
      const stroke = seam ? ' stroke="' + color + '" stroke-width="' + fmt(seam) + '" stroke-linejoin="round"' : '';
      output.push('<path id="redraw-' + id + '-' + region.id + '" d="' + d + '" fill="' + color + '" fill-rule="evenodd" clip-rule="evenodd"' + stroke + attrs + '/>');
    }
  }
  if(lineArt!==null&&visibleIndices.length){
    output.push('<g clip-path="url(#'+clipId+')" pointer-events="none"><g transform="scale('+fmt(1/scaleX)+' '+fmt(1/scaleY)+')">'+lineArt+'</g></g>');
  }
  if (showLines && visibleIndices.length) {
    output.push('<g clip-path="url(#' + clipId + ')" pointer-events="none">');
    for (let index = 0; index < geometry.linePaths.length; index++) {
      output.push('<path id="redraw-' + id + '-line-' + index + '" d="' + geometry.linePaths[index] + '" fill="' + lineColor + '" fill-rule="evenodd" stroke="' + lineColor + '" stroke-width="' + fmt(lineWidth / maxScale) + '" stroke-linejoin="round"' + lineColorAttrs + lineFillAttrs + '/>');
    }
    output.push('</g>');
  }
  output.push('</g>');
  return output.join('');
}

function validateBuildInput(rgba, width, height, detail, seed) {
  if (!(rgba instanceof Uint8ClampedArray) || !validDimension(width) || !validDimension(height) || rgba.length !== width * height * 4) {
    throw new TypeError('Invalid redraw image');
  }
  if (!Number.isInteger(detail) || detail < 0 || detail > 100) throw new TypeError('Invalid redraw detail');
  if (!(typeof seed === 'number' && Number.isFinite(seed)) && !(typeof seed === 'string' && seed.length <= 128)) throw new TypeError('Invalid redraw seed');
}
function assignRoles(clusters) {
  const active = clusters.filter(cluster => cluster.frac > 0).slice().sort((a, b) => a.L - b.L || a.k - b.k);
  const roles = new Uint8Array(clusters.length);
  if (active.length <= 1) {
    if (active.length) roles[active[0].k] = 1;
    return roles;
  }
  let total = 0;
  for (const cluster of active) total += cluster.frac;
  let cumulative = 0;
  for (const cluster of active) {
    const midpoint = (cumulative + cluster.frac / 2) / total;
    roles[cluster.k] = midpoint < 1 / 3 ? 2 : midpoint < 2 / 3 ? 1 : 0;
    cumulative += cluster.frac;
  }
  roles[active[0].k] = 2;
  roles[active[active.length - 1].k] = 0;
  if (active.length >= 3) roles[active[Math.floor(active.length / 2)].k] = 1;
  return roles;
}function mergeSmallComponents(labels, mask, width, height, clusters, threshold) {
  if (threshold < 2) return;
  const labColors = clusters.map(cluster => {
    const result = new Float64Array(3), rgb = cluster.rgb;
    ShapeRedraw._internal.rgbToLab(rgb[0], rgb[1], rgb[2], result, 0);
    return result;
  });
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let cluster = 0; cluster < clusters.length; cluster++) {
      const binary = new Uint8Array(labels.length);
      for (let i = 0; i < labels.length; i++) if (mask[i] && labels[i] === cluster) binary[i] = 1;
      const cc = ShapeRedraw._internal.labelCC(binary, width, height);
      const byId = new Map();
      for (let component = 1; component <= cc.n; component++) {
        if (cc.area[component] < threshold) byId.set(component, { component, area: cc.area[component], pixels: [] });
      }
      if (!byId.size) continue;
      for (let pixel = 0; pixel < labels.length; pixel++) {
        const item = byId.get(cc.lab[pixel]);
        if (item) item.pixels.push(pixel);
      }
      const components = Array.from(byId.values()).sort((a, b) => a.area - b.area || a.component - b.component);
      for (const item of components) {
        const neighbors = new Map();
        for (const pixel of item.pixels) {
          const x = pixel % width, y = (pixel / width) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighbor = ny * width + nx;
            if (mask[neighbor] && labels[neighbor] !== cluster) neighbors.set(labels[neighbor], (neighbors.get(labels[neighbor]) || 0) + 1);
          }
        }
        if (!neighbors.size) continue;
        let target = -1, bestCount = -1, bestDistance = Infinity;
        for (const [candidate, count] of neighbors) {
          const a = labColors[cluster], b = labColors[candidate];
          const distance = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
          if (count > bestCount || (count === bestCount && (distance < bestDistance || (distance === bestDistance && candidate < target)))) {
            target = candidate; bestCount = count; bestDistance = distance;
          }
        }
        for (const pixel of item.pixels) labels[pixel] = target;
        changed = true;
      }
    }
    if (!changed) break;
  }
}function copyRing(ring) {
  return Array.from(ring);
}
function totalGeometryScalars(regions, lines) {
  let count = 0;
  for (const region of regions) for (const ring of region.rings) count += ring.length;
  for (const line of lines) for (const ring of line) count += ring.length;
  return count;
}

export function buildRedraw(rgba, width, height, { detail = 55, seed = 1924 } = {}) {
  validateBuildInput(rgba, width, height, detail, seed);
  const prepared = ShapeRedraw.prepare(rgba, width, height);
  if (!prepared.n) return { version: 1, width, height, detail, regions: [], lines: [] };
  const analysis = ShapeRedraw.analyze(prepared, {
    k: 4 + Math.round(detail * 0.08),
    sp: 3 + (100 - detail) * 0.06,
    sr: 12 + (100 - detail) * 0.16,
    line: 12 + (100 - detail) * 0.12,
    seed,
  });
  const roles = assignRoles(analysis.clusters);
  const labels = new Uint8Array(analysis.labels);
  const mergeThreshold = Math.floor(prepared.n * 0.0025 * ((100 - detail) / 100) ** 2);
  mergeSmallComponents(labels, prepared.m, width, height, analysis.clusters, mergeThreshold);

  const regionsWithBounds = [];
  for (const cluster of analysis.clusters) {
    const mask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < mask.length; pixel++) if (prepared.m[pixel] && labels[pixel] === cluster.k) mask[pixel] = 1;
    const groups = ShapeRedraw._internal.traceLoops(mask, width, height);
    for (const group of groups) {
      const rings = [copyRing(group.outer.pts), ...group.holes.map(hole => copyRing(hole.pts))];
      regionsWithBounds.push({
        cluster: cluster.k,
        color: toHex(cluster.rgb),
        role: roles[cluster.k],
        rings,
        bounds: areaBounds(rings),
      });
    }
  }
  regionsWithBounds.sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX || a.cluster - b.cluster);
  if (regionsWithBounds.length > MAX_REGIONS) throw new TypeError('RedrawOutputTooComplex');
  const regions = regionsWithBounds.map((region, index) => ({
    id: 'r' + index,
    color: region.color,
    role: region.role,
    rings: region.rings,
  }));

  const lineMinArea = Math.max(2, Math.round(2 + (100 - detail) * 0.08));
  const lineMask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < lineMask.length; pixel++) {
    const component = analysis.lineCC.lab[pixel];
    if (component > 0 && analysis.lineCC.area[component] >= lineMinArea) lineMask[pixel] = 1;
  }
  const lines = ShapeRedraw._internal.traceLoops(lineMask, width, height).map(group => [
    copyRing(group.outer.pts),
    ...group.holes.map(hole => copyRing(hole.pts)),
  ]).sort((a, b) => {
    const aa = areaBounds(a), bb = areaBounds(b);
    return aa.minY - bb.minY || aa.minX - bb.minX;
  });

  if (totalGeometryScalars(regions, lines) > MAX_COORDINATES) throw new TypeError('RedrawOutputTooComplex');
  return { version: 1, width, height, detail, regions, lines };
}

export { simplifyRings };
