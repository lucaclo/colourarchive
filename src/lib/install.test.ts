import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPath } from './install';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  macEdge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  macSafari16: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0',
};
const at = (ua: string, maxTouchPoints = 0, standalone = false) => installPath({ ua, maxTouchPoints, standalone });

test('already running as the app wins over everything', () => {
  assert.equal(at(UA.iphone, 5, true), 'installed');
});

test('iPhone and iPad Safari get different arrows', () => {
  assert.equal(at(UA.iphone, 5), 'iphone');
  assert.equal(at(UA.ipadDesktop, 5), 'ipad', 'an iPad reporting itself as a Mac');
});

test('the same UA with no touch is a Mac', () => {
  assert.equal(at(UA.ipadDesktop, 0), 'mac-safari');
  assert.equal(at(UA.macSafari16, 0), 'unsupported', 'Add to Dock arrived in Safari 17');
});

test('other browsers on iOS share through their own toolbar', () => {
  assert.equal(at(UA.chromeIOS, 5), 'ios-other');
});

test('Chromium and Android', () => {
  assert.equal(at(UA.android, 5), 'android');
  assert.equal(at(UA.macChrome), 'desktop-chromium');
  assert.equal(at(UA.macEdge), 'desktop-chromium');
});

test('desktop Firefox cannot install', () => {
  assert.equal(at(UA.firefox), 'unsupported');
});
