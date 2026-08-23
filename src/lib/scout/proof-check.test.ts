import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { crossCheckProof } from './proof-check.ts';
import type { LightProof } from './spots.ts';

const CALTON = { lat: 55.9553, lon: -3.1817 };

const proof = (capturedAt: string, claim = 'x'): LightProof => ({
  url: 'https://example.org/a.jpg',
  capturedAt: new Date(capturedAt).getTime(),
  claim,
});

describe('crossCheckProof', () => {
  it('reads the sun up at Edinburgh noon in June', () => {
    const check = crossCheckProof(CALTON, proof('2026-06-21T12:00:00Z'));
    assert.ok(check.sunUp);
    assert.ok(check.sunAltitude > 30, `${check.sunAltitude}`);
    assert.match(check.note, /sun at/);
  });

  it('reads the sun down at Edinburgh midnight in December', () => {
    const check = crossCheckProof(CALTON, proof('2026-12-21T00:00:00Z'));
    assert.equal(check.sunUp, false);
    assert.match(check.note, /sun was down/);
  });

  it('carries a real azimuth regardless of the claim text', () => {
    const check = crossCheckProof(CALTON, proof('2026-06-21T18:00:00Z', 'sun setting behind the ridge'));
    assert.ok(check.sunAzimuth >= 0 && check.sunAzimuth < 360);
  });
});
