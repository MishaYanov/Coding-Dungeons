import assert from 'node:assert/strict';
import test from 'node:test';
import { diamondPosition } from '../src/renderer/diamond-placement.mjs';

test('a hidden diamond finds free page space when all nearby positions cover a book link', () => {
  const roll = { x: 50, y: 50 };
  const link = { x: 32, y: 32, w: 36, h: 36 };
  const position = diamondPosition(roll, [link]);
  assert.ok(position.x >= 8 && position.x <= 92 && position.y >= 8 && position.y <= 92);
  assert.ok(position.x + 8 < link.x || position.x - 8 > link.x + link.w
    || position.y + 6 < link.y || position.y - 6 > link.y + link.h);
  assert.deepEqual(diamondPosition(roll, [{ x: 'invalid' }]), roll);
});
