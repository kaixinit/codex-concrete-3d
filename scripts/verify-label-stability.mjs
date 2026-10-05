import assert from 'node:assert/strict';
import {layoutLabels} from '../src/labelLayout.js';

// Run with: node scripts/verify-label-stability.mjs
// Tests the moving-label contract independently of React, DOM and WebGL.
let checks = 0, retainedSamples = 0, collisionSamples = 0;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${message}: ${actual} vs ${expected}`);
const check = (name, test) => {test(); checks++; console.log('PASS ' + name);};
const overlaps = (a, b) => a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x &&
  a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y;
function assertLegal(placements, width, height, reservedRects = []) {
  for (const [index, placement] of placements.entries()) {
    assert.ok([placement.x, placement.y, placement.anchorX, placement.anchorY,
      placement.offsetX, placement.offsetY].every(Number.isFinite), 'finite screen placement');
    assert.ok(placement.x >= 8 && placement.y >= 8, 'top and left margins');
    assert.ok(placement.x + placement.width <= width - 8, 'right margin');
    assert.ok(placement.y + placement.height <= height - 8, 'bottom margin');
    for (const other of [...placements.slice(0, index), ...reservedRects]) {
      assert.equal(overlaps(placement, other), false, 'label avoids labels and reserved UI');
    }
    near(placement.x, placement.anchorX + placement.offsetX, 'X offset follows anchor');
    near(placement.y, placement.anchorY + placement.offsetY, 'Y offset follows anchor');
    if (placement.leader) {
      assert.deepEqual(placement.leader.from, [placement.anchorX, placement.anchorY]);
      const [x, y] = placement.leader.to;
      assert.ok(x >= placement.x && x <= placement.x + placement.width, 'leader terminates on label');
      assert.ok(y >= placement.y && y <= placement.y + placement.height, 'leader terminates on label');
    }
    collisionSamples++;
  }
}
const truck = (x = 200, y = 150, extra = {}) => ({id:'truck-mc012', x, y, text:'MC012',
  width:70, height:24, selected:true, ...extra});
const fixedUI = {x:150, y:105, width:100, height:30};

check('old calls retain the same initial positions and priority', () => {
  const items = [truck(), {id:'fault', x:410, y:70, text:'B01', width:60, height:24, fault:true}];
  const oldCall = layoutLabels(items, 500, 300, {reservedRects:[fixedUI]});
  const emptyHistory = layoutLabels(items, 500, 300, {reservedRects:[fixedUI], previousPlacements:[]});
  assert.deepEqual(oldCall, emptyHistory);
  assert.equal(oldCall[0].id, 'fault');
  const label = oldCall.find(item => item.id === 'truck-mc012');
  assert.deepEqual([label.x, label.y], [165, 144]);
  assertLegal(oldCall, 500, 300, [fixedUI]);
});

check('a label keeps its legal side when the preferred side becomes available', () => {
  let previousPlacements = layoutLabels([truck()], 500, 300, {reservedRects:[fixedUI]});
  const initial = previousPlacements[0];
  for (let index = 1; index <= 500; index++) {
    const item = truck(200 + index * .32, 150 + Math.sin(index * .05));
    const next = layoutLabels([item], 500, 300, {reservedRects:[fixedUI], previousPlacements});
    assert.equal(next.length, 1);
    near(next[0].offsetX, initial.offsetX, 'horizontal offset remains stable');
    near(next[0].offsetY, initial.offsetY, 'vertical offset remains stable');
    assertLegal(next, 500, 300, [fixedUI]);
    previousPlacements = next; retainedSamples++;
  }
  const greedy = layoutLabels([truck(360, 150)], 500, 300, {reservedRects:[fixedUI]})[0];
  assert.equal(greedy.y, 116, 'the original greedy layout would move above the truck');
  assert.ok(Math.abs(greedy.offsetY - previousPlacements[0].offsetY) > 20,
    'fixture exercises a real candidate-side change');
});

check('subpixel movement follows the anchor without a periodic rounding jump', () => {
  let previousPlacements = layoutLabels([truck(200.125, 149.375)], 500, 300, {reservedRects:[fixedUI]});
  const initial = previousPlacements[0];
  for (let index = 1; index <= 1000; index++) {
    const x = 200.125 + index * .0973, y = 149.375 + Math.sin(index * .01) * .5;
    const next = layoutLabels([truck(x, y)], 500, 300, {reservedRects:[fixedUI], previousPlacements});
    near(next[0].x - previousPlacements[0].x, x - previousPlacements[0].anchorX, 'exact X motion');
    near(next[0].y - previousPlacements[0].y, y - previousPlacements[0].anchorY, 'exact Y motion');
    near(next[0].offsetX, initial.offsetX, 'no accumulated X quantization');
    near(next[0].offsetY, initial.offsetY, 'no accumulated Y quantization');
    previousPlacements = next; retainedSamples++;
  }
});

check('a new reserved area forces avoidance; removing it does not cause a return jump', () => {
  const initial = layoutLabels([truck()], 500, 300, {reservedRects:[fixedUI]});
  const blockingUI = {x:260, y:140, width:80, height:35};
  const avoided = layoutLabels([truck(300)], 500, 300, {reservedRects:[blockingUI], previousPlacements:initial});
  assert.equal(avoided.length, 1);
  assert.notEqual(avoided[0].offsetY, initial[0].offsetY, 'invalid old position is changed');
  assertLegal(avoided, 500, 300, [blockingUI]);
  const released = layoutLabels([truck(301)], 500, 300, {previousPlacements:avoided});
  near(released[0].offsetX, avoided[0].offsetX, 'retain new legal X after UI disappears');
  near(released[0].offsetY, avoided[0].offsetY, 'retain new legal Y after UI disappears');
  assertLegal(released, 500, 300);
});

check('viewport edges and a smaller viewport invalidate stale positions', () => {
  const initial = layoutLabels([truck(400, 220)], 500, 300);
  const edge = layoutLabels([truck(490, 220)], 500, 300, {previousPlacements:initial});
  assert.notEqual(edge[0].offsetX, initial[0].offsetX);
  assertLegal(edge, 500, 300);
  const away = layoutLabels([truck(440, 220)], 500, 300, {previousPlacements:edge});
  near(away[0].offsetX, edge[0].offsetX, 'keep valid edge-adjusted offset');
  const resized = layoutLabels([truck(260, 150)], 300, 200, {previousPlacements:initial});
  assert.notEqual(resized[0].offsetX, initial[0].offsetX);
  assertLegal(resized, 300, 200);
  assert.deepEqual(layoutLabels([truck(510)], 500, 300, {previousPlacements:initial}), [],
    'offscreen anchors remain hidden');
});

check('changed label dimensions are revalidated before retaining a position', () => {
  const initial = layoutLabels([truck(430)], 500, 300);
  const enlarged = layoutLabels([truck(430, 150, {width:160, text:'MC012 · 装车完成'})], 500, 300,
    {previousPlacements:initial});
  assert.notEqual(enlarged[0].offsetX, initial[0].offsetX, 'wider label no longer fits its previous position');
  assertLegal(enlarged, 500, 300);
  const centered = layoutLabels([truck()], 500, 300);
  const fits = layoutLabels([truck(201, 150, {width:100, text:'MC012 · 返站'})], 500, 300,
    {previousPlacements:centered});
  near(fits[0].offsetX, centered[0].offsetX, 'valid resized label does not change side');
  assertLegal(fits, 500, 300);
});

check('fault and selected labels can take precedence over a remembered lower-priority position', () => {
  const area = {id:'station', x:200, y:150, text:'搅拌站', width:80, height:24, priority:1};
  const previousPlacements = layoutLabels([area], 500, 300);
  for (const highPriority of [{...truck(), selected:true}, {...truck(), selected:false, fault:true}]) {
    const next = layoutLabels([area, highPriority], 500, 300, {maxLabels:2, previousPlacements});
    assert.equal(next.length, 2);
    assert.equal(next[0].id, 'truck-mc012');
    assert.notEqual(next[1].offsetY, previousPlacements[0].offsetY, 'lower-priority label must avoid the truck');
    assertLegal(next, 500, 300);
    const limited = layoutLabels([area, highPriority], 500, 300, {maxLabels:1, previousPlacements});
    assert.equal(limited[0].id, 'truck-mc012', 'history does not override visibility priority');
  }
});

check('history is matched by ID rather than position in the input list', () => {
  const first = truck(200, 150, {selected:false});
  const second = {id:'loader', x:380, y:230, text:'L01', width:60, height:24};
  const previousPlacements = layoutLabels([first, second], 500, 300, {reservedRects:[fixedUI]});
  const next = layoutLabels([{...second, x:381}, {...first, x:201}], 500, 300,
    {reservedRects:[fixedUI], previousPlacements});
  for (const placement of next) {
    const previous = previousPlacements.find(item => item.id === placement.id);
    near(placement.offsetX, previous.offsetX, 'ID-specific X offset');
    near(placement.offsetY, previous.offsetY, 'ID-specific Y offset');
  }
  assertLegal(next, 500, 300, [fixedUI]);
});

check('legacy placements are accepted and invalid history cannot inject an unsafe position', () => {
  const current = layoutLabels([truck()], 500, 300, {reservedRects:[fixedUI]});
  const legacy = current.map(({offsetX, offsetY, ...placement}) => placement);
  const fromLegacy = layoutLabels([truck(300)], 500, 300, {previousPlacements:legacy});
  near(fromLegacy[0].offsetY, current[0].offsetY, 'offset is recovered from old x/y and anchor');
  const malformed = layoutLabels([truck()], 500, 300, {reservedRects:[fixedUI],
    previousPlacements:[null, {id:'truck-mc012', x:NaN, y:Infinity, anchorX:200, anchorY:150}]});
  assert.deepEqual(malformed, current);
  const noSpace = layoutLabels([truck(40, 30)], 80, 60,
    {reservedRects:[{x:0, y:0, width:80, height:60}], previousPlacements:current});
  assert.deepEqual(noSpace, [], 'invalid remembered positions cannot bypass collisions');
});

check('a crowded continuous route remains inside the viewport and collision-free', () => {
  const reservedRects = [{x:0, y:0, width:170, height:80}, {x:350, y:250, width:150, height:50}];
  let previousPlacements = [];
  for (let index = 0; index <= 720; index++) {
    const t = index / 720;
    const items = [truck(35 + 430 * t, 130 + 65 * Math.sin(t * Math.PI * 2)),
      {id:'loader', x:260, y:140, text:'L01', width:64, height:24, active:true},
      {id:'plant', x:220, y:205, text:'搅拌主楼', width:92, height:24, priority:2},
      {id:'silo', x:340, y:110, text:'C01 水泥', width:88, height:24, priority:1}];
    const snapshot = structuredClone(previousPlacements);
    const next = layoutLabels(items, 500, 300, {maxLabels:4, reservedRects, previousPlacements});
    assert.deepEqual(previousPlacements, snapshot, 'layout never mutates caller history');
    assert.equal(next[0].id, 'truck-mc012', 'moving selected vehicle remains first');
    assertLegal(next, 500, 300, reservedRects);
    previousPlacements = next;
  }
});

console.log(`Label stability: ${checks} checks, ${retainedSamples} stable movement samples, ${collisionSamples} legal placements.`);
