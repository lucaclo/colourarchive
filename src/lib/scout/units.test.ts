import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatHeight, formatLength, formatMapDistance, readDistanceUnits, setDistanceUnits, distanceUnits } from './units';
import { formatDistance } from './geo';

test('lengths read like a focus scale in either unit', () => {
  assert.equal(formatLength(1.83, 'm'), '1.8 m');
  assert.equal(formatLength(23.4, 'm'), '23 m');
  assert.equal(formatLength(1240, 'm'), '1.2 km');
  assert.equal(formatLength(Infinity, 'm'), '∞');
  assert.equal(formatLength(1.8, 'ft'), '5.9 ft');
  assert.equal(formatLength(22.86, 'ft'), '75 ft');
  assert.equal(formatLength(1200, 'ft'), '0.7 mi');
});

test('map distances keep whole units and switch to miles past a tenth of one', () => {
  assert.equal(formatMapDistance(850, 'm'), '850 m');
  assert.equal(formatMapDistance(2400, 'm'), '2.4 km');
  assert.equal(formatMapDistance(100, 'ft'), '328 ft');
  assert.equal(formatMapDistance(1609.344 * 11, 'ft'), '11 mi');
});

test('heights are whole and grouped', () => {
  assert.equal(formatHeight(1240, 'm'), '1,240 m');
  assert.equal(formatHeight(1240, 'ft'), '4,068 ft');
});

test('the page-wide setting reaches geo.formatDistance, and defaults to metres', () => {
  assert.equal(distanceUnits(), 'm');
  assert.equal(formatDistance(2400), '2.4 km');
  setDistanceUnits('ft');
  try {
    assert.equal(formatDistance(2400), '1.5 mi');
  } finally {
    setDistanceUnits('m');
  }
  assert.equal(readDistanceUnits('ft'), 'ft');
  assert.equal(readDistanceUnits('yards'), 'm');
});
