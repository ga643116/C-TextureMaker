/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { prepareRedrawData, renderRedraw } from '../app/shape-redraw.mjs';

function circularRing(cx, cy, radius, vertices) {
  const ring = [];
  for (let index = 0; index < vertices; index++) {
    const angle = index * Math.PI * 2 / vertices;
    ring.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  return ring;
}
function complexData() {
  const holes = [];
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      holes.push(circularRing(80 + column * 120, 80 + row * 120, 24, 96));
    }
  }
  const lines = [];
  for (let index = 0; index < 8; index++) {
    lines.push([circularRing(140 + index * 105, 512, 14, 48)]);
  }
  return {
    version: 1, width: 1024, height: 1024, detail: 55,
    regions: [{ id: 'r0', color: '#c43a30', role: 1, rings: [[0, 0, 1024, 0, 1024, 1024, 0, 1024], ...holes] }],
    lines,
  };
}

test('repeated lineColor renders reuse prepared multi-hole geometry and report timings', t => {
  const source = complexData();
  const prepared = prepareRedrawData(source);
  const params = { mode: 'outline', straightness: 1.25, lineWidth: 1.5, lineColor: '#d02020', lines: true, outlineWidth: 0 };
  const mutableLayer = { id: 'render-bench', redrawData: source, redrawEdits: {}, params: { ...params } };
  const preparedLayer = { ...mutableLayer, redrawData: prepared, params: { ...params } };
  const doc = { width: 1024, height: 1024 };
  const colors = ['#d02020', '#2850c8', '#2a9d55', '#d08c20', '#7628a8', '#111111', '#e04080', '#047c83'];

  renderRedraw(mutableLayer, doc);
  renderRedraw(preparedLayer, doc);
  let mutableMs = 0;
  let preparedMs = 0;
  let firstSvg = '';
  let lastSvg = '';
  for (let index = 0; index < colors.length; index++) {
    mutableLayer.params.lineColor = colors[index];
    preparedLayer.params.lineColor = colors[index];
    let start = performance.now();
    const mutableSvg = renderRedraw(mutableLayer, doc);
    mutableMs += performance.now() - start;
    start = performance.now();
    const preparedSvg = renderRedraw(preparedLayer, doc);
    preparedMs += performance.now() - start;
    assert.equal(preparedSvg, mutableSvg, 'prepared cache preserves SVG for each lineColor');
    if (index === 0) firstSvg = preparedSvg;
    lastSvg = preparedSvg;
  }
  assert.notEqual(firstSvg, lastSvg, 'lineColor changes still affect rendered paint');
  t.diagnostic(JSON.stringify({
    fixture: '1 region, 64 holes, 8 extracted line paths, 96 vertices per hole',
    lineColorRenders: colors.length,
    mutableTotalMs: Number(mutableMs.toFixed(2)),
    preparedTotalMs: Number(preparedMs.toFixed(2)),
    preparedSpeedup: Number((mutableMs / preparedMs).toFixed(2)),
  }));
});
