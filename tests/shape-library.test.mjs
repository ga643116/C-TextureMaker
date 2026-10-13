import test from 'node:test';
import assert from 'node:assert/strict';
import { addShape, MAX_LIBRARY_BYTES, MAX_SHAPES, normalizeShapeLibrary, removeShape, renameShape } from '../app/shape-library.mjs';

const svgData = value => `data:image/svg+xml;base64,${Buffer.from(value).toString('base64')}`;
const shape = (id, data = svgData(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M${id.length} 0 L1 1"/></svg>`), name = id) => ({ id, name, data });

test('shape library validates its schema and keeps the first copy of duplicate image data', () => {
  const shared = shape('first').data;
  const input = [shape('first', shared, 'First'), shape('second', shared, 'Second')];
  const library = normalizeShapeLibrary(input);

  assert.deepEqual(library, [input[0]]);
  assert.notEqual(library, input);
  assert.throws(() => normalizeShapeLibrary(null), /Invalid shape library/);
  assert.throws(() => normalizeShapeLibrary([shape('bad id')]), /Invalid shape id/);
  assert.throws(() => normalizeShapeLibrary([shape('valid', shared, `Bad\nname`)]), /Invalid shape name/);
  assert.throws(() => normalizeShapeLibrary([{ ...shape('missing-data'), data: 'data:image/png;base64,@@==' }]), /Invalid shape/);
});

test('adding duplicate data reuses the existing shape without mutating the input', () => {
  const first = shape('first');
  const original = [first];
  const result = addShape(original, shape('second', first.data, 'A duplicate'));

  assert.deepEqual(result.library, [first]);
  assert.equal(result.shape.id, 'first');
  assert.deepEqual(original, [first]);
  assert.notEqual(result.library, original);
});

test('renaming a shared shape preserves its identity, artwork and other library records', () => {
  const library = [shape('first'), shape('second')];
  const renamed = renameShape(library, 'first', '  我的形狀 / My shape / マイ形状  ');
  assert.equal(renamed[0].name, '我的形狀 / My shape / マイ形状');
  assert.equal(renamed[0].id, library[0].id);
  assert.equal(renamed[0].data, library[0].data);
  assert.deepEqual(renamed[1], library[1]);
  assert.equal(library[0].name, 'first');
  for (const name of ['', '   ', 'a'.repeat(81), 'Bad\nname']) {
    assert.throws(() => renameShape(library, 'first', name), /Invalid shape name/);
  }
  assert.throws(() => renameShape(library, 'missing', 'Name'), /Shape not found/);
});

test('shape count capacity fails explicitly and preserves every existing shape', () => {
  const full = Array.from({ length: MAX_SHAPES }, (_, index) => shape(`shape-${index}`, svgData(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="M${index} 0 L1 1"/></svg>`
  )));
  const snapshot = structuredClone(full);

  assert.throws(() => addShape(full, shape('next', svgData('<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>'))), error => error.message === 'ShapeLibraryFull');
  assert.deepEqual(full, snapshot);
});

test('serialized library size capacity fails explicitly without dropping existing shapes', () => {
  const sharedPrefix = 'A'.repeat(4_194_296);
  const endings = ['AAAA', 'AAAB', 'AAAC', 'AAAD', 'AAAE', 'AAAF', 'AAAG', 'AAAH'];
  const oversized = endings.map((ending, index) => ({
    id: `large-${index}`,
    name: `Large ${index}`,
    data: `data:image/png;base64,${sharedPrefix}${ending}`
  }));

  assert.ok(MAX_LIBRARY_BYTES < oversized.reduce((total, item) => total + item.data.length, 0));
  assert.throws(() => normalizeShapeLibrary(oversized), /Shape library is too large/);
  const existing = normalizeShapeLibrary(oversized.slice(0, 7));
  assert.throws(() => addShape(existing, oversized[7]), error => error.message === 'ShapeLibraryFull');
  assert.equal(existing.length, 7);
  assert.equal(oversized.length, 8);
});

test('a single image cannot exceed the decoded four MiB file limit', () => {
  const tooLarge = `data:image/png;base64,${'A'.repeat(5_592_408)}`;
  assert.throws(() => normalizeShapeLibrary([shape('too-large', tooLarge)]), /Shape image is too large/);
});

test('removing a shape returns a new library and leaves embedded layer data intact', () => {
  const image = shape('shared');
  const library = [image, shape('other')];
  const layer = { customMotif: image.data };
  const reduced = removeShape(library, 'shared');

  assert.deepEqual(reduced, [library[1]]);
  assert.notEqual(reduced, library);
  assert.equal(library.length, 2);
  assert.equal(layer.customMotif, image.data);
});

test('unsafe SVG data is rejected by the same validator used for library records', () => {
  const unsafe = [
    shape('script', svgData('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
    shape('event', svgData('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')),
    shape('external', svgData('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.test/x.svg#id"/></svg>')),
    shape('external-style', svgData('<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://example.test/fill.svg#id)"/></svg>'))
  ];
  for (const item of unsafe) assert.throws(() => normalizeShapeLibrary([item]), /Unsafe SVG/);
});
