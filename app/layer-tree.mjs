/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

const assert = (condition, message) => { if (!condition) throw new TypeError(message); };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);

export function isGroupLayer(layer) {
  return layer?.type === 'group';
}

export function isPatternLayer(layer) {
  return layer !== null && typeof layer === 'object' && !Array.isArray(layer) &&
    layer.type !== 'group' && layer.type !== 'imageMask';
}

export function createGroup(id, name, parentId = null) {
  assert(safeId(id), 'Invalid group id');
  assert(typeof name === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(name), 'Invalid group name');
  const cleanName = name.trim();
  assert(cleanName.length >= 1 && cleanName.length <= 80, 'Invalid group name');
  assert(parentId === null || safeId(parentId), 'Invalid group parent');
  return {
    id,
    type: 'group',
    name: cleanName,
    visible: true,
    collapsed: false,
    ...(parentId === null ? {} : { parentId }),
  };
}

export function parentOf(layer) {
  return typeof layer?.parentId === 'string' ? layer.parentId : null;
}

function layerArray(doc) {
  assert(doc && typeof doc === 'object' && Array.isArray(doc.layers), 'Invalid document layers');
  return doc.layers;
}

function buildForest(layers) {
  const byId = new Map();
  const nodes = [];
  for (const layer of layers) {
    assert(layer && typeof layer === 'object' && !Array.isArray(layer), 'Invalid layer');
    assert(safeId(layer.id) && !byId.has(layer.id), 'Invalid or duplicate layer id');
    const node = { layer, parent: null, children: [] };
    byId.set(layer.id, node);
    nodes.push(node);
  }
  const roots = [];
  for (const node of nodes) {
    const parentId = parentOf(node.layer);
    if (parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(parentId);
    assert(parent, 'Invalid layer parent');
    assert(isGroupLayer(parent.layer), 'Layer parent must be a group');
    node.parent = parent;
    parent.children.push(node);
  }
  for (const node of nodes) {
    const seen = new Set();
    let current = node;
    while (current) {
      assert(!seen.has(current), 'Layer group cycle');
      seen.add(current);
      current = current.parent;
    }
  }
  return { roots, byId, nodes };
}

function writeParent(layer, parentId) {
  if (parentId === null) delete layer.parentId;
  else layer.parentId = parentId;
}

function flattenNodes(nodes, output = []) {
  for (const node of nodes) {
    if (isGroupLayer(node.layer)) flattenNodes(node.children, output);
    writeParent(node.layer, node.parent?.layer.id ?? null);
    output.push(node.layer);
  }
  return output;
}

export function canonicalizeLayers(doc) {
  const layers = layerArray(doc);
  const tree = buildForest(layers);
  doc.layers = flattenNodes(tree.roots);
  return doc.layers;
}

function treeFor(doc) {
  return buildForest(layerArray(doc));
}

export function childrenOf(doc, parentId = null) {
  const { roots, byId } = treeFor(doc);
  if (parentId === null || parentId === undefined) return roots.map(node => node.layer);
  const parent = byId.get(parentId);
  if (!parent || !isGroupLayer(parent.layer)) return [];
  return parent.children.map(node => node.layer);
}

export function descendantsOf(doc, id) {
  const { byId } = treeFor(doc);
  const root = byId.get(id);
  if (!root || !isGroupLayer(root.layer)) return [];
  const output = [];
  const visit = node => {
    for (const child of node.children) {
      if (isGroupLayer(child.layer)) visit(child);
      output.push(child.layer);
    }
  };
  visit(root);
  return output;
}

export function isLayerVisible(doc, layer) {
  const { byId } = treeFor(doc);
  const candidate = typeof layer === 'string' ? byId.get(layer) : byId.get(layer?.id);
  if (!candidate) return false;
  if (candidate.layer.visible === false) return false;
  let parent = candidate.parent;
  while (parent) {
    if (!isGroupLayer(parent.layer) || parent.layer.visible === false) return false;
    parent = parent.parent;
  }
  return true;
}

export function visibleLayerRows(doc) {
  const { roots } = treeFor(doc);
  const rows = [];
  const append = (siblings, depth) => {
    for (let index = siblings.length - 1; index >= 0; index--) {
      const node = siblings[index];
      rows.push({ layer: node.layer, depth });
      if (isGroupLayer(node.layer) && !node.layer.collapsed) append(node.children, depth + 1);
    }
  };
  append(roots, 0);
  return rows;
}

export function clippingBase(doc, layer) {
  const { roots, byId } = treeFor(doc);
  const node = typeof layer === 'string' ? byId.get(layer) : byId.get(layer?.id);
  if (!node) return null;
  const siblings = node.parent ? node.parent.children : roots;
  const index = siblings.indexOf(node);
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = siblings[cursor].layer;
    if (candidate?.type === 'imageMask' || isGroupLayer(candidate)) return candidate;
  }
  return null;
}

function nodeIsAncestor(ancestor, node) {
  let current = node?.parent ?? null;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function selectedRoots(tree, ids) {
  assert(Array.isArray(ids) && ids.length > 0, 'Select at least one layer');
  const selected = new Set();
  for (const id of ids) {
    const node = tree.byId.get(id);
    assert(node, 'Layer was not found');
    selected.add(node);
  }
  return tree.nodes
    .filter(node => selected.has(node) && !hasSelectedAncestor(node, selected))
    .sort((a, b) => tree.nodes.indexOf(a) - tree.nodes.indexOf(b));
}

function hasSelectedAncestor(node, selected) {
  let parent = node.parent;
  while (parent) {
    if (selected.has(parent)) return true;
    parent = parent.parent;
  }
  return false;
}

function parentPath(parent) {
  const path = [];
  for (let current = parent; current; current = current.parent) path.push(current);
  return path;
}

function commonContainer(nodes) {
  const paths = nodes.map(node => parentPath(node.parent));
  for (const candidate of paths[0]) {
    if (paths.every(path => path.includes(candidate))) return candidate;
  }
  return null;
}

function branchUnder(node, parent) {
  let current = node;
  while (current.parent !== parent) {
    assert(current.parent, 'Could not find common layer container');
    current = current.parent;
  }
  return current;
}

function siblingsFor(parent, roots) {
  return parent ? parent.children : roots;
}

function recanonicalize(doc, roots) {
  doc.layers = flattenNodes(roots);
  return doc.layers;
}

export function groupLayers(doc, ids, { id, name } = {}) {
  const tree = treeFor(doc);
  assert(tree.nodes.length < 32, 'Document layer limit reached');
  assert(tree.nodes.filter(node => isGroupLayer(node.layer)).length < 16, 'Document cannot contain more than 16 groups');
  assert(safeId(id) && !tree.byId.has(id), 'Invalid or duplicate group id');
  const selected = selectedRoots(tree, ids);
  const container = commonContainer(selected);
  const siblings = siblingsFor(container, tree.roots);
  const branches = selected.map(node => branchUnder(node, container));
  const firstBranchIndex = Math.max(...branches.map(branch => siblings.indexOf(branch)));
  assert(Number.isInteger(firstBranchIndex) && firstBranchIndex >= 0, 'Invalid group placement');

  const group = createGroup(id, name, container?.layer.id ?? null);
  const groupNode = { layer: group, parent: container, children: selected };
  const originalPositions = selected.map(node => {
    const siblings = siblingsFor(node.parent, tree.roots);
    return { node, siblings, index: siblings.indexOf(node) };
  });
  const removedBefore = originalPositions.filter(position => position.siblings === siblings && position.index < firstBranchIndex).length;
  for (const { node, siblings: oldSiblings } of originalPositions) {
    oldSiblings.splice(oldSiblings.indexOf(node), 1);
  }
  for (const node of selected) node.parent = groupNode;
  groupNode.children = selected;
  siblings.splice(firstBranchIndex - removedBefore, 0, groupNode);
  recanonicalize(doc, tree.roots);
  return group;
}

export function moveLayers(doc, ids, { targetId = null, position } = {}) {
  const tree = treeFor(doc);
  const selected = selectedRoots(tree, ids);
  assert(['before', 'after', 'inside', 'root'].includes(position), 'Invalid layer move position');
  let target = null;
  let destination = null;
  if (position === 'root') {
    assert(targetId === null || targetId === undefined, 'Root move cannot have a target');
  } else {
    target = tree.byId.get(targetId);
    assert(target, 'Move target was not found');
    if (selected.includes(target)) return false;
    if (selected.some(node => nodeIsAncestor(node, target))) {
      throw new TypeError('Cannot move a layer relative to its own descendant');
    }
    if (position === 'inside') {
      assert(isGroupLayer(target.layer), 'Inside target must be a group');
      destination = target;
    } else {
      destination = target.parent;
    }
  }
  if (destination && selected.some(node => node === destination || nodeIsAncestor(node, destination))) {
    throw new TypeError('Cannot move a group into itself or its descendant');
  }
  const destinationSiblings = siblingsFor(destination, tree.roots);
  const originalOrder = destinationSiblings.map(node => node.layer.id);
  const moving = new Set(selected);
  const nextSiblings = destinationSiblings.filter(node => !moving.has(node));
  let insertionIndex = nextSiblings.length;
  if (position === 'before' || position === 'after') {
    const targetIndex = nextSiblings.indexOf(target);
    assert(targetIndex >= 0, 'Move target was not found');
    insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  }
  nextSiblings.splice(insertionIndex, 0, ...selected);
  const alreadyInContainer = selected.every(node => node.parent === destination);
  if (alreadyInContainer && nextSiblings.map(node => node.layer.id).join('\0') === originalOrder.join('\0')) return false;

  for (const node of selected) {
    const oldSiblings = siblingsFor(node.parent, tree.roots);
    const index = oldSiblings.indexOf(node);
    oldSiblings.splice(index, 1);
    node.parent = destination;
  }
  for (const node of selected) writeParent(node.layer, destination?.layer.id ?? null);
  destinationSiblings.splice(0, destinationSiblings.length, ...nextSiblings);
  recanonicalize(doc, tree.roots);
  return true;
}

export function ungroupLayers(doc, ids) {
  const tree = treeFor(doc);
  assert(Array.isArray(ids) && ids.length > 0, 'Select at least one group');
  const groups = [...new Set(ids)].map(id => {
    const node = tree.byId.get(id);
    assert(node && isGroupLayer(node.layer), 'Ungroup target must be a group');
    return node;
  }).sort((a, b) => parentPath(b).length - parentPath(a).length);
  for (const node of groups) {
    const parent = node.parent;
    const siblings = siblingsFor(parent, tree.roots);
    const index = siblings.indexOf(node);
    const children = [...node.children];
    for (const child of children) child.parent = parent;
    siblings.splice(index, 1, ...children);
    node.children = [];
  }
  recanonicalize(doc, tree.roots);
  return groups.map(node => node.layer);
}