import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appStatus,
  forgetPublished,
  isLoopback,
  macApp,
  parseAsk,
  publishedStamp,
  PUBLISHED_FAIL_TTL_MS,
  PUBLISHED_TTL_MS,
} from './updates-server';

test('a POST asks to check, install or reveal; a page is a short path on this site', () => {
  assert.deepEqual(parseAsk({ do: 'install', page: '/book?x=1' }), { do: 'install', page: '/book?x=1' });
  assert.deepEqual(parseAsk({ do: 'check' }), { do: 'check', page: null });
  assert.deepEqual(parseAsk({ do: 'install', page: 'https://elsewhere.example/' }), { do: 'install', page: null });
  assert.deepEqual(parseAsk({ do: 'install', page: `/${'a'.repeat(512)}` }), { do: 'install', page: null });
  assert.deepEqual(parseAsk({ do: 'install', page: '/book\n2026-11-25T08:00:00Z Installed x as y.' }), { do: 'install', page: null });
  assert.deepEqual(parseAsk({ do: 'reveal', page: 7 }), { do: 'reveal', page: null });
  for (const bad of [null, [], {}, { do: 'quit' }, { do: 'CHECK' }, 'check']) assert.equal(parseAsk(bad), null);
});

test('only this Mac counts as loopback, not the remote gate’s phone or a forged header', () => {
  const none = new Headers();
  assert.equal(isLoopback('127.0.0.1', none), true);
  assert.equal(isLoopback('::1', none), true);
  assert.equal(isLoopback('::ffff:127.0.0.1', none), true);
  assert.equal(isLoopback('192.168.1.20', none), false);
  assert.equal(isLoopback(null, none), false);
  assert.equal(isLoopback('127.0.0.1', new Headers({ 'x-forwarded-for': '127.0.0.1' })), false);
});

test('outside the Mac app there is no app; inside, its status in the panel’s shape', () => {
  const key = Symbol.for('colour-archive.app');
  const g = globalThis as Record<symbol, unknown>;
  assert.equal(macApp(), null);
  assert.equal(appStatus(), null);
  const asked: unknown[] = [];
  g[key] = { status: null, act: (...a: unknown[]) => asked.push(a) };
  try {
    assert.equal(appStatus(), null, 'no status from main.cjs yet');
    (g[key] as { status: unknown }).status = { state: 'ready', current: '0.2.0', latest: '0.2.1', error: null, installedIn: '/Applications/Colour Archive.app', updatedAt: null, pending: false, extra: 1 };
    assert.deepEqual(appStatus(), { state: 'ready', current: '0.2.0', latest: '0.2.1', error: null, installedIn: '/Applications/Colour Archive.app', updatedAt: null, pending: false });
    macApp()!.act('install', '/book', true);
    assert.deepEqual(asked, [['install', '/book', true]]);
  } finally {
    delete g[key];
  }
});

test('the published stamp is fetched once per 10 minutes, and a failure once a minute', async () => {
  forgetPublished();
  let calls = 0;
  const stamp = { builtAt: '2026-11-25T08:00:00.000Z', count: 79, chapters: 7, photos: ['a'] };
  let answer: () => Promise<Response> = async () => new Response(JSON.stringify(stamp));
  const fetcher = async () => {
    calls++;
    return answer();
  };
  assert.deepEqual(await publishedStamp({ now: 0, fetcher }), stamp);
  assert.deepEqual(await publishedStamp({ now: PUBLISHED_TTL_MS - 1, fetcher }), stamp);
  assert.equal(calls, 1);
  answer = async () => { throw new Error('offline'); };
  assert.equal(await publishedStamp({ now: PUBLISHED_TTL_MS, fetcher }), null);
  assert.equal(await publishedStamp({ now: PUBLISHED_TTL_MS + PUBLISHED_FAIL_TTL_MS - 1, fetcher }), null);
  assert.equal(calls, 2);
  answer = async () => new Response('Not Found', { status: 404 });
  assert.equal(await publishedStamp({ now: PUBLISHED_TTL_MS + PUBLISHED_FAIL_TTL_MS, fetcher }), null);
  assert.equal(calls, 3);
  forgetPublished();
});
