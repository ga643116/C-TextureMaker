/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import Delaunator from 'delaunator';
import { emptyBounds, fitPeriodicBasis, includeBounds } from './periodic.mjs';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fmt = value => String(Number((Number.isFinite(value) ? value : 0).toFixed(4)));
const pointText = point => fmt(point[0]) + ',' + fmt(point[1]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const wrap = (value, extent) => ((value % extent) + extent) % extent;

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function randomFor(...parts) {
  let state = parts.reduce((result, part) => result ^ hash(part), 0) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function colorFromHex(value, fallback) {
  const match = /^#([\da-f]{6})$/i.exec(String(value ?? ''));
  if (!match) return fallback;
  const number = Number.parseInt(match[1], 16);
  return [number >>> 16, number >>> 8 & 255, number & 255];
}

function paletteFill(layer, params, point, width, height, random) {
  const first = colorFromHex(layer.color, [233, 230, 223]);
  const second = colorFromHex(layer.secondary, [119, 115, 109]);
  const angle = params.gradientAngle * Math.PI / 180;
  const span = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
  const t = clamp(.5 + ((point[0] - width / 2) * Math.cos(angle) + (point[1] - height / 2) * Math.sin(angle)) / Math.max(1e-9, span), 0, 1);
  const light = 1 + (random() - .5) * .36 * params.colorVariation;
  const rgb = first.map((channel, index) => clamp(Math.round((channel + (second[index] - channel) * t) * light), 0, 255));
  return 'rgb(' + rgb.join(',') + ')';
}

function faceSamples(a, b, c) {
  return [
    [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3],
    [a[0] * .6 + b[0] * .2 + c[0] * .2, a[1] * .6 + b[1] * .2 + c[1] * .2],
    [a[0] * .2 + b[0] * .6 + c[0] * .2, a[1] * .2 + b[1] * .6 + c[1] * .2],
    [a[0] * .2 + b[0] * .2 + c[0] * .6, a[1] * .2 + b[1] * .2 + c[1] * .6],
  ];
}

function averageSample(sampleColor, samples, pointToCanvas) {
  let alphaTotal = 0, red = 0, green = 0, blue = 0, count = 0, opaque = true;
  for (const point of samples) {
    const [x, y] = pointToCanvas(point);
    const rgba = sampleColor(x, y);
    if (!rgba || rgba.length < 4) {
      opaque = false;
      continue;
    }
    const alpha = clamp(finite(rgba[3], 0), 0, 255);
    if (alpha !== 255) opaque = false;
    red += clamp(finite(rgba[0], 0), 0, 255) * alpha;
    green += clamp(finite(rgba[1], 0), 0, 255) * alpha;
    blue += clamp(finite(rgba[2], 0), 0, 255) * alpha;
    alphaTotal += alpha;
    count++;
  }
  if (!count) return { fill: 'rgba(0,0,0,0)', opaque: false };
  const alpha = alphaTotal / count;
  const rgb = alphaTotal > 0 ? [red, green, blue].map(channel => Math.round(channel / alphaTotal)) : [0, 0, 0];
  return { fill: 'rgba(' + rgb.join(',') + ',' + fmt(alpha / 255) + ')', opaque: opaque && count === samples.length };
}

function edgePointKey(point, width, height, world) {
  return pointText(world ? [wrap(point[0], width), wrap(point[1], height)] : point);
}

function edgeKey(a, b, width, height, world) {
  return [edgePointKey(a, width, height, world), edgePointKey(b, width, height, world)].sort().join('|');
}

function renderFaces(layer, faces, points, options) {
  const { width, height, world, sampleColor, pointToCanvas, params, random } = options;
  const bounds = emptyBounds(), records = [], output = [];
  for (const face of faces) {
    const vertices = face.map(index => points[index]);
    const [a, b, c] = vertices;
    if (Math.abs(cross(a, b, c)) < 1e-8) continue;
    const center = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    const sampled = sampleColor ? averageSample(sampleColor, faceSamples(a, b, c), pointToCanvas) : null;
    const fill = sampled ? sampled.fill : paletteFill(layer, params, center, width, height, random);
    records.push({ vertices, fill, opaque: sampled ? sampled.opaque : true });
    output.push('<polygon points="' + vertices.map(pointText).join(' ') + '" fill="' + fill + '"/>');
    for (const point of vertices) includeBounds(bounds, point[0], point[1]);
  }

  const edges = new Map();
  for (let faceIndex = 0; faceIndex < records.length; faceIndex++) {
    const record = records[faceIndex];
    for (let index = 0; index < 3; index++) {
      const a = record.vertices[index], b = record.vertices[(index + 1) % 3];
      const key = edgeKey(a, b, width, height, world), edge = edges.get(key);
      if (edge) edge.faces.push(faceIndex);
      else edges.set(key, { a, b, faces: [faceIndex] });
    }
  }

  const strokes = [];
  for (const edge of edges.values()) {
    if (edge.faces.length < 1 || edge.faces.length > 2) continue;
    const [first, second] = edge.faces;
    if (!records[first].opaque || (second !== undefined && !records[second].opaque)) continue;
    const stroke = records[first].fill, strokeWidth = 1.75, radius = strokeWidth / 2;
    strokes.push('<path d="M' + pointText(edge.a) + 'L' + pointText(edge.b) + '" fill="none" stroke="' + stroke + '" stroke-width="' + fmt(strokeWidth) + '" stroke-linecap="square"/>');
    includeBounds(bounds, edge.a[0], edge.a[1], radius);
    includeBounds(bounds, edge.b[0], edge.b[1], radius);
  }
  if (!output.length) Object.assign(bounds, { minX: 0, minY: 0, maxX: width, maxY: height });
  return { content: output.join('') + strokes.join(''), bounds, world };
}

function localPoints(count, width, height, jitter, random) {
  const points = [[0, 0], [width, 0], [width, height], [0, height]];
  const spacing = Math.sqrt(width * height / count);
  const perimeter = 2 * (width + height);
  const boundaryCount = Math.min(count - 8, Math.max(0, Math.round(perimeter / (1.5 * spacing) - 4)));
  const lengths = [width, height, width, height];
  const ideal = lengths.map(length => boundaryCount * length / perimeter);
  const allocations = ideal.map(Math.floor);
  let unassigned = boundaryCount - allocations.reduce((sum, value) => sum + value, 0);
  const order = ideal.map((value, index) => ({ index, remainder: value - allocations[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < unassigned; index++) allocations[order[index].index]++;

  for (let side = 0; side < allocations.length; side++) {
    const amount = allocations[side], gap = 1 / (amount + 1);
    for (let index = 1; index <= amount; index++) {
      const t = index * gap + (random() - .5) * .8 * jitter * gap;
      if (side === 0) points.push([t * width, 0]);
      else if (side === 1) points.push([width, t * height]);
      else if (side === 2) points.push([(1 - t) * width, height]);
      else points.push([0, (1 - t) * height]);
    }
  }

  const interiorCount = count - points.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(interiorCount * width / height)));
  const rows = Math.ceil(interiorCount / columns);
  const cellWidth = width / columns, cellHeight = height / rows;
  for (let index = 0; index < interiorCount; index++) {
    const column = index % columns, row = Math.floor(index / columns);
    const x = (column + .5 + (random() - .5) * .9 * jitter) * cellWidth;
    const y = (row + .5 + (random() - .5) * .9 * jitter) * cellHeight;
    points.push([x, y]);
  }
  return points;
}
function periodicPoints(count, jitter, random, width, height, scale, rotation) {
  const spacing = Math.sqrt(width * height / (count * Math.sqrt(3) / 2)) / scale;
  const period = fitPeriodicBasis(
    [spacing, 0], [spacing / 2, spacing * Math.sqrt(3) / 2],
    width, height, rotation, scale, count,
  );
  const u = period.u, v = period.v, determinant = u[0] * v[1] - u[1] * v[0];
  const ca = Math.cos(rotation), sa = Math.sin(rotation);
  const origin = [
    width / 2 - scale * (ca * width / 2 - sa * height / 2),
    height / 2 - scale * (sa * width / 2 + ca * height / 2),
  ];
  const inverse = point => {
    const x = point[0] - origin[0], y = point[1] - origin[1];
    return [(v[1] * x - v[0] * y) / determinant, (-u[1] * x + u[0] * y) / determinant];
  };
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(inverse);
  const minI = Math.floor(Math.min(...corners.map(point => point[0])) - .5) - 1;
  const maxI = Math.ceil(Math.max(...corners.map(point => point[0])) - .5) + 1;
  const minJ = Math.floor(Math.min(...corners.map(point => point[1])) - .5) - 1;
  const maxJ = Math.ceil(Math.max(...corners.map(point => point[1])) - .5) + 1;
  const canonical = [];
  for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
    const x = origin[0] + (i + .5) * u[0] + (j + .5) * v[0];
    const y = origin[1] + (i + .5) * u[1] + (j + .5) * v[1];
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const dx = (random() - .5) * jitter + (random() - .5) * 1e-5;
    const dy = (random() - .5) * jitter + (random() - .5) * 1e-5;
    canonical.push([x + dx * u[0] + dy * v[0], y + dx * u[1] + dy * v[1]]);
  }
  const points = [];
  for (let tileY = -1; tileY <= 1; tileY++) for (let tileX = -1; tileX <= 1; tileX++) {
    for (const point of canonical) points.push([point[0] + tileX * width, point[1] + tileY * height]);
  }
  return points;
}

function periodicFaceKey(face, points, width, height) {
  return face.map(index => {
    const point = points[index];
    return [wrap(point[0], width).toFixed(4), wrap(point[1], height).toFixed(4)].join(',');
  }).sort().join('|');
}

function seamlessFaces(points, width, height) {
  const triangulation = Delaunator.from(points, point => point[0], point => point[1]);
  const faces = [], seen = new Set();
  for (let index = 0; index < triangulation.triangles.length; index += 3) {
    const face = [triangulation.triangles[index], triangulation.triangles[index + 1], triangulation.triangles[index + 2]];
    const a = points[face[0]], b = points[face[1]], c = points[face[2]];
    const centerX = (a[0] + b[0] + c[0]) / 3, centerY = (a[1] + b[1] + c[1]) / 3;
    if (centerX < 0 || centerX >= width || centerY < 0 || centerY >= height) continue;
    const key = periodicFaceKey(face, points, width, height);
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(face);
  }
  return faces;
}

export function renderLowPoly(layer, doc, { sampleColor = null } = {}) {
  const width = Math.max(1, finite(doc?.width, 1)), height = Math.max(1, finite(doc?.height, 1));
  const source = layer.params ?? {};
  const params = {
    points: Math.round(clamp(finite(source.points, 180), 16, 3000)),
    jitter: clamp(finite(source.jitter, .85), 0, 1),
    colorVariation: clamp(finite(source.colorVariation, .18), 0, 1),
    gradientAngle: clamp(finite(source.gradientAngle, 0), -180, 180),
  };
  const scale = Math.max(.001, finite(layer.scale, 1));
  const rotation = finite(layer.rotation, 0) * Math.PI / 180;
  const offsetX = finite(layer.offsetX, 0), offsetY = finite(layer.offsetY, 0);
  const world = Boolean(doc.seamless);
  const geometryRandom = randomFor(doc.seed ?? '', layer.id ?? 'lowpoly', 'geometry');
  const colorRandom = randomFor(doc.seed ?? '', layer.id ?? 'lowpoly', 'face-color');
  let points, faces;
  if (world) {
    points = periodicPoints(params.points, params.jitter, geometryRandom, width, height, scale, rotation);
    faces = seamlessFaces(points, width, height);
  } else {
    points = localPoints(params.points, width, height, params.jitter, geometryRandom);
    const triangulation = Delaunator.from(points, point => point[0], point => point[1]);
    faces = [];
    for (let index = 0; index < triangulation.triangles.length; index += 3) {
      faces.push([triangulation.triangles[index], triangulation.triangles[index + 1], triangulation.triangles[index + 2]]);
    }
  }
  const pointToCanvas = world
    ? point => [wrap(point[0] + offsetX, width), wrap(point[1] + offsetY, height)]
    : point => {
      const x = point[0] - width / 2, y = point[1] - height / 2;
      return [
        width / 2 + scale * (Math.cos(rotation) * x - Math.sin(rotation) * y) + offsetX,
        height / 2 + scale * (Math.sin(rotation) * x + Math.cos(rotation) * y) + offsetY,
      ];
    };
  return renderFaces(layer, faces, points, {
    width, height, world, sampleColor, pointToCanvas, params, random: colorRandom,
  });
}
