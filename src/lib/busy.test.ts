import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyCount, whileBusy } from './busy';

// #168: desktop/server.mjs reads this counter off globalThis.
test('a job counts as busy while it runs, and after a throw it doesn’t', async () => {
  let release!: () => void;
  const job = whileBusy(() => new Promise<void>((r) => { release = r; }));
  assert.equal(busyCount(), 1);
  assert.equal((globalThis as Record<symbol, { n: number }>)[Symbol.for('colour-archive.busy')].n, 1, 'where server.mjs looks');
  release();
  await job;
  assert.equal(busyCount(), 0);
  await assert.rejects(whileBusy(async () => { throw new Error('scan failed'); }));
  assert.equal(busyCount(), 0);
});
