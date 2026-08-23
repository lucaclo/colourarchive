/**
 * A light sweep, baked into a video — issue #65.
 *
 * `sweep.ts` says which instants to render; this is where they actually get
 * rendered and captured. No new drawing: every frame's *content* is
 * produced by driving the page through exactly what `goToInstant` already
 * does for a dragged slider, then reading back the same canvas the
 * existing PNG export already reads (`preserveDrawingBuffer` was already on
 * for that reason).
 *
 * **A second canvas is what gets recorded, not the map's own.** Redrawing a
 * shadow cast or a dome pass takes a different amount of time on every
 * instant, and a real-time capture of the live map would bake that
 * unevenness straight into the clip's timing. So each instant is drawn onto
 * the map canvas as usual, then copied once (`drawImage`) onto a plain,
 * otherwise-untouched canvas — and that copy, not the map, is what
 * `captureStream` records. Decoupling the two is what lets the clip's
 * timing be "one frame every `1000/fps` ms" instead of "one frame every
 * however long that instant took to draw".
 *
 * **How a frame's duration stays controlled.** `captureStream(0)` puts the
 * recording canvas's track in manual mode — no frame leaves it until
 * `track.requestFrame()` is called — so between two calls the recorded
 * stream shows nothing new no matter how long the page waits. The loop
 * below waits for the map to reach `idle` (a complete frame, not a
 * half-drawn one — the same signal the PNG export already trusts), copies
 * it across, requests the frame, and paces the *next* one off a running
 * schedule rather than a fresh stopwatch each time — so a single slow
 * instant costs that one frame's slack rather than compounding into a clip
 * that runs later and later as it goes.
 *
 * **Refuses rather than guessing.** `captureStream`, `MediaRecorder` and
 * `requestFrame` on a captured track are three different, independently
 * shippable browser features, and Safari's coverage of the third has been
 * inconsistent. Every one is checked before anything starts, and a missing
 * one is one sentence, not a silent failure or a corrupt file.
 *
 * Self-contained: it owns the `#fold-sweep` block, the same contract every
 * other panel in this directory keeps — except the download, which reuses
 * the page's one `#download` anchor exactly as the PNG export already does.
 */

import { sweepFrameCount, sweepInstants, sweepRange, SWEEP_FRAME_RATES, type SweepSpan } from '../sweep';
import { $, on } from './dom';

export interface SweepExportPorts {
  canvas(): HTMLCanvasElement | null;
  /** Resolves once a complete frame has been drawn — mirrors the existing
   *  PNG export's `map.once('idle', ...); map.triggerRepaint();`. */
  waitForFrame(): Promise<void>;
  goToInstant(instant: Date): void;
  dayStart(): Date;
  /** The instant currently on screen — the season span is bracketed around this. */
  now(): Date;
  /** For the downloaded filename, same fallback the PNG export already uses. */
  locationLabel(): string;
}

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

const extensionFor = (mimeType: string): string => (mimeType.startsWith('video/mp4') ? 'mp4' : 'webm');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createSweepExport(ports: SweepExportPorts): void {
  let span: SweepSpan = 'day';
  let running = false;

  const note = (text: string) => {
    $('sweep-note').textContent = text;
  };

  const fpsSelect = $<HTMLSelectElement>('sweep-fps');
  for (const fps of SWEEP_FRAME_RATES) fpsSelect.append(new Option(`${fps} fps`, String(fps)));
  fpsSelect.value = '24';

  const updateLengthOut = () => {
    $('sweep-length-out').textContent = `${$<HTMLInputElement>('sweep-length').value} s`;
  };
  updateLengthOut();
  on('sweep-length', 'input', updateLengthOut);

  on('sweep-span', 'click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-span]');
    if (!button) return;
    span = button.dataset.span as SweepSpan;
    for (const other of $('sweep-span').querySelectorAll('button')) {
      other.classList.toggle('on', other === button);
    }
  });

  async function run() {
    if (running) return;
    const canvas = ports.canvas();
    if (!canvas) {
      note('No map to export yet.');
      return;
    }
    const mimeType = pickMimeType();
    if (!mimeType || typeof canvas.captureStream !== 'function') {
      note('Video export isn’t supported in this browser.');
      return;
    }

    // A second, plain canvas — recorded instead of the map's own — so the
    // output's timing reflects the requested rate rather than however long
    // each instant actually took to redraw. The map canvas is only ever
    // *read from* (via `drawImage`, below), once per instant, after it
    // reports a complete frame.
    const recordCanvas = document.createElement('canvas');
    recordCanvas.width = canvas.width;
    recordCanvas.height = canvas.height;
    const recordCtx = recordCanvas.getContext('2d');
    if (!recordCtx) {
      note('Video export isn’t supported in this browser.');
      return;
    }

    const stream = recordCanvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    if (!track || typeof track.requestFrame !== 'function') {
      note('Video export isn’t supported in this browser.');
      return;
    }

    const fps = Number(fpsSelect.value) || SWEEP_FRAME_RATES[0];
    const clipLengthSeconds = Number($<HTMLInputElement>('sweep-length').value);
    const frameCount = sweepFrameCount(clipLengthSeconds, fps);
    const { from, to } = sweepRange(span, ports.dayStart(), ports.now());
    const instants = sweepInstants(from, to, frameCount);

    running = true;
    $<HTMLButtonElement>('sweep-run').disabled = true;

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    try {
      recorder.start();
      const frameIntervalMs = 1000 / fps;
      // A running schedule rather than a fixed sleep per frame: if one
      // instant's redraw (a shadow recast, say) runs long, the next frame is
      // simply captured without an extra wait rather than the whole clip
      // drifting later by the overrun — the drift a fixed per-frame sleep
      // would accumulate silently.
      let nextFrameAt = performance.now();
      for (let i = 0; i < instants.length; i++) {
        ports.goToInstant(instants[i]);
        await ports.waitForFrame();
        recordCtx.drawImage(canvas, 0, 0, recordCanvas.width, recordCanvas.height);
        track.requestFrame();
        note(`Rendering… ${i + 1} / ${instants.length}`);
        nextFrameAt += frameIntervalMs;
        const delay = nextFrameAt - performance.now();
        if (delay > 0) await sleep(delay);
      }
    } finally {
      recorder.stop();
      await stopped;
      running = false;
      $<HTMLButtonElement>('sweep-run').disabled = false;
    }

    if (!chunks.length) {
      note('Nothing was captured — try again.');
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = $<HTMLAnchorElement>('download');
    link.href = url;
    const place = (ports.locationLabel() || 'scout').replace(/[^\w-]+/g, '-').toLowerCase();
    link.download = `${place}-${span}-sweep.${extensionFor(mimeType)}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    note(`Done — ${instants.length} frames at ${fps} fps, ${clipLengthSeconds} s.`);
  }

  on('sweep-run', 'click', () => void run());
}
