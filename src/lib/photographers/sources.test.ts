import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identify, discoverFeed, flickrNsidFromFeed, flickrNameFromFeedTitle, parseFeed, pageWork, pageAuthor,
  bskyWork, flickrWork, arenaChannelWork, mastodonWork, profileUrlOf, imagesInHtml,
} from './sources';

test('identify: each platform from the shape of its link', () => {
  assert.deepEqual(identify('https://bsky.app/profile/someone.bsky.social'), { kind: 'bluesky', actor: 'someone.bsky.social', post: undefined });
  assert.deepEqual(identify('https://bsky.app/profile/a.b/post/3kx'), { kind: 'bluesky', actor: 'a.b', post: '3kx' });
  assert.deepEqual(identify('https://www.are.na/renee-kohl/film-photography-fx96l6thny8'), { kind: 'arena-channel', slug: 'film-photography-fx96l6thny8' });
  assert.deepEqual(identify('https://www.are.na/renee-kohl'), { kind: 'arena-user', slug: 'renee-kohl' });
  assert.deepEqual(identify('https://www.are.na/block/123'), { kind: 'arena-block', id: '123' });
  assert.deepEqual(identify('https://www.flickr.com/photos/nasahqphoto/55618547845/'), { kind: 'flickr', user: 'nasahqphoto', photo: '55618547845' });
  assert.deepEqual(identify('https://www.instagram.com/someone/'), { kind: 'instagram', user: 'someone' });
  assert.deepEqual(identify('https://www.instagram.com/p/Cx123/'), { kind: 'instagram', user: undefined });
  assert.deepEqual(identify('https://mastodon.social/@Gargron/123'), { kind: 'mastodon', host: 'mastodon.social', acct: 'Gargron', post: '123' });
  assert.equal(identify('https://example.com/work')?.kind, 'web');
  assert.equal(identify('not a link'), null);
  assert.equal(identify('ftp://x.y/z'), null);
});

test('profileUrlOf: a shared post points back at its account, or at nobody', () => {
  assert.equal(profileUrlOf('https://bsky.app/profile/a.b/post/3kx'), 'https://bsky.app/profile/a.b');
  assert.equal(profileUrlOf('https://www.flickr.com/photos/jo/123/'), 'https://www.flickr.com/photos/jo/');
  assert.equal(profileUrlOf('https://www.instagram.com/p/Cx123/'), null);
  assert.equal(profileUrlOf('https://pinterest.com/pin/1'), null);
});

test('discoverFeed + Flickr: the NSID and name come from the page Flickr serves', () => {
  const html = `<head><link rel="alternate" type="application/atom+xml" title="Flickr: NASA HQ PHOTO’s Photostream Atom feed" href="/services/feeds/photos_public.gne?id&#x3D;35067687@N04&amp;lang&#x3D;en-us&amp;format&#x3D;atom"></head>`;
  const feed = discoverFeed(html, 'https://www.flickr.com/photos/nasahqphoto/');
  assert.ok(feed);
  assert.equal(flickrNsidFromFeed(feed.href), '35067687@N04');
  assert.equal(flickrNameFromFeedTitle(feed.title), 'NASA HQ PHOTO');
  assert.equal(discoverFeed('<link rel="stylesheet" href="/a.css">', 'https://x.y/'), null);
});

test('parseFeed: RSS with media:content, escaped bodies, and Atom', () => {
  const rss = `<rss><channel><title>Jo Smith</title>
    <item><title>Harbour</title><link>https://jo.example/harbour</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
      <media:content url="https://cdn.example/harbour.jpg" medium="image"/></item>
    <item><title>Fog</title><link>https://jo.example/fog</link>
      <description>&lt;p&gt;&lt;img src="https://cdn.example/fog-1.jpg"&gt;&lt;img src="/fog-2.jpg"&gt;&lt;img src="/logo.png"&gt;&lt;/p&gt;</description></item>
  </channel></rss>`;
  const { title, items } = parseFeed(rss, 'https://jo.example/feed');
  assert.equal(title, 'Jo Smith');
  assert.deepEqual(items.map((i) => i.full), ['https://cdn.example/harbour.jpg', 'https://cdn.example/fog-1.jpg', 'https://jo.example/fog-2.jpg']);
  assert.equal(items[0].url, 'https://jo.example/harbour');
  assert.equal(items[0].at, '2026-11-02T10:00:00.000Z');

  const atom = `<feed><title>Pix</title><entry><title>One</title><link rel="alternate" href="https://p.example/1"/>
    <published>2026-10-01T00:00:00Z</published><content type="html"><![CDATA[<img src="https://p.example/1.jpg">]]></content></entry></feed>`;
  const a = parseFeed(atom, 'https://p.example/feed');
  assert.equal(a.items[0].full, 'https://p.example/1.jpg');
  assert.equal(a.items[0].url, 'https://p.example/1');
});

test('pageWork: og:image first, srcset largest, sizes and icons folded away', () => {
  const html = `<meta property="og:image" content="https://s.example/hero.jpg">
    <img src="/a-300x200.jpg" srcset="/a-300x200.jpg 300w, /a.jpg 1600w">
    <img data-src="https://s.example/b.jpg?format=750w"><img src="https://s.example/b.jpg?format=300w">
    <img src="/site-logo.png"><img src="/icon.svg">`;
  const items = pageWork(html, 'https://s.example/work');
  assert.deepEqual(items.map((i) => i.full), ['https://s.example/hero.jpg', 'https://s.example/a.jpg', 'https://s.example/b.jpg?format=750w']);
});

test('imagesInHtml keeps order and resolves relative addresses', () => {
  assert.deepEqual(imagesInHtml('<img src="x.jpg"><img src="x.jpg">', 'https://a.b/c/'), ['https://a.b/c/x.jpg']);
});

test('pageAuthor names a person, never the site', () => {
  assert.equal(pageAuthor('<meta name="author" content="Jo Smith">'), 'Jo Smith');
  assert.equal(pageAuthor('<meta name="twitter:creator" content="@josmith">'), 'josmith');
  assert.equal(pageAuthor('<meta property="og:site_name" content="Pinterest">'), undefined);
});

test('bskyWork: own posts only, every image, fullsize kept for pinning', () => {
  const feed = [
    { post: { uri: 'at://did:a/app.bsky.feed.post/r1', author: { did: 'did:a', handle: 'a.b' }, record: { createdAt: '2026-10-01T00:00:00Z', text: 'two' },
      embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 't1', fullsize: 'f1' }, { thumb: 't2', fullsize: 'f2' }] } } },
    { post: { uri: 'at://did:z/app.bsky.feed.post/r2', author: { did: 'did:z', handle: 'z' }, embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'x', fullsize: 'x' }] } }, reason: { $type: 'repost' } },
    { post: { uri: 'at://did:a/app.bsky.feed.post/r3', author: { did: 'did:a', handle: 'a.b' },
      embed: { $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 't3', fullsize: 'f3' }] } } } },
  ];
  const items = bskyWork(feed, 'did:a');
  assert.deepEqual(items.map((i) => i.full), ['f1', 'f2', 'f3']);
  assert.equal(items[0].url, 'https://bsky.app/profile/a.b/post/r1');
});

test('flickrWork upgrades the 240px feed size', () => {
  const [it] = flickrWork({ items: [{ link: 'https://www.flickr.com/photos/x/1/', media: { m: 'https://live.staticflickr.com/1/1_abc_m.jpg' } }] });
  assert.equal(it.thumb, 'https://live.staticflickr.com/1/1_abc_z.jpg');
  assert.equal(it.full, 'https://live.staticflickr.com/1/1_abc_b.jpg');
});

test('arenaChannelWork: images only, newest connection first', () => {
  const items = arenaChannelWork([
    { id: 1, class: 'Image', connected_at: '2020-01-01', image: { display: { url: 'd1' }, original: { url: 'o1' } } },
    { id: 2, class: 'Text', connected_at: '2024-01-01' },
    { id: 3, class: 'Image', connected_at: '2023-01-01', image: { display: { url: 'd3' }, large: { url: 'l3' }, original: { url: 'o3' } } },
  ]);
  assert.deepEqual(items.map((i) => [i.key, i.thumb, i.full]), [['arena:3', 'd3', 'l3'], ['arena:1', 'd1', 'o1']]);
});

test('mastodonWork skips boosts and non-images', () => {
  const items = mastodonWork([
    { id: '1', url: 'https://m/1', media_attachments: [{ type: 'image', url: 'u1', preview_url: 'p1' }, { type: 'video', url: 'v' }] },
    { id: '2', reblog: {}, media_attachments: [{ type: 'image', url: 'u2' }] },
  ]);
  assert.deepEqual(items.map((i) => i.full), ['u1']);
});

test('tidyName strips decoration, keeps studio names', async () => {
  const { tidyName, looksLikeName } = await import('./sources');
  assert.equal(tidyName('Donna Feledichuk Photographer 🇨🇦'), 'Donna Feledichuk');
  assert.equal(tidyName('Evelyn | Wildlife Photographer'), 'Evelyn');
  assert.equal(tidyName('Photographer: Daido Moriyama'), 'Daido Moriyama');
  assert.equal(tidyName('Fit Light Photography'), 'Fit Light Photography');
  assert.equal(tidyName('📷'), '📷');
  assert.ok(looksLikeName('Saul Leiter'));
  assert.ok(looksLikeName('Vivian van der Meer'));
  assert.ok(!looksLikeName('p: b/w tech thriller aes'));
  assert.ok(!looksLikeName('photographs'));
});

test('namesMatch wants the whole name, siteGuesses the usual domains', async () => {
  const { namesMatch, siteGuesses, workPageUrl, profileLinksIn } = await import('./sources');
  assert.ok(namesMatch('Adrien Sanguinetti | Shop Premium Lr Presets', 'Adrien Sanguinetti'));
  assert.ok(namesMatch('adriensanguinetti.bsky.social', 'Adrien Sanguinetti'));
  assert.ok(!namesMatch('Adrien Franque adrienfranque.bsky.social', 'Adrien Sanguinetti'));
  assert.ok(namesMatch('Renée Kohl', 'renee kohl'));
  assert.ok(siteGuesses('Adrien Sanguinetti').includes('https://www.adriensanguinetti.com/'));
  assert.deepEqual(siteGuesses('Madonna'), []);
  const html = `<a href="/store">Shop</a><a href="/blog">Journal</a><a href="/portfolio">Portfolio</a>
    <a href="https://www.instagram.com/adrisangui/">IG</a><a href="https://www.youtube.com/@x">YT</a>
    <a href="https://www.flickr.com/photos/128792568@N03/">Flickr</a><a href="https://www.instagram.com/p/abc/">post</a>`;
  assert.equal(workPageUrl(html, 'https://www.example.com/'), 'https://www.example.com/portfolio');
  assert.deepEqual(profileLinksIn(html, 'https://www.example.com/'), ['https://www.instagram.com/adrisangui/', 'https://www.flickr.com/photos/128792568@N03/']);
});

test('sized asks Squarespace for a grid size and leaves others alone', async () => {
  const { sized } = await import('./sources');
  assert.deepEqual(sized('https://images.squarespace-cdn.com/content/v1/a/b.jpg'), {
    thumb: 'https://images.squarespace-cdn.com/content/v1/a/b.jpg?format=500w',
    full: 'https://images.squarespace-cdn.com/content/v1/a/b.jpg?format=2500w',
  });
  assert.deepEqual(sized('https://x.example/a.jpg'), { thumb: 'https://x.example/a.jpg', full: 'https://x.example/a.jpg' });
});

test('Glass, Pinterest and the feed names they come with', async () => {
  const { sized, feedName, identify } = await import('./sources');
  const { linkLabel } = await import('./kinds');
  assert.equal(feedName('Photo feed of Tom Watson on Glass', 'glass.photo'), 'Tom Watson');
  assert.equal(feedName('dansup on pixelfed.social', 'pixelfed.social'), 'dansup');
  assert.equal(feedName('Life on Mars', 'mars.blog'), 'Life on Mars');
  assert.match(sized('https://cdn.glass.photo/abc/rs:fit:3072:3072:0/q:90/xyz').thumb, /^\/api\/photographers\/thumb\?u=/);
  assert.equal(sized('https://i.pinimg.com/236x/a/b.jpg').full, 'https://i.pinimg.com/736x/a/b.jpg');
  assert.deepEqual(identify('https://www.pinterest.co.uk/someone/'), { kind: 'web', url: 'https://www.pinterest.com/someone/feed.rss' });
  assert.deepEqual(identify('https://www.pinterest.com/someone/film/'), { kind: 'web', url: 'https://www.pinterest.com/someone/film.rss' });
  assert.equal(linkLabel({ kind: 'feed', url: 'https://glass.photo/tom', feed: 'https://glass.photo/tom/rss' }), 'Glass');
  assert.equal(linkLabel({ kind: 'page', url: 'https://www.adriensanguinetti.com/portfolio' }), 'Site');
});
