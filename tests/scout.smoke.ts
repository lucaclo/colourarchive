/**
 * /scout, in a real browser.
 *
 * Every unit test in `src/lib/scout/` runs the maths with no page around it,
 * and the failures this tab actually shipped were all of the other kind: a
 * shader that would not link, so every sprite the point program drew silently
 * vanished; a zoom that returned a floor it could not afford, so the world view
 * asked AWS for 24,450 DEM tiles; a restored link that fetched no photographs
 * because it called a loader before the style was up. None of them is visible
 * to `tsc`, none of them fails the build, and each was found by hand.
 *
 * So this is the cheapest guard that would have caught them: load the page,
 * watch what it asks the network for, drive it, and look at what it drew.
 *
 * It runs against `astro dev` rather than the built output, because the handle
 * it is driven by (`window.scout`) is deliberately gated behind
 * `import.meta.env.DEV` — a diagnostic surface in a shipped page is how the
 * last round of scaffolding got there.
 *
 *   npm run smoke
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';

// `fileURLToPath`, not `url.pathname`: this project lives in a directory with a
// space in its name, and a pathname hands that back percent-encoded — which
// spawn then looks for literally and cannot find.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Everything handed to the browser below is a **string**, never a function.
 *
 * `tsx` compiles this file with esbuild's `keepNames`, which rewrites a named
 * inner function as `__name(() => …, "name")` so it still reports its own name
 * in a stack trace. Playwright injects the *source* of a function argument into
 * the page — where `__name` has never been defined — and the page throws
 * `ReferenceError: __name is not defined`. It reads exactly like a bug in the
 * page: an uncaught error, on load, from code nobody wrote. A string is never
 * transformed, so it cannot pick the helper up.
 */


/** Somewhere with terrain, buildings and a long summer day. */
const EDINBURGH = { lat: 55.9533, lon: -3.1883 };
/** The solstice, so the sun is unambiguously up at every minute we ask about. */
const DATE = '2026-06-21';
/**
 * `t` is minutes into the *solar* day, so 720 is solar noon by construction —
 * no timezone arithmetic, and it stays noon whatever the date is changed to.
 */
const NOON = 720;

const SPOT =
  `/scout?at=${EDINBURGH.lat},${EDINBURGH.lon}&d=${DATE}&t=${NOON}` +
  `&tz=Europe/London&r=5&n=Edinburgh`;

const DEM_HOST = 's3.amazonaws.com/elevation-tiles-prod';

/**
 * The zoom at and above which a DEM tile can only be the height field's.
 *
 * Both the hillshade and `terrain-shadows.ts` pull from the same terrarium
 * tiles, so the host alone does not say who asked. The zoom does: at the world
 * view the basemap's own hillshade covers the globe from z2, while `chooseZoom`
 * never returns below its z7 floor — which is exactly how the storm happened,
 * z7 enumerated across a whole planet.
 */
const FIELD_ZOOM = 7;
const zoomOf = (url: string) => Number(url.match(/terrarium\/(\d+)\//)?.[1] ?? -1);

/** Long enough for a cold dev server and a real map; short enough to fail a CI run. */
const READY_MS = 90_000;

let server: ChildProcessWithoutNullStreams;
let origin: string;
let browser: Browser;

/** Start `astro dev` and wait for it to say where it is listening. */
function startServer(): Promise<string> {
  server = spawn(`${ROOT}node_modules/.bin/astro`, ['dev', '--port', '41731'], {
    cwd: ROOT,
    env: { ...process.env, BROWSER: 'none' },
  });
  return new Promise((resolve, reject) => {
    const fuse = setTimeout(() => reject(new Error('the dev server never came up')), READY_MS);
    server.on('error', reject);
    let log = '';
    const read = (chunk: Buffer) => {
      log += chunk.toString();
      // The scheme is not ours to assume: astro.config.mjs serves HTTPS when
      // certs/ exists (it does on the machine this was written on) and plain
      // HTTP when it does not (every CI runner). Take whatever it printed.
      const found = log.match(/(https?:\/\/localhost:\d+)\//);
      if (!found) return;
      clearTimeout(fuse);
      resolve(found[1]);
    };
    server.stdout.on('data', read);
    server.stderr.on('data', read);
    server.on('exit', (code) => reject(new Error(`the dev server exited with ${code}\n${log}`)));
  });
}

/**
 * What went wrong on the page, as the page would have told a person.
 *
 * Uncaught exceptions are collected as-is. Console errors are not: a tile
 * server answering 404 is logged as an error by the browser itself, and this
 * page pulls hundreds of tiles from hosts nobody here controls — failing the
 * run on those would make the guard flaky enough to be turned off, which is
 * worse than not having it. A resource that failed to load is left to the DEM
 * and drawing assertions, which measure what actually reached the screen.
 */
function watchForTrouble(page: Page) {
  const trouble: string[] = [];
  page.on('pageerror', (err) => trouble.push(`uncaught: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const from = msg.location().url;
    if (from && new URL(from).origin !== new URL(origin).origin) return;
    if (/Failed to load resource|net::ERR_/.test(msg.text())) return;
    trouble.push(`console: ${msg.text()}`);
  });
  return trouble;
}

/** Every request the page made to the terrarium DEM host. */
function watchDemTiles(page: Page) {
  const asked: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes(DEM_HOST)) asked.push(req.url());
  });
  return asked;
}

async function openPage() {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    // The dev server is HTTPS wherever certs/ exists, signed by a CA installed
    // on that machine and nowhere else — including in this browser.
    ignoreHTTPSErrors: true,
    // And `ignoreHTTPSErrors` does not extend to a service worker: registering
    // one fetches the script outside the page's leniency and fails on the same
    // certificate. Scout is not what the offline snapshot is tested through
    // (`src/lib/sw.test.ts` is), so keep it out of the way entirely rather than
    // teach this test to disregard a certificate error that is really there.
    serviceWorkers: 'block',
  });
  page.setDefaultTimeout(READY_MS);
  return page;
}

/**
 * Wait until MapLibre says it has nothing left to draw.
 *
 * One guarded expression rather than "wait for the handle, then wait for the
 * map". The dev server reloads the page when Vite discovers a dependency it has
 * not pre-bundled, and a reload between two waits leaves the second one
 * dereferencing a `window.scout` that existed a moment ago and does not now.
 * Every step has to tolerate the page having gone away underneath it.
 */
async function waitForTheMap(page: Page) {
  await page.waitForFunction(
    `!!(window.scout && window.scout.map()
        && window.scout.map().isStyleLoaded() && window.scout.map().loaded())`,
    null,
    { timeout: READY_MS },
  );
}

/**
 * The canvas as raw pixels.
 *
 * `preserveDrawingBuffer` is on (that is what "Save as an image" needs), so the
 * buffer is still there to be read after the frame is done. `redraw` forces
 * that frame synchronously rather than trusting the scheduler to have run.
 */
async function pixels(page: Page) {
  const dataUrl: string = await page.evaluate(
    `(() => {
       window.scout.tick();
       window.scout.map().redraw();
       return window.scout.map().getCanvas().toDataURL('image/png');
     })()`,
  );
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  return sharp(png).raw().toBuffer({ resolveWithObject: true });
}

/**
 * Read frames until two in a row agree, and return the still one.
 *
 * `map.loaded()` is not enough to compare two pictures: raster tiles fade in
 * over their own animation and symbols have their own, so a frame taken the
 * moment the map says it is done can differ from the next by half the screen.
 * Waiting for stillness is the only honest way to attribute a difference to the
 * one thing that was changed between the reads.
 */
const STILL = 64;

async function settle(page: Page, tries = 16) {
  let previous = await pixels(page);
  for (let i = 0; i < tries; i++) {
    const next = await pixels(page);
    const moved = differing(previous.data, next.data);
    if (moved < STILL) return { ...next, noise: moved };
    previous = next;
  }
  throw new Error('the map never stopped moving');
}

/** How many pixels differ, beyond the noise of an antialiased edge. */
function differing(a: Buffer, b: Buffer) {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d =
      Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 24) count++;
  }
  return count;
}

before(async () => {
  origin = await startServer();
  browser = await chromium.launch({
    // A CI runner has no GPU. Without these, MapLibre gets no WebGL context at
    // all and every drawing assertion below fails for a reason that has nothing
    // to do with this page.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

describe('/scout: the world view', () => {
  it('does not fetch a height field before a place is chosen', async () => {
    // It once asked for 24,450 elevation tiles here, and AWS answered 503 with
    // the basemap and the geocoder queued behind them. There is nothing to
    // shade until somewhere has been chosen, and a landform overlay across a
    // continent is a grey smear that tells a photographer nothing anyway.
    const page = await openPage();
    const trouble = watchForTrouble(page);
    const dem = watchDemTiles(page);
    await page.goto(`${origin}/scout`);
    await waitForTheMap(page);
    assert.deepEqual(trouble, []);

    const field = dem.filter((url) => zoomOf(url) >= FIELD_ZOOM);
    assert.deepEqual(field, [], 'the height field ran before anywhere was chosen');
    // The hillshade's own tiles, which are a dozen at this zoom. A bound rather
    // than a count: it is a function of the viewport and the projection, and
    // the failure being guarded against is three orders of magnitude away.
    assert.ok(dem.length < 32, `${dem.length} DEM tiles for one world view`);
    await page.close();
  });
});

describe('/scout: a spot, from a link', () => {
  let page: Page;
  let trouble: string[];

  before(async () => {
    page = await openPage();
    trouble = watchForTrouble(page);
    await page.goto(`${origin}${SPOT}`);
    await waitForTheMap(page);
    await page.waitForSelector('#panel:not([hidden])');
  });

  after(async () => {
    await page.close();
  });

  it('fills in the facts the whole page exists to state', async () => {
    await page.waitForFunction(
      `['c-azimuth', 'c-altitude'].every(
         (id) => (document.getElementById(id).textContent || '—').trim() !== '—')`,
    );
    const coords = await page.textContent('#f-coords');
    assert.match(coords ?? '', /55\.95/, `the pin is not where the link put it: ${coords}`);
    assert.deepEqual(trouble, []);
  });

  it('moves the sun when the time is scrubbed', async () => {
    const readSun = (): Promise<{ azimuth: string; altitude: string }> =>
      page.evaluate(
        `({ azimuth: document.getElementById('c-azimuth').textContent.trim(),
            altitude: document.getElementById('c-altitude').textContent.trim() })`,
      );
    const noon = await readSun();
    await page.evaluate(`window.scout.setMinute(${NOON + 240})`);
    await page.waitForFunction(
      `document.getElementById('c-azimuth').textContent.trim()
         !== ${JSON.stringify(noon.azimuth)}`,
    );
    const later = await readSun();
    assert.notEqual(later.azimuth, noon.azimuth);
    assert.notEqual(later.altitude, noon.altitude, 'four hours on, the sun is at another height');
    assert.deepEqual(trouble, []);
  });

  it('draws the sun path on the map, not just in the panel', async () => {
    // The guard for a shader that will not link. `u_halo` was declared with
    // mismatched precision once, the program returned null, and the sun's disc,
    // its halo, the moon marker and every hour bead disappeared with one
    // console warning as the only trace. Turning the layer off and comparing is
    // the cheapest way to ask "did that program put anything on the screen" —
    // and it says nothing about what colour any of it is, so it survives the
    // next time the look changes.
    const withPath = await settle(page);
    // Set directly rather than clicking: the toggle lives in a menu that may be
    // closed, and it is the change handler being tested, not the menu.
    await page.evaluate(
      `(() => {
         const box = document.getElementById('t-sunpath');
         box.checked = false;
         box.dispatchEvent(new Event('change', { bubbles: true }));
       })()`,
    );
    const withoutPath = await settle(page);

    assert.deepEqual(withPath.info, withoutPath.info, 'the two frames must be comparable');
    const changed = differing(withPath.data, withoutPath.data);
    // Measured over repeated runs: 844 to 4,155 pixels with the layer on, and
    // exactly 0 with it off. The arc is a thin mark on a wide map, so the signal
    // is smaller than it sounds, and the spread between runs is real rather than
    // understood — how much of the arc is on screen varies. So the bar sits well
    // under the lowest seen and still an order of magnitude above nothing, which
    // is the only distinction this test is entitled to make.
    const noise = Math.max(withPath.noise, withoutPath.noise);
    assert.ok(
      changed > Math.max(300, noise * 4),
      `turning the sun path off changed ${changed} pixels against ${noise} of noise; ` +
        'the layer is drawing nothing',
    );
    assert.deepEqual(trouble, []);
  });

  it('works out the light at every photographed spot, not just at the pin', async () => {
    // The join. Every part of it is invisible to `tsc` and to the unit tests:
    // the windows are computed against buildings that only exist once vector
    // tiles have arrived, and the list rows are built by script — which is the
    // exact shape of a bug this project has shipped, where a runtime-built
    // element matched no scoped rule and silently fell back to a UA default.
    await page.waitForFunction(`window.scout.spots().length > 0`, null, { timeout: READY_MS });

    const spots = (await page.evaluate(`window.scout.spots()`)) as Array<{
      windows: number;
      lit: boolean | null;
    }>;
    const computed = spots.filter((spot) => spot.windows > 0).length;
    assert.ok(
      computed === spots.length,
      `${computed} of ${spots.length} hotspots had their day computed; ` +
        'a spot with no windows is drawn as though nothing were known about it',
    );

    // Midnight is the one answer that needs no buildings, no terrain and no
    // agreement about a threshold to check: nowhere on earth is in direct sun
    // with the sun below the horizon. A pipeline that reported light here would
    // be wrong in a way no amount of geometry could excuse.
    await page.evaluate(`window.scout.setMinute(0)`);
    await page.waitForFunction(
      `window.scout.spots().every((spot) => spot.lit !== true)`,
      null,
      { timeout: READY_MS },
    );

    // And it has to *change*: a set of windows that never moves would pass the
    // test above by being uniformly dark.
    await page.evaluate(`window.scout.setMinute(${NOON})`);
    await page.waitForFunction(`window.scout.spots().some((spot) => spot.lit === true)`, null, {
      timeout: READY_MS,
    });

    const rows: { hidden: boolean; count: number; display: string | null } = await page.evaluate(
      `(() => {
         const first = document.querySelector('#best-list li');
         return {
           hidden: document.getElementById('best').hidden,
           count: document.querySelectorAll('#best-list li').length,
           // A row that matched no rule lays out as a list-item, not a grid.
           display: first ? getComputedStyle(first).display : null,
         };
       })()`,
    );
    assert.equal(rows.hidden, false, 'the ranked list is hidden with spots to rank');
    assert.ok(rows.count > 0, 'the ranked list has no rows');
    assert.equal(
      rows.display,
      'grid',
      'a list row fell back to the user agent default, so its scoped styles never reached it',
    );
    assert.deepEqual(trouble, []);
  });

  it('answers the core against the lens, and refuses the half that needs an aim', async () => {
    // Two claims, and the second is the one worth a browser. The shutter limit
    // needs only the body, so it is always offered; where the core falls in the
    // picture needs an aim, and an aim nobody chose is exactly the fabrication
    // this project refuses elsewhere. That gate is a `shown.frame` check in the
    // page and nothing in `astrophoto.ts` — so no unit test can see it.
    const readCore = () =>
      page.evaluate(
        `({ exposure: document.getElementById('core-exposure').textContent.trim(),
            frame: document.getElementById('core-frame').textContent.trim(),
            extent: document.getElementById('core-extent').textContent.trim() })`,
      ) as Promise<{ exposure: string; frame: string; extent: string }>;

    const withoutAim = await readCore();
    assert.match(
      withoutAim.exposure,
      /trails a single pixel/,
      `the shutter limit needs no aim and should be stated: "${withoutAim.exposure}"`,
    );
    // Edinburgh's default 24mm on a 33 MP full frame. Both inputs have to travel
    // with the number or nobody can check it.
    assert.match(withoutAim.exposure, /24mm/);
    assert.match(withoutAim.exposure, /µm/);
    assert.equal(withoutAim.frame, '', 'the core was placed in a frame nobody had aimed');
    assert.equal(withoutAim.extent, '');

    await page.evaluate(
      `(() => {
         const box = document.getElementById('t-frame');
         box.checked = true;
         box.dispatchEvent(new Event('change', { bubbles: true }));
       })()`,
    );
    await page.waitForFunction(
      `document.getElementById('core-frame').textContent.trim() !== ''`,
      null,
      { timeout: READY_MS },
    );

    // Point the camera at it. This is the "At the core" button, which aims at
    // where the core will be at the best moment of the night rather than at the
    // slider's minute — the sun and moon buttons cannot be asked that.
    //
    // Aiming first is also what makes the next two assertions mean anything. On
    // the default westward aim the core is ninety degrees off, its fifteen
    // degrees straddle the image plane, and the module correctly refuses to say
    // how much of it lands in shot.
    // Dispatched rather than clicked, for the reason the sun-path case gives:
    // the button lives inside the layers menu, which is closed, and it is the
    // handler being tested rather than the menu.
    await page.evaluate(`document.getElementById('aim-core').click()`);
    await page.waitForFunction(
      `document.getElementById('core-extent').textContent.includes('bright region')`,
      null,
      { timeout: READY_MS },
    );

    const withAim = await readCore();
    assert.match(withAim.frame, /In frame/i, `aimed straight at it and missed: "${withAim.frame}"`);
    assert.match(
      withAim.extent,
      /whole bright region is in the picture/,
      `a 15° core should fit a 24mm frame's 53°: "${withAim.extent}"`,
    );

    // Turning the camera has to move the answer. The lens-dependent half is
    // recomputed off a cached night rather than by re-running `coreNight`, and
    // a cache that was never invalidated would pass every assertion above.
    await page.evaluate(
      `(() => {
         const aim = document.getElementById('frame-bearing');
         aim.value = String((Number(aim.value) + 90) % 360);
         aim.dispatchEvent(new Event('input', { bubbles: true }));
       })()`,
    );
    const turned = await readCore();
    assert.notEqual(
      turned.frame,
      withAim.frame,
      'turning the camera ninety degrees left the framing answer unchanged',
    );
    assert.deepEqual(trouble, []);
  });

  it('reaches the whole Milky Way answer from one button', async () => {
    // The affordance, not the arithmetic. Everything this switches on was
    // reachable before and none of it was findable — and every part of that is
    // page wiring, which is precisely what no unit test can see.
    //
    // Both layers off first, so the button is being measured rather than
    // whatever the previous test left behind.
    await page.evaluate(
      `(() => {
         for (const id of ['t-core', 't-frame']) {
           const box = document.getElementById(id);
           if (box.checked) {
             box.checked = false;
             box.dispatchEvent(new Event('change', { bubbles: true }));
           }
         }
         document.getElementById('fold-core').open = false;
       })()`,
    );

    await page.click('#night-button');
    await page.waitForFunction(
      `document.getElementById('core-frame').textContent.trim() !== ''`,
      null,
      { timeout: READY_MS },
    );

    const on = await page.evaluate(
      `({ pressed: document.getElementById('night-button').getAttribute('aria-pressed'),
          fold: document.getElementById('fold-core').open,
          arc: document.getElementById('t-core').checked,
          frame: document.getElementById('t-frame').checked,
          extent: document.getElementById('core-extent').textContent.trim() })`,
    ) as { pressed: string; fold: boolean; arc: boolean; frame: boolean; extent: string };

    assert.equal(on.pressed, 'true', 'the button does not show as held down');
    assert.equal(on.fold, true, 'the panel section stayed shut, which is where all the text is');
    assert.equal(on.arc, true, 'the arc layer was not switched on');
    assert.equal(on.frame, true, 'the frame layer was not switched on, so the framing stays silent');
    // Pressing it also aims at the core, so the region must be placed rather
    // than refused — a refusal here means the aim never happened.
    assert.match(
      on.extent,
      /whole bright region is in the picture/,
      `pressing the button did not point the camera at it: "${on.extent}"`,
    );

    // And it has to be leavable. Both layers were off before the press, so both
    // must be off after the second one.
    await page.click('#night-button');
    const off = await page.evaluate(
      `({ pressed: document.getElementById('night-button').getAttribute('aria-pressed'),
          fold: document.getElementById('fold-core').open,
          arc: document.getElementById('t-core').checked,
          frame: document.getElementById('t-frame').checked })`,
    ) as { pressed: string; fold: boolean; arc: boolean; frame: boolean };

    assert.equal(off.pressed, 'false');
    assert.equal(off.fold, false);
    assert.equal(off.arc, false, 'leaving night mode left the arc behind');
    assert.equal(off.frame, false, 'leaving night mode left the frame behind');
    assert.deepEqual(trouble, []);
  });

  it('gives back only the layers it borrowed', async () => {
    // The trap in a mode button: someone with the frame already up to compose a
    // sunset glances at the Milky Way, and leaving takes their frame away with
    // it. Off must restore what was there, not what the mode assumes was there.
    await page.evaluate(
      `(() => {
         const frame = document.getElementById('t-frame');
         if (!frame.checked) {
           frame.checked = true;
           frame.dispatchEvent(new Event('change', { bubbles: true }));
         }
         const arc = document.getElementById('t-core');
         if (arc.checked) {
           arc.checked = false;
           arc.dispatchEvent(new Event('change', { bubbles: true }));
         }
       })()`,
    );

    await page.click('#night-button');
    await page.click('#night-button');

    const after = await page.evaluate(
      `({ arc: document.getElementById('t-core').checked,
          frame: document.getElementById('t-frame').checked })`,
    ) as { arc: boolean; frame: boolean };

    assert.equal(after.frame, true, 'the frame was already up and the mode took it away');
    assert.equal(after.arc, false, 'the arc was off and the mode left it on');
    assert.deepEqual(trouble, []);
  });
});
