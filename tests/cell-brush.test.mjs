/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {strokeHits,nearestCell} from '../app/cell-brush.mjs';

test('brush diameter covers nearby cells without requiring a glyph hit',()=>{
  const cells=[{id:'0:0',x:10,y:10},{id:'0:1',x:30,y:10},{id:'1:0',x:10,y:40}];
  assert.deepEqual(strokeHits(cells,{x:20,y:10},{x:20,y:10},11),['0:0','0:1']);
  assert.deepEqual(strokeHits(cells,{x:20,y:10},{x:20,y:10},4),[]);
});

test('fast diagonal strokes include intermediate cells and round end caps',()=>{
  const cells=[{id:'0:0',x:5,y:5},{id:'1:1',x:50,y:50},{id:'2:2',x:104,y:100},{id:'2:3',x:104,y:106},{id:'1:2',x:70,y:50}];
  assert.deepEqual(strokeHits(cells,{x:0,y:0},{x:100,y:100},5),['0:0','1:1','2:2']);
});

test('periodic copies are edited only once and nearby clicks snap to one cell',()=>{
  const cells=[{id:'0:0',x:0,y:0},{id:'0:0',x:100,y:0},{id:'0:1',x:30,y:0}];
  assert.deepEqual(strokeHits(cells,{x:0,y:0},{x:100,y:0},1),['0:0','0:1']);
  assert.equal(nearestCell(cells,{x:25,y:4},8),'0:1');
  assert.equal(nearestCell(cells,{x:50,y:40},8),null);
});
