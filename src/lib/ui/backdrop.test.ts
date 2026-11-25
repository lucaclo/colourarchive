import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outsideBox } from './backdrop';

const box = { left: 100, top: 50, right: 400, bottom: 300 };

test('a press on the sheet, or on its edge, is not the backdrop', () => {
  assert.equal(outsideBox(250, 150, box), false);
  assert.equal(outsideBox(100, 50, box), false);
  assert.equal(outsideBox(400, 300, box), false);
});

test('a press past any side is the backdrop', () => {
  assert.equal(outsideBox(99, 150, box), true);
  assert.equal(outsideBox(401, 150, box), true);
  assert.equal(outsideBox(250, 49, box), true);
  assert.equal(outsideBox(250, 301, box), true);
});
