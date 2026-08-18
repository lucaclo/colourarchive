/**
 * A canary against the real Commons API.
 *
 * Everything else in this directory is tested against a recorded transport, on
 * purpose — a live dependency should not decide whether `npm test` passes. But a
 * recorded transport cannot catch Commons changing its answer shape, or this
 * code asking a category that no longer means what it did, which is exactly how
 * the `valued` tier went silently wrong for as long as it did — see
 * `wikimedia.ts`, and issue #29. This file is allowed to depend on the network.
 * It is not part of `npm test` and is run by hand or from a schedule instead:
 * `npm run canary:scout-photos`.
 *
 * Edinburgh is the reference point the rest of this layer was measured against
 * (`SCOUT-HANDOFF.md`, Part 5), and at 15 km every tier is known to have
 * something in it. That is the property a canary needs: a coordinate where a
 * quiet tier is unambiguously a broken one, not an honestly empty one.
 *
 * Commons rate-limits aggressively enough that measuring these counts by hand
 * tripped it within seconds, so this asks once, for one coordinate, and checks
 * for presence rather than an exact count that would drift as Commons grows.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchCommonsPhotos } from './photo-client.ts';
import type { Accolade } from './wikimedia.ts';

const EDINBURGH = { lat: 55.9533, lon: -3.1883 };
const TIERS: Accolade[] = ['featured', 'quality', 'valued', 'contest'];

describe('the photo tiers, against the real Commons API', () => {
  it(
    'answers every tier for a coordinate known to have something in each',
    { timeout: 30_000 },
    async () => {
      const { photos, tiers } = await fetchCommonsPhotos({
        centre: EDINBURGH,
        radiusM: 15_000,
        limit: 200,
      });

      // This is the fix for #29 itself: a tier whose own request failed must
      // say so, not fold into the same shape as one that is honestly empty.
      for (const tier of tiers) {
        assert.equal(tier.ok, true, `the ${tier.accolade} tier's own request failed`);
      }
      assert.deepEqual(
        tiers.map((t) => t.accolade).sort(),
        [...TIERS].sort(),
      );

      assert.ok(photos.length > 0, 'no photographs came back at all');
      for (const accolade of TIERS) {
        assert.ok(
          photos.some((p) => p.accolade === accolade),
          `no ${accolade} photograph came back — a broken query looks exactly like this`,
        );
      }

      // The rule this whole layer is built on, checked against a real response
      // rather than a fixture that could not fail to satisfy it.
      for (const photo of photos) {
        assert.ok(photo.author, `${photo.title} has no author`);
        assert.ok(photo.licence.name, `${photo.title} has no licence`);
      }
    },
  );
});
