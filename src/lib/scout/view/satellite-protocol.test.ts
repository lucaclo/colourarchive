import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { quadrantIn, type TileAddress } from '../terrain.ts';
import { esriTileUrl, fetchEsriTile, findImagery, isEsriPlaceholder } from './satellite-protocol.ts';

/** Patagonia (-50.94, -73.41) at z18, where Esri has no imagery; z17 has. */
const PATAGONIA_Z18: TileAddress = { z: 18, x: 77616, y: 174314 };

const key = (t: TileAddress) => `${t.z}/${t.x}/${t.y}`;
const jpeg = (bytes: number) => new ArrayBuffer(bytes);

describe('esriTileUrl', () => {
  it('asks for row before column, and for a 404 rather than the grey square', () => {
    assert.equal(
      esriTileUrl(PATAGONIA_Z18),
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/174314/77616',
    );
  });
});

describe('findImagery', () => {
  it('takes the tile itself when Esri has it', async () => {
    const asked: string[] = [];
    const found = await findImagery(PATAGONIA_Z18, async (t) => {
      asked.push(key(t));
      return jpeg(13_000);
    });
    assert.equal(found?.levels, 0);
    assert.deepEqual(found?.from, PATAGONIA_Z18);
    assert.deepEqual(asked, ['18/77616/174314']);
  });

  it('climbs to the nearest ancestor that has imagery', async () => {
    const asked: string[] = [];
    const have = new Set(['16/19404/43578', '15/9702/21789']);
    const found = await findImagery(PATAGONIA_Z18, async (t) => {
      asked.push(key(t));
      return have.has(key(t)) ? jpeg(3_000) : null;
    });
    assert.equal(found?.levels, 2);
    assert.deepEqual(found?.from, { z: 16, x: 19404, y: 43578 });
    // Stops at the first one it finds, and never asks below the tile.
    assert.deepEqual(asked, ['18/77616/174314', '17/38808/87157', '16/19404/43578']);
    // And the piece of it to scale up: 77616 % 4 = 0, 174314 % 4 = 2.
    assert.deepEqual(quadrantIn(PATAGONIA_Z18, found!.levels, 256), { x: 0, y: 128, size: 64 });
  });

  it('gives up after eight levels', async () => {
    const asked: string[] = [];
    const found = await findImagery(PATAGONIA_Z18, async (t) => {
      asked.push(key(t));
      return null;
    });
    assert.equal(found, null);
    assert.equal(asked.length, 9);
    assert.equal(asked.at(-1), '10/303/680');
  });

  it('stops at z0 for a shallow tile', async () => {
    const found = await findImagery({ z: 2, x: 1, y: 3 }, async () => null);
    assert.equal(found, null);
  });
});

describe('fetchEsriTile', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Esri as measured: 404 at z18 here, the placeholder or imagery above. */
  function esri(answers: Record<number, () => Promise<Response>>) {
    const asked: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      const z = Number(url.match(/tile\/(\d+)\//)?.[1]);
      return answers[z]();
    }) as typeof fetch;
    return asked;
  }

  it('reads a 404 as no imagery, and the ancestor is used', async () => {
    const asked = esri({
      18: async () => new Response('not found', { status: 404 }),
      17: async () => new Response(new Uint8Array(3874), { status: 200 }),
    });
    const found = await findImagery(PATAGONIA_Z18, fetchEsriTile);
    assert.equal(found?.levels, 1);
    assert.equal(found?.bytes.byteLength, 3874);
    assert.ok(asked.every((url) => !url.includes('blankTile')), 'asks for the plain tile, whose placeholder carries CORS');
  });

  it("reads Esri's 404 without a CORS header, a failed fetch, the same way", async () => {
    esri({
      18: async () => {
        throw new TypeError('Failed to fetch');
      },
      17: async () => new Response(new Uint8Array(3874), { status: 200 }),
    });
    const found = await findImagery(PATAGONIA_Z18, fetchEsriTile);
    assert.equal(found?.levels, 1);
  });

  it('skips the grey placeholder if Esri sends it anyway', async () => {
    assert.ok(isEsriPlaceholder(jpeg(2521)));
    assert.ok(!isEsriPlaceholder(jpeg(2408)));
    esri({
      18: async () => new Response(new Uint8Array(2521), { status: 200 }),
      17: async () => new Response(new Uint8Array(2521), { status: 200 }),
      16: async () => new Response(new Uint8Array(3091), { status: 200 }),
    });
    const found = await findImagery(PATAGONIA_Z18, fetchEsriTile);
    assert.equal(found?.levels, 2);
    assert.equal(found?.bytes.byteLength, 3091);
  });
});
