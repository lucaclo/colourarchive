import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanContext,
  cleanNote,
  fitWithin,
  issueBody,
  issueImages,
  issueTitle,
  MAX_NOTE,
  newFeedbackId,
  newTokenUrl,
  noteMarkdown,
  pageLabel,
  parseIssueBody,
  parseNoteMarkdown,
  sniffImage,
  validFeedbackId,
  viewportLabel,
  type FeedbackEntry,
} from './feedback';

const CTX = { page: '/scout?at=51.5,-0.08', device: 'iPhone app', viewport: '393×852 @3x', build: '0.2.13 2026-11-25T08:40:00.000Z' };

test('ids sort by time, carry four hex characters, and are recognised', () => {
  const id = newFeedbackId(new Date(2026, 10, 25, 14, 32), new Uint8Array([0xa1, 0x0b]));
  assert.equal(id, '2026-11-25-1432-a10b');
  assert.ok(validFeedbackId(id));
  assert.ok(validFeedbackId('gh-12'));
  for (const bad of ['../etc', '2026-11-25-1432-zzzz', 'gh-', 'gh-1/..', '', null]) assert.equal(validFeedbackId(bad), false, String(bad));
  assert.ok(newFeedbackId(new Date(2026, 0, 2, 3, 4), new Uint8Array([1, 2])) < id);
});

test('a note keeps its lines and loses control characters; it is capped', () => {
  assert.equal(cleanNote('  The ring\r\n is hard\u0007 to grab.\n\n  '), 'The ring\n is hard to grab.');
  assert.equal(cleanNote(42), '');
  assert.equal([...cleanNote('x'.repeat(MAX_NOTE + 50))].length, MAX_NOTE);
});

test('the context is single lines, and the page is a path on this site', () => {
  const c = cleanContext({ page: '/book\n#x', device: 'iPad\tapp', viewport: 7, build: '0.2.1' });
  assert.equal(c.page, '/book #x');
  assert.equal(c.device, 'iPad app');
  assert.equal(c.viewport, '');
  assert.equal(cleanContext({ page: 'https://elsewhere.example/' }).page, '/');
  assert.equal(cleanContext({}).device, 'Unknown');
});

test('pictures are known by their bytes', () => {
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns=')), null);
  assert.equal(sniffImage(new Uint8Array([])), null);
});

test('pages are named by section', () => {
  assert.equal(pageLabel('/'), 'Archive');
  assert.equal(pageLabel('/#chapter=Blue'), 'Archive');
  assert.equal(pageLabel('/?colour=ff0000'), 'Archive');
  assert.equal(pageLabel('/scout?at=1,2'), 'Scout');
  assert.equal(pageLabel('/book/zine'), 'Magazine');
  assert.equal(pageLabel('/book'), 'Book');
  assert.equal(pageLabel('/upload'), 'Add & remove');
  assert.equal(pageLabel('/inspiration/match'), 'Inspiration');
  assert.equal(pageLabel('/somewhere?x=1'), '/somewhere');
});

test('an issue title is the first line, cut at 72 characters, or names the page', () => {
  assert.equal(issueTitle('\n  Sun ring   too small \nmore', '/scout'), 'Sun ring too small');
  assert.equal(issueTitle('', '/scout?at=1'), 'Feedback from Scout');
  const long = issueTitle('a'.repeat(100), '/');
  assert.equal([...long].length, 72);
  assert.ok(long.endsWith('…'));
});

test('an issue body round-trips: note, pictures and facts', () => {
  const note = 'The ring is hard to grab.\n\nOn the phone | sheet up -->';
  const body = issueBody(
    { id: '2026-11-25-1432-a10b', note, created: '2026-11-25T14:32:00.000Z', ...CTX, page: '/scout?x=-->' },
    ['https://github.com/o/r/blob/HEAD/shots/2026-11-25-1432-a10b-1.jpg?raw=true', 'https://github.com/o/r/blob/HEAD/shots/2026-11-25-1432-a10b-2.png?raw=true'],
  );
  assert.ok(body.includes('![Picture 2]('));
  assert.ok(!/"page":"[^"]*-->/.test(body), 'a value never closes the comment');
  const back = parseIssueBody(body);
  assert.equal(back.note, note);
  assert.equal(back.id, '2026-11-25-1432-a10b');
  assert.equal(back.created, '2026-11-25T14:32:00.000Z');
  assert.equal(back.context.page, '/scout?x=-->');
  assert.equal(back.context.device, 'iPhone app');
  assert.deepEqual(issueImages(body), ['2026-11-25-1432-a10b-1.jpg', '2026-11-25-1432-a10b-2.png']);
});

test('an issue typed on GitHub still reads: the body is the note', () => {
  const back = parseIssueBody('Book spreads jump.\r\nSee photo.');
  assert.equal(back.note, 'Book spreads jump.\nSee photo.');
  assert.equal(back.id, null);
  assert.equal(back.context.page, '/');
});

test('note.md round-trips, and rejects files that are not one', () => {
  const entry: FeedbackEntry = {
    id: 'gh-7', note: 'Line one\n\nLine: two', created: '2026-11-25T14:32:00.000Z', source: 'github',
    ...CTX, images: ['1.jpg', '2.png'], issue: 7, url: 'https://github.com/o/r/issues/7',
  };
  const md = noteMarkdown(entry);
  assert.match(md, /^---\nid: gh-7\n/);
  assert.deepEqual(parseNoteMarkdown(md), entry);
  assert.equal(parseNoteMarkdown('no front matter'), null);
  assert.equal(parseNoteMarkdown('---\nid: ../x\n---\nhi'), null);
  // A name that could reach outside its folder is dropped.
  assert.deepEqual(parseNoteMarkdown('---\nid: gh-1\nimages: 1.jpg, ../../x.jpg, .., ., note.md, 2.webp\n---\n')?.images, ['1.jpg', '2.webp']);
});

test('window size and picture fitting', () => {
  assert.equal(viewportLabel(393, 852.4, 3), '393×852 @3x');
  assert.equal(viewportLabel(1440, 900, 1.25), '1440×900 @1.3x');
  assert.deepEqual(fitWithin(1179, 2556), { w: 1179, h: 2556, scaled: false });
  assert.deepEqual(fitWithin(5120, 2880), { w: 2560, h: 1440, scaled: true });
});

test('the token page is filled in for the feedback repo', () => {
  const u = new URL(newTokenUrl('someone/fb'));
  assert.equal(u.origin + u.pathname, 'https://github.com/settings/personal-access-tokens/new');
  assert.equal(u.searchParams.get('target_name'), 'someone');
  assert.equal(u.searchParams.get('contents'), 'write');
  assert.equal(u.searchParams.get('issues'), 'write');
  assert.equal(u.searchParams.get('expires_in'), 'none');
  assert.ok(u.searchParams.get('name')!.length <= 40);
});

test('the tab bar’s before-paint script looks for the same token key', async () => {
  // TabBar.astro's inline script can't import TOKEN_KEY, so it spells it out.
  const { readFile } = await import('node:fs/promises');
  const { TOKEN_KEY } = await import('./feedback');
  const tabbar = await readFile(new URL('../components/TabBar.astro', import.meta.url), 'utf8');
  assert.ok(tabbar.includes(`localStorage.getItem('${TOKEN_KEY}')`));
});
