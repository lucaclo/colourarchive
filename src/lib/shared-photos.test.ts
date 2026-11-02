import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedTitle } from './shared-photos';

test('a shared photo is titled the way the archive names it', () => {
  assert.equal(
    sharedTitle({ genre: 'street', medium: 'digital', exif: { capturedAt: '2026-07-25T02:33:53.000Z' } } as never, 'Green'),
    'Street photograph, Green, July 2026',
  );
  assert.equal(sharedTitle({ medium: 'film', exif: {} } as never, 'Blue'), 'Photograph on film, Blue');
});
