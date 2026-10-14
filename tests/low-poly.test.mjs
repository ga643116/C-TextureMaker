/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { fitPeriodicBasis } from '../app/periodic.mjs';
import { renderLowPoly } from '../app/low-poly.mjs';

const make = (width = 173, height = 229, seamless = false) => ({ width, height, seamless, seed: 'low-poly-seed' });
const layer = (overrides = {}) => ({
  id: 'low-poly-test', color: '#e9e6df', secondary: '#304060', rotation: 0, scale: 1, offsetX: 0, offsetY: 0,
  params: { points: 180, jitter: .85, colorVariation: .18, gradientAngle: 0 }, ...overrides,
});
const polygons = content => [...content.matchAll(/<polygon points="([^"]+)" fill="([^"]+)"[^>]*\/>/g)].map(match => ({
  points: match[1].split(' ').map(point => point.split(',').map(Number)), fill: match[2],
}));
const area = points => Math.abs((points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0])) / 2;
const raster = source => PNG.sync.read(new Resvg(source).render().asPng());
const svg = (content, width, height) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' + content + '</svg>';

test('local Delaunay mesh is seeded, bounded, and covers the full canvas', () => {
  const doc = make(384, 256), current = layer({ params: { points: 180, jitter: .85, colorVariation: .18, gradientAngle: 0 } });
  const first = renderLowPoly(current, doc), same = renderLowPoly(current, doc);
  assert.equal(first.content, same.content);
  const changed = renderLowPoly(current, { ...doc, seed: 'other-seed' });
  assert.notDeepEqual(polygons(first.content).map(face => face.points), polygons(changed.content).map(face => face.points));
  const faces = polygons(first.content);
  const vertices = new Map(faces.flatMap(face => face.points.map(point => [point.join(','), point])));
  const boundary = [...vertices.values()].filter(([x, y]) => x === 0 || x === doc.width || y === 0 || y === doc.height);
  assert.equal(vertices.size, current.params.points, 'boundary sampling must preserve the requested total vertex count');
  assert.equal(faces.length, 2 * vertices.size - 2 - boundary.length, 'triangulation should include every boundary vertex');
  assert.ok(faces.every(face => area(face.points) > 1e-6));
  assert.ok(Math.abs(faces.reduce((sum, face) => sum + area(face.points), 0) - doc.width * doc.height) < 1e-5);
  const seenEdges = new Set();
  let maxBoundaryEdge = 0;
  for (const face of faces) for (let index = 0; index < 3; index++) {
    const a = face.points[index], b = face.points[(index + 1) % 3];
    const key = [a.join(','), b.join(',')].sort().join('|');
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    const onSide = (a[1] === b[1] && (a[1] === 0 || a[1] === doc.height)) || (a[0] === b[0] && (a[0] === 0 || a[0] === doc.width));
    if (onSide) maxBoundaryEdge = Math.max(maxBoundaryEdge, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  assert.ok(maxBoundaryEdge <= 3 * Math.sqrt(doc.width * doc.height / current.params.points), 'perimeter points should prevent long skinny edge fans');
  assert.ok(first.bounds.minX < 0 && first.bounds.minY < 0 && first.bounds.maxX > doc.width && first.bounds.maxY > doc.height);
  assert.equal(first.world, false);
  assert.ok(polygons(renderLowPoly(layer({ params: { points: 300, jitter: .85, colorVariation: .18, gradientAngle: 0 } }), doc).content).length > faces.length);
});

test('palette gradient and per-face variation change flat fills', () => {
  const doc = make(96, 72), base = layer({ params: { points: 64, jitter: .85, colorVariation: 0, gradientAngle: 0 } });
  const original = polygons(renderLowPoly(base, doc).content).map(face => face.fill);
  const recolored = polygons(renderLowPoly({ ...base, color: '#00ff00', secondary: '#0000ff' }, doc).content).map(face => face.fill);
  assert.notDeepEqual(original, recolored);
  assert.ok(new Set(original).size > 2);
  const varied = polygons(renderLowPoly({ ...base, params: { ...base.params, colorVariation: 1 } }, doc).content).map(face => face.fill);
  assert.notDeepEqual(original, varied);
});

test('image samples transform local positions and alpha-average several interior colors', () => {
  const doc = make(90, 70), current = layer({
    rotation: 90, scale: 1.7, offsetX: 13, offsetY: -9,
    params: { points: 32, jitter: .5, colorVariation: 0, gradientAngle: 0 },
  });
  const first = polygons(renderLowPoly(current, doc).content)[0].points;
  const center = [(first[0][0] + first[1][0] + first[2][0]) / 3, (first[0][1] + first[1][1] + first[2][1]) / 3];
  const expected = [
    doc.width / 2 + current.scale * (Math.cos(Math.PI / 2) * (center[0] - doc.width / 2) - Math.sin(Math.PI / 2) * (center[1] - doc.height / 2)) + current.offsetX,
    doc.height / 2 + current.scale * (Math.sin(Math.PI / 2) * (center[0] - doc.width / 2) + Math.cos(Math.PI / 2) * (center[1] - doc.height / 2)) + current.offsetY,
  ];
  let calls = 0;
  const sampled = renderLowPoly(current, doc, { sampleColor(x, y) {
    if (calls === 0) assert.ok(Math.abs(x - expected[0]) < 1e-4 && Math.abs(y - expected[1]) < 1e-4);
    return calls++ % 4 === 0 ? [255, 0, 0, 0] : [0, 0, 255, 128];
  } });
  const sampledFaces = polygons(sampled.content);
  assert.equal(calls, sampledFaces.length * 4);
  assert.equal(sampledFaces[0].fill, 'rgba(0,0,255,0.3765)');
  assert.ok(!sampled.content.includes('<path '), 'semi-transparent sampled faces must not get colored edge strokes');
});

test('seamless Delaunay faces are unique, periodic, and cover exactly one tile', () => {
  const doc = make(173, 229, true), current = layer({
    rotation: 27, scale: .73, offsetX: 31, offsetY: -47,
    params: { points: 180, jitter: .85, colorVariation: .18, gradientAngle: 33 },
  });
  const field = renderLowPoly(current, doc);
  assert.equal(field.world, true);
  assert.ok(Object.values(field.bounds).every(Number.isFinite));
  const faces = polygons(field.content);
  const spacing = Math.sqrt(doc.width * doc.height / (current.params.points * Math.sqrt(3) / 2)) / current.scale;
  const fit = fitPeriodicBasis([spacing, 0], [spacing / 2, spacing * Math.sqrt(3) / 2], doc.width, doc.height, current.rotation * Math.PI / 180, current.scale, current.params.points);
  assert.equal(faces.length, fit.count * 2);
  const faceKeys = faces.map(face => face.points.map(point => [
    (((point[0] % doc.width) + doc.width) % doc.width).toFixed(4),
    (((point[1] % doc.height) + doc.height) % doc.height).toFixed(4),
  ].join(',')).sort().join('|'));
  assert.equal(new Set(faceKeys).size, faces.length, 'each torus face should have one canonical owner');
  assert.ok(Math.abs(faces.reduce((sum, face) => sum + area(face.points), 0) - doc.width * doc.height) < 1e-4);
  const repeated = size => {
    const copies = [];
    for (let ty = -1; ty <= size; ty++) for (let tx = -1; tx <= size; tx++) {
      copies.push('<g transform="translate(' + tx * doc.width + ' ' + ty * doc.height + ')">' + field.content + '</g>');
    }
    return svg(copies.join(''), doc.width * size, doc.height * size);
  };
  const sheet = raster(repeated(2));
  let differingPixels = 0, lowAlphaPixels = 0;
  for (let index = 3; index < sheet.data.length; index += 4) if (sheet.data[index] < 250) lowAlphaPixels++;
  assert.equal(lowAlphaPixels, 0, 'opaque palette tiles must not show antialias gaps, including at wrapped edges');
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const first = (y * sheet.width + x) * 4, next = ((ty * doc.height + y) * sheet.width + tx * doc.width + x) * 4;
      if ([0, 1, 2, 3].some(channel => sheet.data[first + channel] !== sheet.data[next + channel])) differingPixels++;
    }
  }
  assert.ok(differingPixels <= 2 * (doc.width + doc.height), 'periodic copies should differ only by minor raster edge rounding');
});

test('seamless image sampling adds offset and wraps while preserving transparency', () => {
  const doc = make(80, 64, true), current = layer({
    rotation: 13, scale: .8, offsetX: 123, offsetY: -92,
    params: { points: 40, jitter: .7, colorVariation: .1, gradientAngle: 0 },
  });
  let calls = 0;
  const field = renderLowPoly(current, doc, { sampleColor(x, y) {
    calls++;
    assert.ok(x >= 0 && x < doc.width && y >= 0 && y < doc.height);
    return [40, 90, 130, 0];
  } });
  assert.equal(field.world, true);
  assert.ok(calls > 0);
  assert.ok(polygons(field.content).every(face => face.fill === 'rgba(0,0,0,0)'));
  assert.ok(!field.content.includes('<path '), 'fully transparent sampled faces must not get colored edge strokes');
});

test('opaque image samples remain fully covered across output sizes and point counts', () => {
  for (const [width, height, points] of [[128, 180, 180], [384, 540, 180], [384, 540, 800]]) {
    const doc = make(width, height), current = layer({ params: { points, jitter: .85, colorVariation: 0, gradientAngle: 0 } });
    const field = renderLowPoly(current, doc, { sampleColor(x, y) {
      return [Math.round(x * .83) % 256, Math.round(y * .61) % 256, 150, 255];
    } });
    const fills = new Set(polygons(field.content).map(face => face.fill));
    assert.ok(fills.size > 2, 'opaque photo samples should preserve flat per-face color changes');
    assert.ok(field.content.includes('stroke-width="1.75"'), 'opaque face edges should receive a small antialias overlap');
    const image = raster(svg(field.content, doc.width, doc.height));
    let belowOpaqueThreshold = 0;
    for (let index = 3; index < image.data.length; index += 4) if (image.data[index] < 250) belowOpaqueThreshold++;
    assert.equal(belowOpaqueThreshold, 0, width + 'x' + height + ' at ' + points + ' points should stay nearly fully opaque');
  }
});