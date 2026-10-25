import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPath, inMacApp } from './install';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  macEdge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  macSafari16: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:131.0) Gecko/20100101 Firefox/131.0',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
};
const at = (ua: string, maxTouchPoints = 0, standalone = false) => installPath({ ua, maxTouchPoints, standalone });

test('already running as the app wins over everything', () => {
  assert.equal(at(UA.iphone, 5, true), 'installed');
});

test('iPhone and iPad Safari get different arrows', () => {
  assert.equal(at(UA.iphone, 5), 'iphone');
  assert.equal(at(UA.ipadDesktop, 5), 'ipad', 'an iPad reporting itself as a Mac');
});

test('the same UA with no touch is a Mac, offered the Mac app', () => {
  assert.equal(at(UA.ipadDesktop, 0), 'mac-app');
  assert.equal(at(UA.macSafari16, 0), 'mac-app', 'the download needs no Add to Dock');
});

test('other browsers on iOS share through their own toolbar', () => {
  assert.equal(at(UA.chromeIOS, 5), 'ios-other');
});

test('Chromium and Android', () => {
  assert.equal(at(UA.android, 5), 'android');
  assert.equal(at(UA.windowsChrome), 'desktop-chromium');
});

test('every browser on a Mac gets the Mac app, Firefox included', () => {
  assert.equal(at(UA.macChrome), 'mac-app');
  assert.equal(at(UA.macEdge), 'mac-app');
  assert.equal(at(UA.firefox), 'mac-app');
});

test('desktop Firefox elsewhere cannot install', () => {
  assert.equal(at(UA.windowsFirefox), 'unsupported');
});

test('inside the Mac app there is nothing to get', () => {
  assert.equal(at(`${UA.macChrome} Electron/44.5.1 ColourArchiveMac/0.1.0`, 0, true), 'installed');
  assert.ok(inMacApp(`${UA.macChrome} ColourArchiveMac/0.1.0`));
  assert.ok(!inMacApp(UA.macChrome));
});
