import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A private data root, so the connection file never lands in the repo.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-'));
process.env.COLOUR_ARCHIVE_DATA = root;
const ig = await import('./instagram-api');

test('instagramWork: images and every image of a carousel, never videos', () => {
  const items = ig.instagramWork([
    { id: '1', media_type: 'IMAGE', media_url: 'https://cdn/1.jpg', permalink: 'https://www.instagram.com/p/1/', timestamp: '2026-10-01T00:00:00+0000', caption: 'harbour' },
    { id: '2', media_type: 'VIDEO', media_url: 'https://cdn/2.mp4' },
    { id: '3', media_type: 'CAROUSEL_ALBUM', permalink: 'https://www.instagram.com/p/3/', children: { data: [
      { id: 'a', media_type: 'IMAGE', media_url: 'https://cdn/3a.jpg' }, { id: 'b', media_type: 'VIDEO', media_url: 'https://cdn/3b.mp4' }, { id: 'c', media_type: 'IMAGE', media_url: 'https://cdn/3c.jpg' },
    ] } },
    { id: '4', media_type: 'IMAGE' },
  ]);
  assert.deepEqual(items.map((i) => [i.key, i.full]), [['ig:1#0', 'https://cdn/1.jpg'], ['ig:3#0', 'https://cdn/3a.jpg'], ['ig:3#1', 'https://cdn/3c.jpg']]);
  assert.equal(items[0].title, 'harbour');
});

test('connect, discover, renew and the personal-account answer, against a stand-in Graph API', async () => {
  const calls: string[] = [];
  let expiresIn = 5_184_000;
  const fake = mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const u = String(input);
    calls.push(u);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes('/oauth/access_token')) return ok({ access_token: `long-${calls.length}`, expires_in: expiresIn });
    if (u.includes('/me/accounts')) return ok({ data: [{ name: 'Page' }, { name: 'Mine', instagram_business_account: { id: '178', username: 'me.photo' } }] });
    if (u.includes('business_discovery.username(adrisangui)')) {
      return ok({ business_discovery: { name: 'Adrien', media: { data: [{ id: '9', media_type: 'IMAGE', media_url: 'https://cdn/9.jpg', permalink: 'p9' }] } } });
    }
    return new Response(JSON.stringify({ error: { message: 'Invalid user id', code: 110 } }), { status: 400 });
  });
  try {
    const c = await ig.connectInstagram(' 123 ', 'secret', 'short');
    assert.equal(c.igUserId, '178');
    assert.equal(c.username, 'me.photo');
    assert.ok(calls[0].includes('fb_exchange_token=short') && calls[0].includes('client_id=123'));
    const raw = JSON.parse(await fs.readFile(path.join(root, '.archive', 'instagram.json'), 'utf8'));
    assert.equal(raw.token, c.token);

    const r = await ig.instagramDiscover('@AdriSangui');
    assert.equal(r.name, 'Adrien');
    assert.deepEqual(r.items.map((i) => i.full), ['https://cdn/9.jpg']);

    await assert.rejects(ig.instagramDiscover('a_friend'), /personal account/);
    await assert.rejects(ig.instagramDiscover('not a name!'), /not an Instagram username/);

    // Within ten days of running out, the token is swapped for a new one first.
    expiresIn = 86_400;
    await ig.connectInstagram('123', 'secret', 'short');
    const before = calls.length;
    await ig.instagramDiscover('adrisangui');
    assert.ok(calls.slice(before).some((u) => u.includes('/oauth/access_token')), 'renewed');
  } finally {
    fake.mock.restore();
    await fs.rm(root, { recursive: true, force: true });
  }
});
