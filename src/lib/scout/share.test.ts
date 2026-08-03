import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decodeScoutLink, encodeScoutLink, isCalendarDate, isKnownTimeZone } from './share.ts';

const EDINBURGH = { lat: 55.953251, lon: -3.188267 };

describe('encodeScoutLink', () => {
  it('carries the whole spot and nothing else', () => {
    const query = encodeScoutLink({
      centre: EDINBURGH,
      name: 'City of Edinburgh',
      timeZone: 'Europe/London',
      radiusKm: 10,
      isoDate: '2026-08-01',
      minute: 1265,
    });
    const back = decodeScoutLink(query)!;
    assert.deepEqual(back.centre, { lat: 55.95325, lon: -3.18827 });
    assert.equal(back.name, 'City of Edinburgh');
    assert.equal(back.timeZone, 'Europe/London');
    assert.equal(back.radiusKm, 10);
    assert.equal(back.isoDate, '2026-08-01');
    assert.equal(back.minute, 1265);
  });

  it('rounds to about a metre, which keeps the link short', () => {
    const query = encodeScoutLink({ centre: { lat: 55.9532511111, lon: -3.1882677777 } });
    assert.ok(query.includes('at=55.95325%2C-3.18827'), query);
  });

  it('leaves out what it was not given', () => {
    const query = encodeScoutLink({ centre: EDINBURGH });
    assert.equal(query, 'at=55.95325%2C-3.18827');
  });

  it('survives a place name with a comma and an ampersand', () => {
    const name = 'Stratford-upon-Avon, Warwickshire & District';
    const back = decodeScoutLink(encodeScoutLink({ centre: EDINBURGH, name }))!;
    assert.equal(back.name, name);
  });
});

describe('decodeScoutLink', () => {
  it('refuses a link with nowhere to stand', () => {
    assert.equal(decodeScoutLink(''), null);
    assert.equal(decodeScoutLink('d=2026-08-01&t=600'), null);
    assert.equal(decodeScoutLink('at=notanumber,3'), null);
    assert.equal(decodeScoutLink('at=55.9'), null);
    assert.equal(decodeScoutLink('at=55.9,-3.1,999'), null);
  });

  it('refuses coordinates off the map', () => {
    assert.equal(decodeScoutLink('at=91,0'), null);
    assert.equal(decodeScoutLink('at=0,181'), null);
    // Mercator cannot draw the poles, and the engines are not asked to try.
    assert.equal(decodeScoutLink('at=88,0'), null);
  });

  it('drops a field that fails checking rather than guessing at it', () => {
    const link = decodeScoutLink('at=55.9,-3.1&r=900&d=2026-02-31&t=5000&tz=Middle/Earth&n=%20%20')!;
    assert.deepEqual(link.centre, { lat: 55.9, lon: -3.1 });
    assert.equal(link.radiusKm, undefined, 'a 900km radius is not on the slider');
    assert.equal(link.isoDate, undefined, 'the 31st of February is not a day');
    assert.equal(link.minute, undefined, 'there is no minute 5000');
    assert.equal(link.timeZone, undefined, 'an unknown zone would shift every time on the page');
    assert.equal(link.name, undefined, 'a name of only spaces is not a name');
  });

  it('keeps midnight, which is falsy and easy to lose', () => {
    assert.equal(decodeScoutLink('at=55.9,-3.1&t=0')!.minute, 0);
  });

  it('accepts the far end of the day', () => {
    assert.equal(decodeScoutLink('at=55.9,-3.1&t=1440')!.minute, 1440);
  });

  it('ignores anything else riding along in the query', () => {
    const link = decodeScoutLink('at=55.9,-3.1&utm_source=mail&foo=bar')!;
    assert.deepEqual(link, { centre: { lat: 55.9, lon: -3.1 } });
  });
});

describe('the validators', () => {
  it('knows a real zone from a plausible one', () => {
    assert.equal(isKnownTimeZone('Europe/London'), true);
    assert.equal(isKnownTimeZone('Asia/Tokyo'), true);
    assert.equal(isKnownTimeZone('Europe/Metropolis'), false);
  });

  it('knows a real date from a well-shaped one', () => {
    assert.equal(isCalendarDate('2026-08-01'), true);
    assert.equal(isCalendarDate('2026-02-29'), false, '2026 is not a leap year');
    assert.equal(isCalendarDate('2024-02-29'), true, '2024 is');
    assert.equal(isCalendarDate('2026-13-01'), false);
    assert.equal(isCalendarDate('1 Aug 2026'), false);
  });
});
