import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseGeoFeed } from './favourites.ts';

const WHO = { name: 'Ada Lens', nsid: '123@N01' };

const item = (geo: string) => `<item>
  <title>Fog &amp; the river</title>
  <link>https://www.flickr.com/photos/ada/55641938694/</link>
  <dc:date.Taken>2021-07-16T08:53:28-08:00</dc:date.Taken>
  ${geo}
  <media:content url="https://live.staticflickr.com/65535/55641938694_fc623fabde_b.jpg"
     type="image/jpeg"
     height="636"
     width="1024"/>
</item>`;

describe('parseGeoFeed', () => {
  it('keeps geotagged items, credited to the favourite', () => {
    const [p, ...rest] = parseGeoFeed(`<rss>${item('<georss:point>51.504376 -0.075555</georss:point>')}</rss>`, WHO);
    assert.equal(rest.length, 0);
    assert.deepEqual(p.at, { lat: 51.504376, lon: -0.075555 });
    assert.equal(p.id, '55641938694');
    assert.equal(p.title, 'Fog & the river');
    assert.equal(p.author, 'Ada Lens');
    assert.deepEqual(p.notable, { name: 'Ada Lens' });
    assert.equal(p.thumbUrl, 'https://live.staticflickr.com/65535/55641938694_fc623fabde_n.jpg');
    assert.deepEqual([p.thumbWidth, p.thumbHeight], [320, 199]);
    assert.equal(p.takenAt?.toISOString(), '2021-07-16T16:53:28.000Z');
  });

  it('drops items with no place, an empty point or null island', () => {
    const xml = [item(''), item('<georss:point></georss:point>'), item('<georss:point>0 0</georss:point>')].join('');
    assert.deepEqual(parseGeoFeed(xml, WHO), []);
  });
});
