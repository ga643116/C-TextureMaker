/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, createDocument, createLayer, normalizeDocument, renderSVG } from '../app/engine.mjs';

const expandedMaxima = {
  concentric: { count: 512, minRadius: 2048, maxRadius: 2048, innerWidth: 256, outerWidth: 256, dashLength: 512, dashGap: 512 },
  halftone: { spacing: 512, maxDot: 512, minDot: 512 },
  hud: { radius: 2048, stepWidth: 512, stepDepth: 512, bevel: 512, endLength: 512, strokeWidth: 256, dashGap: 512 },
  ticks: { count: 1024, radius: 2048, length: 512, strokeWidth: 256, dashGap: 512, majorEvery: 128, majorScale: 8, waveFrequency: 48, waveAmplitude: 512 },
  barcode: { count: 1024, width: 512 },
  waves: { spacing: 512, amplitude: 512, frequency: 32, strokeWidth: 256 },
  lines: { strokeWidth: 256, spacing: 512, dashLength: 512, dashGap: 512 },
  dots: { size: 512, spacing: 512, rows: 80, columns: 80 },
  polygons: { cellSize: 512, shapeScale: 1, strokeWidth: 256 },
  contour: { peaks: 32, terrainScale: 8, sampling: 256, levels: 64, octaves: 8, strokeWidth: 256 },
  symbols: { size: 512, spacing: 512, strokeWidth: 256 },
  nested: { sides: 64, radius: 2048, radiusStep: 512, count: 256, strokeWidth: 256 },
  globe: { radiusX: 2048, radiusY: 2048, longitudes: 128, latitudes: 128, strokeWidth: 256 },
  grid: { cellSize: 512, strokeWidth: 256, diagonalWidth: 256, dashLength: 512, dashGap: 512, junctionSize: 512, junctionWidth: 256, cornerSize: 512, cornerInset: 512, dotSize: 512, dotSpacing: 512, hatchWidth: 256, hatchSpacing: 512 },
  rays: { count: 1024, innerRadius: 2048, outerRadius: 2048, strokeWidth: 256 },
};

function documentWithLayer(type, params) {
  const doc = createDocument();
  doc.layers = [createLayer(type, `limits-${type}`)];
  Object.assign(doc.layers[0].params, params);
  return doc;
}

function controlFor(type, key) {
  return PATTERNS.find(pattern => pattern.id === type).controls.find(control => control.key === key);
}

test('expanded maxima remain aligned with the existing parameter schema and normalize without clipping', () => {
  for (const [type, maxima] of Object.entries(expandedMaxima)) {
    const pattern = PATTERNS.find(entry => entry.id === type);
    const doc = documentWithLayer(type, maxima);
    const normalized = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(Object.keys(normalized.layers[0].params), Object.keys(pattern.defaults), `${type} parameter schema`);
    for (const [key, max] of Object.entries(maxima)) {
      assert.equal(controlFor(type, key).max, max, `${type}.${key} control maximum`);
      assert.equal(normalized.layers[0].params[key], max, `${type}.${key} roundtrip`);
    }
  }
  assert.equal(controlFor('dots', 'rows').max, 80);
  assert.equal(controlFor('dots', 'columns').max, 80);
  assert.equal(controlFor('polygons', 'shapeScale').max, 1);
});

test('expanded radius, line width, and count bounds appear in generated SVG geometry', () => {
  const rings = normalizeDocument(documentWithLayer('concentric', {
    count: 512, minRadius: 0, maxRadius: 2048, innerWidth: 256, outerWidth: 256,
  }));
  const ringSvg = renderSVG(rings);
  assert.equal((ringSvg.match(/<path d="M/g) ?? []).length, 512);
  assert.match(ringSvg, /A2048,2048/);
  assert.equal((ringSvg.match(/stroke-width="256"/g) ?? []).length, 512);

  const ticks = normalizeDocument(documentWithLayer('ticks', {
    count: 1024, radius: 2048, length: 512, strokeWidth: 256,
    majorEvery: 128, majorScale: 8, waveFrequency: 48, waveAmplitude: 512,
  }));
  const tickSvg = renderSVG(ticks);
  assert.equal((tickSvg.match(/<path d="M/g) ?? []).length, 1024);
  assert.match(tickSvg, /stroke-width="256"/);

  const barcode = normalizeDocument(documentWithLayer('barcode', { count: 1024, width: 512 }));
  assert.equal((renderSVG(barcode).match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="#e9e6df"\/>/g) ?? []).length, 1024);

  const nested = normalizeDocument(documentWithLayer('nested', {
    count: 256, sides: 64, radius: 2048, radiusStep: 512, strokeWidth: 256,
  }));
  const nestedSvg = renderSVG(nested);
  assert.equal((nestedSvg.match(/<polygon\b/g) ?? []).length, 256);
  assert.equal((nestedSvg.match(/<polygon\b[^>]*points="[^"]+"/)[0].match(/,/g) ?? []).length, 64);

  const globe = normalizeDocument(documentWithLayer('globe', {
    radiusX: 2048, radiusY: 2048, longitudes: 128, latitudes: 128, strokeWidth: 256,
  }));
  assert.equal((renderSVG(globe).match(/<ellipse\b/g) ?? []).length, 255);

  const rays = normalizeDocument(documentWithLayer('rays', {
    mode: 'fixedWidth', count: 1024, innerRadius: 0, outerRadius: 2048, strokeWidth: 256,
  }));
  assert.equal((renderSVG(rays).match(/<path d="M/g) ?? []).length, 1024);
});

test('high-frequency waves receive denser samples and remain finite', () => {
  const waves = documentWithLayer('waves', { frequency: 32, amplitude: 512, spacing: 512, strokeWidth: 256 });
  const svg = renderSVG(waves);
  const firstPath = svg.match(/<path d="([^"]+)"/)?.[1];
  assert.ok(firstPath);
  assert.equal((firstPath.match(/L/g) ?? []).length, 384);
  assert.match(svg, /stroke-width="256"/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('maximum contour detail produces finite curved geometry', () => {
  const contour = documentWithLayer('contour', {
    peaks: 32, terrainScale: 8, sampling: 256, levels: 64, octaves: 8, strokeWidth: 256,
  });
  const svg = renderSVG(contour);
  assert.match(svg, /stroke-width="256"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.ok((svg.match(/C/g) ?? []).length > 100);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
