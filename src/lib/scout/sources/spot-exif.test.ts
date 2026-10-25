import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectExposure } from './spot-exif.ts';

const commonsPage = (pageid: number, f: string) => ({
  pageid,
  imageinfo: [{ metadata: [{ name: 'FNumber', value: f }, { name: 'ExposureTime', value: '1/250' }] }],
});

describe('collectExposure', () => {
  it('asks Commons once for a batch and keys answers by source and id', async () => {
    const asked: string[] = [];
    const settings = await collectExposure(
      [
        { source: 'wikimedia', id: '901' },
        { source: 'wikimedia', id: '902' },
      ],
      async (url) => {
        asked.push(url);
        return { query: { pages: [commonsPage(901, '8/1'), { pageid: 902, imageinfo: [{ metadata: [] }] }] } };
      },
    );
    assert.equal(asked.length, 1);
    assert.match(asked[0], /pageids=901%7C902/);
    assert.equal(settings['wikimedia:901'].fNumber, 8);
    assert.equal('wikimedia:902' in settings, false);
  });

  it('remembers answers, including "this file has none"', async () => {
    let calls = 0;
    const transport = async () => {
      calls++;
      return { query: { pages: [commonsPage(911, '4/1'), { pageid: 912, imageinfo: [{ metadata: [] }] }] } };
    };
    const ask = [
      { source: 'wikimedia', id: '911' },
      { source: 'wikimedia', id: '912' },
    ];
    await collectExposure(ask, transport);
    const again = await collectExposure(ask, transport);
    assert.equal(calls, 1);
    assert.equal(again['wikimedia:911'].fNumber, 4);
  });

  it('does not remember a failed request as an empty answer', async () => {
    let calls = 0;
    const ask = [{ source: 'wikimedia', id: '921' }];
    await collectExposure(ask, async () => {
      calls++;
      throw new Error('offline');
    });
    const later = await collectExposure(ask, async () => {
      calls++;
      return { query: { pages: [commonsPage(921, '11/1')] } };
    });
    assert.equal(calls, 2);
    assert.equal(later['wikimedia:921'].fNumber, 11);
  });

  it('leaves Flickr alone without a key, and asks per photo with one', async () => {
    const asked: string[] = [];
    const transport = async (url: string) => {
      asked.push(url);
      return { photo: { camera: 'X', exif: [{ tag: 'FNumber', raw: { _content: '5.6' } }] }, stat: 'ok' };
    };
    const ask = [
      { source: 'flickr', id: '931' },
      { source: 'flickr', id: '932' },
    ];
    assert.deepEqual(await collectExposure(ask, transport), {});
    assert.equal(asked.length, 0);
    const found = await collectExposure(ask, transport, { flickrKey: 'k' });
    assert.equal(asked.length, 2);
    assert.match(asked[0], /method=flickr\.photos\.getExif/);
    assert.equal(found['flickr:932'].fNumber, 5.6);
  });
});
