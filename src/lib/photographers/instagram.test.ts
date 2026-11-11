import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { rankInstagram, usernameFromHref, wantedInExport } from './instagram';
import { unzip } from '../unzip';
import { zipFiles } from '../zip';

test('usernameFromHref reads every address shape the export uses', () => {
  assert.equal(usernameFromHref('https://www.instagram.com/_u/Some.One'), 'some.one');
  assert.equal(usernameFromHref('https://www.instagram.com/someone'), 'someone');
  assert.equal(usernameFromHref('https://www.instagram.com/p/Cx1/'), undefined);
});

test('rankInstagram: saves weigh most, following alone is not enough', () => {
  const following = { name: 'connections/followers_and_following/following.json', text: JSON.stringify({ relationships_following: [
    { title: '', string_list_data: [{ href: 'https://www.instagram.com/old_style', value: 'old_style', timestamp: 1 }] },
    { title: 'new_style', string_list_data: [{ href: 'https://www.instagram.com/_u/new_style', timestamp: 1 }] },
    { title: 'just_followed', string_list_data: [{ href: 'https://www.instagram.com/_u/just_followed' }] },
  ] }) };
  const saved = { name: 'your_instagram_activity/saved/saved_posts.json', text: JSON.stringify({ saved_saved_media: [
    { title: 'new_style', string_map_data: { 'Saved on': { href: 'https://www.instagram.com/p/1/', timestamp: 1_700_000_000 } } },
    { title: 'new_style', string_map_data: { 'Saved on': { href: 'https://www.instagram.com/p/2/', timestamp: 1_710_000_000 } } },
    { title: 'stranger', string_map_data: { 'Saved on': { href: 'https://www.instagram.com/p/3/', timestamp: 1_600_000_000 } } },
  ] }) };
  const liked = { name: 'your_instagram_activity/likes/liked_posts.json', text: JSON.stringify({ likes_media_likes: [
    { title: 'old_style', string_list_data: [{ href: 'https://www.instagram.com/p/4/', value: '👍', timestamp: 1 }] },
    { title: 'old_style', string_list_data: [{ href: 'https://www.instagram.com/p/5/', value: '👍', timestamp: 2 }] },
  ] }) };
  const ranked = rankInstagram([following, saved, liked, { name: 'broken.json', text: '{' }]);
  assert.deepEqual(ranked.map((p) => p.username), ['new_style', 'old_style', 'stranger']);
  assert.deepEqual(ranked[0], { username: 'new_style', saved: 2, liked: 0, following: true, last: new Date(1_710_000_000_000).toISOString(), score: 8 });
  assert.equal(ranked[1].following, true);
  assert.ok(!ranked.some((p) => p.username === 'just_followed'));
});

test('wantedInExport picks the JSON that matters and nothing else', () => {
  assert.ok(wantedInExport('connections/followers_and_following/following.json'));
  assert.ok(wantedInExport('your_instagram_activity/saved/saved_posts.json'));
  assert.ok(!wantedInExport('connections/followers_and_following/following_hashtags.html'));
  assert.ok(!wantedInExport('media/posts/202401/123.jpg'));
});

test('unzip reads stored entries and inflates deflated ones, skipping the rest', () => {
  const stored = Buffer.from(zipFiles([{ name: 'a/following.json', data: '{"x":1}' }, { name: 'media/1.jpg', data: 'jpeg' }]));
  assert.deepEqual(unzip(stored, wantedInExport).map((f) => [f.name, f.data.toString()]), [['a/following.json', '{"x":1}']]);

  // One deflated entry, built by hand: local header, data, central directory, end.
  const name = Buffer.from('saved_posts.json');
  const body = Buffer.from('{"saved_saved_media":[]}');
  const comp = deflateRawSync(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(body.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOffset = 30 + name.length + comp.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, comp, cd, name, end]);
  assert.equal(unzip(zip, () => true)[0].data.toString(), body.toString());

  assert.throws(() => unzip(Buffer.from('not a zip at all, honestly'), () => true), /not a zip/);
});
