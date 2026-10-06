import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { starsFor, bandDistance, seeded, globeFillsView } from './space';

describe('the galaxy round the globe', () => {
  it('is the same sky every time', () => {
    assert.deepEqual(starsFor(800, 600), starsFor(800, 600));
    assert.equal(seeded(3)(), seeded(3)());
  });

  it('crowds its stars towards the Milky Way band', () => {
    const w = 1200;
    const h = 800;
    const stars = starsFor(w, h);
    const near = stars.filter((s) => bandDistance(s.x, s.y, w, h) < 0.5).length;
    const far = stars.filter((s) => bandDistance(s.x, s.y, w, h) > 2 && bandDistance(s.x, s.y, w, h) < 2.5).length;
    assert.ok(near > far * 2, `near ${near}, far ${far}`);
  });

  it('keeps most stars faint, as the real sky does', () => {
    const stars = starsFor(1000, 700);
    const bright = stars.filter((s) => s.r > 1.4).length;
    assert.ok(bright > 0 && bright < stars.length * 0.03);
  });
});

describe('when the space can be seen', () => {
  it('shows round a small globe and hides once the globe fills the view', () => {
    assert.equal(globeFillsView(1.5, 1366, 1024), false);
    assert.equal(globeFillsView(6, 1366, 1024), true);
    // A bigger screen needs a closer zoom before the globe covers it.
    assert.equal(globeFillsView(3.6, 1366, 1024), true);
    assert.equal(globeFillsView(3.6, 2732, 2048), false);
  });
});
