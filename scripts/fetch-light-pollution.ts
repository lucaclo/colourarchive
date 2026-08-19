/**
 * Vendor a downsampled global light-pollution raster into public/data.
 *
 * Issue #46: `galactic.ts` finds the moon-free window but has no way to say
 * "and the sky itself is too bright for the core to be worth it" — a national
 * park and a city centre read identically because nothing here knows which is
 * which. No source of that publishes with CORS headers for a live fetch (see
 * `galactic.ts`'s own note), but light pollution is a *static* property of a
 * place — it drifts over years, not over a night — so it does not need a live
 * dependency at all. One bundled raster, fetched once here, answers it forever.
 *
 * The source is the New World Atlas of Artificial Night Sky Brightness
 * (Falchi et al. 2016), the paper the "Bortle-conflation" warning in
 * `galactic.ts` already points a reader away from — published by GFZ Potsdam
 * under CC BY-NC 4.0 (https://doi.org/10.5880/GFZ.1.4.2016.001), which is
 * compatible with this archive's own non-commercial use. The KMZ export is
 * an equirectangular-tiled colour-coded map at web-viewing resolution: 732
 * `GroundOverlay` tiles, each an ordinary JPEG with a `LatLonBox`. That is
 * mosaicked here straight onto the output grid — every tile is resized to
 * exactly the pixel footprint its own LatLonBox covers, so no separate
 * "stitch then downsample" pass is needed — and every pixel is then reduced
 * from an RGB colour to a small integer against the atlas's own published
 * "Light Pollution Zone" scale (`ZONE_PALETTE` below), which is what
 * `light-pollution.ts` actually samples at runtime.
 *
 * Run this only when the atlas is revised (it is not going anywhere; Falchi
 * et al. 2016 is not superseded lightly) or the output resolution needs to
 * change:
 *
 *   npm run light-pollution
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../src/lib/paths';

const KMZ_URL =
  'https://datapub.gfz.de/download/10.5880.GFZ.1.4.2016.001/NewWorldAtlas_ArtificialSkyBrightness.kmz';

const OUT_PATH = path.join(ROOT, 'public', 'data', 'light-pollution.png');

/** Degrees per pixel, both axes — 0.25° is ~28 km at the equator, which is
 *  coarser than the atlas's own native 30 arcsecond grid by a wide margin
 *  and still far finer than a light-pollution zone needs: a metro area is one
 *  blob at any resolution finer than "which city". */
const OUT_WIDTH = 1440;
const OUT_HEIGHT = 720;

/**
 * The atlas's own "Light Pollution Zone" colour scale, darkest to brightest,
 * read directly off its published colour key (djlorenz.github.io/astronomy/
 * lp/colors.html, the same convention Cinzano's original atlas and Falchi's
 * 2016 revision both use). Each step is a further ×√3 in the ratio of
 * artificial to natural sky brightness at zenith (the "Light Pollution
 * Index"); two steps make the ×3 the atlas calls a full zone. Index 0 is
 * every ocean pixel too, which the JPEGs render as flat black rather than as
 * a distinct "no data" colour — treating open ocean as the darkest class is
 * the honest answer for this app's purposes anyway.
 *
 * `light-pollution.ts` classifies by nearest colour in this list; JPEG
 * ringing around tile edges lands a handful of pixels one class off centre,
 * which a "how dark is the region around here" query neither notices nor
 * cares about.
 */
export const ZONE_PALETTE: Array<[number, number, number]> = [
  [34, 34, 34],
  [66, 66, 66],
  [20, 47, 114],
  [33, 84, 216],
  [15, 87, 20],
  [31, 161, 42],
  [110, 100, 30],
  [184, 166, 37],
  [191, 100, 30],
  [253, 150, 80],
  [251, 90, 73],
  [251, 153, 138],
  [160, 160, 160],
  [242, 242, 242],
];

function nearestZone(r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ZONE_PALETTE.length; i++) {
    const [pr, pg, pb] = ZONE_PALETTE[i];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

interface Tile {
  href: string;
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Regex, not an XML parser — `doc.kml` is machine-generated and completely
 *  regular, the same reasoning `fetch-fonts.ts` already applies to Google's
 *  CSS response. */
function parseTiles(kml: string): Tile[] {
  const tiles: Tile[] = [];
  const blockRe = /<GroundOverlay>([\s\S]*?)<\/GroundOverlay>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(kml))) {
    const block = m[1];
    const href = /<href>([^<]+)<\/href>/.exec(block)?.[1];
    const north = /<north>([^<]+)<\/north>/.exec(block)?.[1];
    const south = /<south>([^<]+)<\/south>/.exec(block)?.[1];
    const east = /<east>([^<]+)<\/east>/.exec(block)?.[1];
    const west = /<west>([^<]+)<\/west>/.exec(block)?.[1];
    if (!href || !north || !south || !east || !west) continue;
    tiles.push({ href, north: Number(north), south: Number(south), east: Number(east), west: Number(west) });
  }
  return tiles;
}

const lonToX = (lon: number) => Math.round(((lon + 180) / 360) * OUT_WIDTH);
const latToY = (lat: number) => Math.round(((90 - lat) / 180) * OUT_HEIGHT);

async function main() {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'light-pollution-'));
  try {
    console.error('Downloading the atlas KMZ (~26 MB, CC BY-NC 4.0, Falchi et al. 2016)…');
    const kmzPath = path.join(workDir, 'atlas.kmz');
    const res = await fetch(KMZ_URL);
    if (!res.ok) throw new Error(`GFZ Potsdam returned ${res.status}`);
    await fs.writeFile(kmzPath, Buffer.from(await res.arrayBuffer()));

    console.error('Unzipping…');
    execFileSync('unzip', ['-oq', kmzPath, '-d', workDir]);

    const kml = await fs.readFile(path.join(workDir, 'doc.kml'), 'utf8');
    const tiles = parseTiles(kml);
    if (tiles.length < 100) throw new Error(`only found ${tiles.length} tiles — doc.kml may have changed shape`);
    console.error(`${tiles.length} tiles. Mosaicking onto a ${OUT_WIDTH}x${OUT_HEIGHT} grid…`);

    // Every ocean/no-data pixel the tiles don't cover (the poles, mainly)
    // starts at class 0 — see ZONE_PALETTE's own note on why that is the
    // honest default rather than a distinct "unknown" sentinel.
    const base = Buffer.alloc(OUT_WIDTH * OUT_HEIGHT, 0);
    let placed = 0;
    for (const tile of tiles) {
      const left = lonToX(tile.west);
      const right = lonToX(tile.east);
      const top = latToY(tile.north);
      const bottom = latToY(tile.south);
      const w = right - left;
      const h = bottom - top;
      if (w <= 0 || h <= 0) continue;

      const raw = await sharp(path.join(workDir, 'files', path.basename(tile.href)))
        .resize(w, h, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { data, info } = raw;
      for (let y = 0; y < h; y++) {
        const destRow = top + y;
        if (destRow < 0 || destRow >= OUT_HEIGHT) continue;
        for (let x = 0; x < w; x++) {
          const destCol = left + x;
          if (destCol < 0 || destCol >= OUT_WIDTH) continue;
          const p = (y * w + x) * info.channels;
          const zone = nearestZone(data[p], data[p + 1], data[p + 2]);
          base[destRow * OUT_WIDTH + destCol] = zone;
        }
      }
      placed++;
    }
    console.error(`${placed} tiles placed.`);

    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
    // `toColourspace('b-w')` is what actually keeps this single-channel on
    // disk — sharp's default PNG encode upconverts a raw 1-channel buffer to
    // RGB regardless of `channels: 1` on the input, tripling the file for
    // nothing. The browser-side loader reads it back through a canvas, which
    // hands back RGBA regardless of the source depth, so this only ever
    // matters for how many bytes ship.
    await sharp(base, { raw: { width: OUT_WIDTH, height: OUT_HEIGHT, channels: 1 } })
      .toColourspace('b-w')
      .png({ compressionLevel: 9, palette: false })
      .toFile(OUT_PATH);

    const stat = await fs.stat(OUT_PATH);
    console.error(`Wrote ${path.relative(ROOT, OUT_PATH)}, ${(stat.size / 1024).toFixed(1)} kB.`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
