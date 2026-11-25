import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkToken, fileIssue, GitHubError, toBase64 } from './feedback-github';
import { issueImages, parseIssueBody } from './feedback';

const T = { token: 'github_pat_test', repo: 'o/fb' };
const CTX = { page: '/scout', device: 'iPhone app', viewport: '393×852 @3x', build: '0.2.13 x' };

function fakeGitHub(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null, auth: h.get('authorization') });
    return answer(url, init);
  };
  return { calls, fetchFn };
}

test('base64 matches Buffer, also past one chunk', () => {
  const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('commits each picture, then files the issue that shows them', async () => {
  const { calls, fetchFn } = fakeGitHub((url) =>
    url.endsWith('/issues')
      ? new Response(JSON.stringify({ number: 5, html_url: 'https://github.com/o/fb/issues/5' }), { status: 201 })
      : new Response('{}', { status: 201 }),
  );
  const out = await fileIssue(T, {
    id: '2026-11-25-1432-a10b', note: 'Ring too small', created: '2026-11-25T14:32:00Z', context: CTX,
    images: [{ ext: 'jpg', bytes: new Uint8Array([1, 2, 3]) }, { ext: 'png', bytes: new Uint8Array([4]) }],
  }, fetchFn);
  assert.deepEqual(out, { number: 5, url: 'https://github.com/o/fb/issues/5' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'PUT https://api.github.com/repos/o/fb/contents/shots/2026-11-25-1432-a10b-1.jpg',
    'PUT https://api.github.com/repos/o/fb/contents/shots/2026-11-25-1432-a10b-2.png',
    'POST https://api.github.com/repos/o/fb/issues',
  ]);
  assert.ok(calls.every((c) => c.auth === 'Bearer github_pat_test'));
  assert.equal(calls[0].body?.content, Buffer.from([1, 2, 3]).toString('base64'));
  const issue = calls[2].body!;
  assert.equal(issue.title, 'Ring too small');
  assert.deepEqual(issueImages(String(issue.body)), ['2026-11-25-1432-a10b-1.jpg', '2026-11-25-1432-a10b-2.png']);
  assert.equal(parseIssueBody(String(issue.body)).context.device, 'iPhone app');
});

test('a refused token says so, and asks for a new one; other failures don’t', async () => {
  for (const [status, badToken, message] of [
    [401, true, 'GitHub didn’t accept the token'],
    [404, true, 'The token can’t reach the feedback repo'],
    [403, true, 'The token can’t reach the feedback repo'],
    [502, false, 'GitHub answered 502'],
  ] as const) {
    const { fetchFn } = fakeGitHub(() => new Response('{}', { status }));
    await assert.rejects(checkToken(T, fetchFn), (e: unknown) => e instanceof GitHubError && e.badToken === badToken && e.message === message);
  }
  // A rate limit is a 403 too, but the token is fine: keep it.
  const limited = fakeGitHub(() => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
  await assert.rejects(checkToken(T, limited.fetchFn), (e: unknown) => e instanceof GitHubError && !e.badToken && e.message === 'GitHub asked to wait a minute');
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(checkToken(T, offline), (e: unknown) => e instanceof GitHubError && e.message === 'No connection to GitHub' && !e.badToken);
});

test('a picture that fails stops before the issue is filed', async () => {
  const { calls, fetchFn } = fakeGitHub((url) => new Response('{}', { status: url.includes('/contents/') ? 422 : 201 }));
  await assert.rejects(
    fileIssue(T, { id: '2026-11-25-1432-a10b', note: 'x', created: 'c', context: CTX, images: [{ ext: 'jpg', bytes: new Uint8Array([1]) }] }, fetchFn),
    /GitHub refused the picture/,
  );
  assert.equal(calls.filter((c) => c.url.endsWith('/issues')).length, 0);
});
