/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Run: node tests/layer-performance.browser.cjs before|after
 * Uses the locally built dist app in an isolated headless Edge context.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'dist', 'C-TextureMaker', 'app');
const outputRoot = path.join(root, '.tools', 'layer-performance');
const label = process.argv[2];
if (!['before', 'after'].includes(label)) throw new Error('Pass exactly one label: before or after');
const switchTargets = ['p-manga', 'image-a', 'p-lineart', 'image-b', 'p-dots', 'p-pixel'];
const switchSamples = 24;
const toggleSamples = 5;
const pasteSamples = 3;
const width = 1024;
const height = 1024;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function stats(rows) {
  const keys = ['syncMs', 'raf1Ms', 'raf2Ms'];
  if (rows.some(row => Number.isFinite(row.commitMs))) keys.push('commitMs');
  return Object.fromEntries(keys.map(key => [key, median(rows.map(row => row[key]).filter(Number.isFinite))]));
}
function makeSource(seed) {
  const png = new PNG({ width, height });
  const palettes = seed === 0
    ? [[238, 54, 43], [245, 194, 60], [43, 111, 202], [37, 177, 125]]
    : [[30, 176, 180], [134, 70, 212], [239, 108, 37], [226, 215, 83]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const blockX = x >> 5;
      const blockY = y >> 5;
      const paletteIndex = (blockX * 3 + blockY * 5 + ((x & 31) > 15 ? 1 : 0) + ((y & 31) > 15 ? 2 : 0) + seed) & 3;
      const [red, green, blue] = palettes[paletteIndex];
      const index = (y * width + x) * 4;
      png.data[index] = red;
      png.data[index + 1] = green;
      png.data[index + 2] = blue;
      png.data[index + 3] = 255;
    }
  }
  return {
    image: 'data:image/png;base64,' + PNG.sync.write(png).toString('base64'),
    imageWidth: width,
    imageHeight: height,
    colorMap: { width, height, rgba: png.data.toString('base64') }
  };
}
function percentileProfile(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const totals = new Map();
  for (let index = 0; index < profile.samples.length; index++) {
    const node = nodes.get(profile.samples[index]);
    if (!node) continue;
    const callFrame = node.callFrame || {};
    const key = [callFrame.functionName || '(anonymous)', callFrame.url || '', callFrame.lineNumber ?? -1].join('|');
    totals.set(key, (totals.get(key) || 0) + (profile.timeDeltas?.[index] || 0));
  }
  return [...totals.entries()]
    .map(([key, microseconds]) => {
      const [functionName, url, line] = key.split('|');
      return { functionName, url, line: Number(line) + 1, sampledMs: Number((microseconds / 1000).toFixed(2)) };
    })
    .sort((a, b) => b.sampledMs - a.sampledMs)
    .slice(0, 16);
}
function relativeComparison(before, after) {
  const comparison = {};
  for (const operation of ['layerSwitch', 'visibility', 'lineArt', 'paste']) {
    comparison[operation] = {};
    for (const metric of ['syncMs', 'raf1Ms', 'raf2Ms', 'commitMs']) {
      const oldValue = before?.operations?.[operation]?.median?.[metric];
      const newValue = after?.operations?.[operation]?.median?.[metric];
      if (Number.isFinite(oldValue) && Number.isFinite(newValue) && oldValue !== 0) {
        comparison[operation][metric] = {
          beforeMs: oldValue,
          afterMs: newValue,
          changePercent: Number((((newValue / oldValue) - 1) * 100).toFixed(1))
        };
      }
    }
  }
  return comparison;
}

(async () => {
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.access(path.join(appRoot, 'index.html'));
  await fs.access(path.join(appRoot, 'bundle.js'));

  const [{ createDocument, createLayer, createImageMaskLayer }] =
    await Promise.all([import(pathToFileURL(path.join(root, 'app', 'engine.mjs')))]);
  const sourceA = makeSource(0);
  const sourceB = makeSource(1);
  const documentFixture = createDocument();
  Object.assign(documentFixture, { name: 'Synthetic layer performance fixture', width, height, transparent: true, seamless: false });
  const patterns = ['dots', 'manga', 'lineart', 'pixel'].map(type => {
    const layer = createLayer(type, 'p-' + type);
    layer.imageSource = 'all';
    return layer;
  });
  const imageA = createImageMaskLayer({
    id: 'image-a', name: 'Synthetic color source A', image: sourceA.image,
    imageWidth: sourceA.imageWidth, imageHeight: sourceA.imageHeight, mode: 'color', colorMap: sourceA.colorMap
  });
  const imageB = createImageMaskLayer({
    id: 'image-b', name: 'Synthetic color source B', image: sourceB.image,
    imageWidth: sourceB.imageWidth, imageHeight: sourceB.imageHeight, mode: 'color', colorMap: sourceB.colorMap
  });
  documentFixture.layers = [patterns[1], patterns[2], patterns[0], patterns[3], imageA, imageB];
  const fixtureBuffer = Buffer.from(JSON.stringify(documentFixture));
  const sourcePng = Buffer.from(sourceA.image.slice('data:image/png;base64,'.length), 'base64');
  const fixtureInfo = {
    canvas: { width, height },
    layerIds: documentFixture.layers.map(layer => layer.id),
    patternImageSource: 'all',
    pasteCommitIncludes: 'synthetic image import, decode, color-map analysis, document mutation, and full canvas render; not clipboard read alone',
    colorSources: [imageA, imageB].map(layer => ({
      id: layer.id, imageWidth: layer.imageWidth, imageHeight: layer.imageHeight,
      colorMapWidth: layer.colorMap.width, colorMapHeight: layer.colorMap.height,
      rgbaBytes: Buffer.from(layer.colorMap.rgba, 'base64').length,
      nonEmpty: /[^A]/.test(layer.colorMap.rgba.replace(/=+$/, ''))
    })),
    clipboard: { mime: 'image/png', width, height, bytes: sourcePng.length },
    projectBytes: fixtureBuffer.length
  };
  assert.equal(fixtureInfo.colorSources.length, 2);
  for (const image of fixtureInfo.colorSources) {
    assert.equal(image.imageWidth, width);
    assert.equal(image.imageHeight, height);
    assert.equal(image.colorMapWidth, width);
    assert.equal(image.colorMapHeight, height);
    assert.equal(image.rgbaBytes, width * height * 4);
    assert.equal(image.nonEmpty, true);
  }

  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
  };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(appRoot, '.' + pathname);
      if (!file.startsWith(appRoot + path.sep)) throw new Error('Outside built app');
      response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  let context;
  let page;
  const pageErrors = [];
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
    await context.addInitScript(() => {
      localStorage.setItem('ctm.preferences', JSON.stringify({ lang: 'zh', theme: 'light', motion: false }));
    });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    const origin = 'http://127.0.0.1:' + server.address().port + '/';
    await page.goto(origin + 'index.html');
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    await page.evaluate(() => {
      window.__layerPerfPending = null;
      const capture = event => {
        const task = window.__layerPerfPending;
        if (!task || task.eventType !== event.type || task.target !== event.target || task.startedAt !== null) return;
        task.startedAt = performance.now();
      };
      const bubble = event => {
        const task = window.__layerPerfPending;
        if (!task || task.eventType !== event.type || task.target !== event.target || task.startedAt === null) return;
        task.syncMs = performance.now() - task.startedAt;
        task.eventSeen = true;
        task.framePromise = new Promise(resolve => {
          requestAnimationFrame(first => {
            task.raf1Ms = performance.now() - task.startedAt;
            requestAnimationFrame(second => {
              task.raf2Ms = performance.now() - task.startedAt;
              resolve();
            });
          });
        });
        task.resolveEvent();
      };
      for (const type of ['click', 'change', 'paste']) {
        document.addEventListener(type, capture, true);
        document.addEventListener(type, bubble, false);
      }
    });

    async function loadFixture() {
      await page.locator('#file-project').setInputFiles({
        name: 'layer-performance.ctm', mimeType: 'application/json', buffer: fixtureBuffer
      });
      if (await page.locator('#unsaved-discard').isVisible().catch(() => false)) {
        await page.locator('#unsaved-discard').click();
      }
      await page.waitForFunction(() =>
        document.documentElement.dataset.appReady === 'true' &&
        document.querySelectorAll('#layer-list .layer').length === 6 &&
        Boolean(document.querySelector('#layer-list .layer[data-layer-id="p-dots"]'))
      );
      assert.equal(await page.locator('#layer-list .layer.selected').getAttribute('data-layer-id'), 'p-manga');
    }
    async function saveDocument() {
      const downloadEvent = page.waitForEvent('download');
      await page.locator('[data-action="save"]').click();
      const download = await downloadEvent;
      return JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    }
    async function measure(selector, eventType = 'click', options = {}) {
      return page.evaluate(async ({ selector, eventType, pasteBase64, waitForPasteCommit }) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error('Missing measured target: ' + selector);
        const task = {
          target, eventType, startedAt: null, syncMs: null, raf1Ms: null, raf2Ms: null,
          commitMs: null, eventSeen: false, resolveEvent: null, framePromise: null
        };
        const eventPromise = new Promise(resolve => { task.resolveEvent = resolve; });
        let commitPromise = Promise.resolve(null);
        let beforeIds = null;
        let observer = null;
        let timer = null;
        if (waitForPasteCommit) {
          beforeIds = new Set([...document.querySelectorAll('#layer-list .layer')].map(row => row.dataset.layerId));
          commitPromise = new Promise((resolve, reject) => {
            const app = document.querySelector('#app');
            const inspect = () => {
              const added = [...document.querySelectorAll('#layer-list .layer[data-layer-type="imageMask"]')]
                .find(row => !beforeIds.has(row.dataset.layerId) && row.classList.contains('selected'));
              if (!added) return;
              observer?.disconnect();
              clearTimeout(timer);
              requestAnimationFrame(frame => {
                task.commitMs = performance.now() - task.startedAt;
                resolve({ layerId: added.dataset.layerId });
              });
            };
            observer = new MutationObserver(inspect);
            observer.observe(app, { childList: true, subtree: true });
            timer = setTimeout(() => {
              observer.disconnect();
              reject(new Error('Synthetic paste did not commit an image layer'));
            }, 30000);
            inspect();
          });
        }
        window.__layerPerfPending = task;
        if (eventType === 'paste') {
          const bytes = Uint8Array.from(atob(pasteBase64), character => character.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], 'synthetic-paste.png', { type: 'image/png' }));
          const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
          target.dispatchEvent(event);
          if (!event.defaultPrevented) throw new Error('Synthetic paste was not accepted');
        } else {
          target.click();
        }
        await eventPromise;
        await task.framePromise;
        let commit = null;
        if (waitForPasteCommit) commit = await commitPromise;
        const result = {
          syncMs: task.syncMs,
          raf1Ms: task.raf1Ms,
          raf2Ms: task.raf2Ms,
          ...(Number.isFinite(task.commitMs) ? { commitMs: task.commitMs } : {}),
          ...(commit ? { layerId: commit.layerId } : {})
        };
        window.__layerPerfPending = null;
        return result;
      }, { selector, eventType, pasteBase64: options.pasteBase64, waitForPasteCommit: options.waitForPasteCommit === true });
    }

    await loadFixture();
    const baselineDocument = await saveDocument();
    assert.equal(baselineDocument.layers.length, 6, 'fixture has six layers');
    for (const id of ['p-dots', 'p-manga', 'p-lineart', 'p-pixel', 'image-a', 'image-b']) {
      assert.ok(baselineDocument.layers.some(layer => layer.id === id), 'fixture retains ' + id);
    }
    for (const layer of baselineDocument.layers.filter(layer => layer.type === 'imageMask')) {
      assert.equal(layer.imageWidth, width);
      assert.equal(layer.imageHeight, height);
      assert.equal(layer.mode, 'color');
      assert.equal(layer.colorMap.width, width);
      assert.equal(layer.colorMap.height, height);
      assert.ok(Buffer.from(layer.colorMap.rgba, 'base64').some(byte => byte !== 0), 'color source is not empty');
    }

    let layerSwitchSurfaceIdentity = null;
    const artBeforeSwitches = await page.locator('#artboard').innerHTML();
    await page.evaluate(() => {
      const firstSvg = document.querySelector('#artboard svg');
      if (!firstSvg) throw new Error('Missing initial artboard SVG node');
      window.__layerPerfInitialNodes = {
        viewport: document.querySelector('#viewport'),
        artboard: document.querySelector('#artboard'),
        firstSvg
      };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
    const layerSwitchRows = [];
    for (let index = 0; index < switchSamples; index++) {
      const id = switchTargets[index % switchTargets.length];
      const row = await measure('#layer-list .layer[data-layer-id="' + id + '"] [data-action="select-layer"]');
      layerSwitchRows.push(row);
    }
    const { profile } = await cdp.send('Profiler.stop');
    await cdp.send('Profiler.disable');
    const switchProfileHotspots = percentileProfile(profile);
    assert.equal(await page.locator('#layer-list .layer.selected').getAttribute('data-layer-id'), switchTargets[(switchSamples - 1) % switchTargets.length]);
    await measure('#layer-list .layer[data-layer-id="p-dots"] [data-action="select-layer"]');
    assert.equal(await page.locator('#artboard').innerHTML(), artBeforeSwitches, 'layer selection preserves canvas content');
    layerSwitchSurfaceIdentity = await page.evaluate(() => ({
      viewport: document.querySelector('#viewport') === window.__layerPerfInitialNodes.viewport,
      artboard: document.querySelector('#artboard') === window.__layerPerfInitialNodes.artboard,
      firstSvg: document.querySelector('#artboard svg') === window.__layerPerfInitialNodes.firstSvg
    }));
    if (label === 'after') assert.deepEqual(layerSwitchSurfaceIdentity, { viewport: true, artboard: true, firstSvg: true }, 'post-build layer selection preserves viewport, artboard, and first SVG nodes');
    assert.equal(await page.locator('html').getAttribute('data-project-dirty'), 'false', 'layer selection does not dirty the document');
    assert.deepEqual(await saveDocument(), baselineDocument, 'layer selection does not alter saved document data');

    const visibilityRows = [];
    for (let index = 0; index < toggleSamples; index++) {
      visibilityRows.push(await measure('#layer-list .layer[data-layer-id="image-a"] [data-action="visibility"]'));
    }
    let visibilityState = await saveDocument();
    assert.equal(visibilityState.layers.find(layer => layer.id === 'image-a').visible, false, 'odd visibility toggle count hides the source');
    assert.notEqual(await page.locator('#artboard').innerHTML(), artBeforeSwitches, 'hiding a color source changes the canvas');
    await measure('#layer-list .layer[data-layer-id="image-a"] [data-action="visibility"]');
    await page.locator('[data-action="undo"]').click();
    visibilityState = await saveDocument();
    assert.equal(visibilityState.layers.find(layer => layer.id === 'image-a').visible, false, 'undo restores the previous visibility');
    await page.locator('[data-action="redo"]').click();
    visibilityState = await saveDocument();
    assert.equal(visibilityState.layers.find(layer => layer.id === 'image-a').visible, true, 'redo restores visibility');
    assert.equal(await page.locator('#artboard').innerHTML(), artBeforeSwitches, 'undo and redo preserve the expected canvas');

    await measure('#layer-list .layer[data-layer-id="p-manga"] [data-action="select-layer"]');
    const artBeforeLineArt = await page.locator('#artboard').innerHTML();
    const lineArtRows = [];
    for (let index = 0; index < toggleSamples; index++) {
      lineArtRows.push(await measure('#inspector input[type="checkbox"][data-target="params"][data-key="lineArt"]', 'change'));
    }
    let lineArtDocument = await saveDocument();
    assert.equal(lineArtDocument.layers.find(layer => layer.id === 'p-manga').params.lineArt, false, 'odd line-art toggle count disables extraction');
    await measure('#inspector input[type="checkbox"][data-target="params"][data-key="lineArt"]', 'change');
    await page.locator('[data-action="undo"]').click();
    lineArtDocument = await saveDocument();
    assert.equal(lineArtDocument.layers.find(layer => layer.id === 'p-manga').params.lineArt, false, 'undo restores the previous line-art setting');
    await page.locator('[data-action="redo"]').click();
    lineArtDocument = await saveDocument();
    assert.equal(lineArtDocument.layers.find(layer => layer.id === 'p-manga').params.lineArt, true, 'redo restores line-art extraction');
    assert.equal(await page.locator('#artboard').innerHTML(), artBeforeLineArt, 'undo and redo restore the rendered line-art canvas');
    assert.deepEqual(lineArtDocument, baselineDocument, 'line-art toggle and undo/redo return to the original document');

    const pasteRows = [];
    let lastPasteDocument = null;
    for (let index = 0; index < pasteSamples; index++) {
      if (index > 0 || await page.locator('html').getAttribute('data-project-dirty') !== 'false') await loadFixture();
      await measure('#layer-list .layer[data-layer-id="p-dots"] [data-action="select-layer"]');
      const pasted = await measure('#viewport', 'paste', {
        pasteBase64: sourcePng.toString('base64'),
        waitForPasteCommit: true
      });
      pasteRows.push(pasted);
      assert.equal(await page.locator('#layer-list .layer').count(), 7, 'paste adds exactly one layer');
      assert.equal(await page.locator('#layer-list .layer.selected').getAttribute('data-layer-type'), 'imageMask');
      lastPasteDocument = await saveDocument();
      const pastedLayer = lastPasteDocument.layers.find(layer => layer.id === pasted.layerId);
      assert.ok(pastedLayer, 'paste layer appears in saved document');
      assert.equal(pastedLayer.imageWidth, width);
      assert.equal(pastedLayer.imageHeight, height);
      assert.equal(pastedLayer.mode, 'color');
      assert.equal(pastedLayer.colorMap.width, width);
      assert.equal(pastedLayer.colorMap.height, height);
      assert.ok(Buffer.from(pastedLayer.colorMap.rgba, 'base64').some(byte => byte !== 0));
      assert.deepEqual(lastPasteDocument.layers.filter(layer => layer.id !== pasted.layerId), baselineDocument.layers, 'paste preserves all original layers');
      if (index === pasteSamples - 1) {
        await page.keyboard.press('Control+z');
        await page.waitForFunction(() => document.querySelectorAll('#layer-list .layer').length === 6);
        await page.keyboard.press('Control+y');
        await page.waitForFunction(() => document.querySelectorAll('#layer-list .layer').length === 7);
        const redone = await saveDocument();
        assert.deepEqual(redone, lastPasteDocument, 'paste undo/redo restores the complete image layer');
      }
    }

    assert.deepEqual(pageErrors, [], 'no browser page errors');
    const operations = {
      layerSwitch: { samples: layerSwitchRows.length, median: stats(layerSwitchRows), rows: layerSwitchRows },
      visibility: { samples: visibilityRows.length, median: stats(visibilityRows), rows: visibilityRows },
      lineArt: { samples: lineArtRows.length, median: stats(lineArtRows), rows: lineArtRows },
      paste: { samples: pasteRows.length, median: stats(pasteRows), rows: pasteRows }
    };
    const bundleBytes = await fs.readFile(path.join(appRoot, 'bundle.js'));
    const report = {
      label,
      capturedAt: new Date().toISOString(),
      build: {
        servedFrom: appRoot,
        bundleSha256: crypto.createHash('sha256').update(bundleBytes).digest('hex'),
        browser: await browser.version(),
        node: process.version,
        headless: true
      },
      fixture: fixtureInfo,
      operations,
      layerSwitchCpuProfileTop: switchProfileHotspots,
      cpuProfileDiagnostic: {
        note: 'Function names belong to this minified build; inspect the matching bundle before interpreting them.'
      },
      layerSwitchSurfaceIdentity,
      regressions: {
        selectionLeavesDocumentUnchanged: true,
        selectionPreservesCanvasMarkup: true,
        layerSwitchPreservesViewportAndArtboardNodes: label === 'after' ? Object.values(layerSwitchSurfaceIdentity).every(Boolean) : null,
        visibilityUndoRedo: true,
        lineArtUndoRedo: true,
        syntheticPastePreservesOriginalLayers: true,
        syntheticPasteUndoRedo: true,
        realClipboardAccessed: false,
        userImagesUsed: false
      }
    };
    const outputPath = path.join(outputRoot, label + '.json');
    if (label === 'after') {
      try {
        const before = JSON.parse(await fs.readFile(path.join(outputRoot, 'before.json'), 'utf8'));
        report.relativeToBefore = relativeComparison(before, report);
      } catch {}
    }
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify({
      label,
      outputPath,
      bundleSha256: report.build.bundleSha256,
      fixture: report.fixture,
      medians: Object.fromEntries(Object.entries(operations).map(([name, value]) => [name, value.median])),
      layerSwitchCpuProfileTop: report.layerSwitchCpuProfileTop.slice(0, 10),
      relativeToBefore: report.relativeToBefore || null,
      regressions: report.regressions
    }, null, 2) + '\n');
  } finally {
    await context?.close();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
