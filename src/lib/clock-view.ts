/**
 * The colour clock on screen (issue #145): one photograph at a time, full
 * screen with no chrome, slow fades, the screen kept awake, and the archive
 * following the light outside (colour-clock.ts decides which photos). Tap
 * once for the caption, twice to leave; Esc leaves too.
 *
 * Works on the static site as well: the sun is computed here (scout/sun.ts),
 * and the cloud comes straight from Open-Meteo, as the static Scout does.
 */
import { lightPhase, nextFrame, phaseFromClock, poolFor, PHASE_WORD, type ClockFrame, type LightPhase } from './colour-clock';
import { sunPosition } from './scout/sun';
import { cloudStructure, hourAt } from './scout/weather';
import { fetchForecastDirect } from './scout/browser/sources';

export interface ClockPhoto extends ClockFrame { src: string; caption: string }

const HOLD_MS = 60_000;
const RECHECK_MS = 5 * 60_000;
const FADE_MS = 4000;
const AT_KEY = 'ca-clock-at';

function where(): Promise<{ lat: number; lon: number } | null> {
  let saved: { lat: number; lon: number } | null = null;
  try { saved = JSON.parse(localStorage.getItem(AT_KEY) || 'null'); } catch { /* private mode */ }
  if (!('geolocation' in navigator)) return Promise.resolve(saved);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        try { localStorage.setItem(AT_KEY, JSON.stringify(at)); } catch { /* private mode */ }
        resolve(at);
      },
      () => resolve(saved),
      { timeout: 8000, maximumAge: 3600_000 },
    );
  });
}

async function currentPhase(at: { lat: number; lon: number } | null): Promise<LightPhase> {
  const now = new Date();
  if (!at) return phaseFromClock(now.getHours());
  const altitude = sunPosition(at.lat, at.lon, now).altitude;
  let flat = false;
  if (altitude >= 6) {
    try { flat = cloudStructure(hourAt(await fetchForecastDirect(at.lat, at.lon), now)).flat; } catch { /* sun alone, then */ }
  }
  return lightPhase(altitude, flat);
}

export function openColourClock(photos: ClockPhoto[], onClose?: () => void): void {
  if (!photos.length) return;
  const root = document.createElement('div');
  root.className = 'cclock';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Colour clock. Tap twice or press Escape to leave.');
  const layers = [document.createElement('img'), document.createElement('img')];
  for (const img of layers) { img.alt = ''; img.className = 'cclock-img'; root.append(img); }
  const caption = document.createElement('p');
  caption.className = 'cclock-caption';
  caption.hidden = true;
  root.append(caption);
  document.body.append(root);
  document.documentElement.classList.add('cclock-on');

  let phase: LightPhase = 'day';
  let pool: ClockPhoto[] = photos;
  let current: ClockPhoto | null = null;
  let front = 0;
  let at: { lat: number; lon: number } | null = null;
  let lock: WakeLockSentinel | null = null;

  const show = () => {
    const next = nextFrame(pool, current?.id ?? null) as ClockPhoto | null;
    if (!next) return;
    current = next;
    const img = layers[1 - front];
    img.onload = () => {
      img.classList.add('on');
      layers[front].classList.remove('on');
      front = 1 - front;
    };
    img.src = next.src;
    caption.textContent = `${next.caption} · ${PHASE_WORD[phase]}`;
  };
  const recheck = async () => {
    const was = phase;
    phase = await currentPhase(at);
    pool = poolFor(phase, photos) as ClockPhoto[];
    if (phase !== was || !current) show();
  };

  const wake = async () => {
    try { lock = await navigator.wakeLock?.request('screen') ?? null; } catch { lock = null; }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') void wake(); };
  document.addEventListener('visibilitychange', onVisible);

  const holdTimer = setInterval(show, HOLD_MS);
  const phaseTimer = setInterval(() => void recheck(), RECHECK_MS);

  let tapTimer = 0;
  const close = () => {
    clearInterval(holdTimer);
    clearInterval(phaseTimer);
    clearTimeout(tapTimer);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKey);
    void lock?.release().catch(() => {});
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    root.remove();
    document.documentElement.classList.remove('cclock-on');
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', () => {
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = 0; close(); return; }
    tapTimer = window.setTimeout(() => { tapTimer = 0; caption.hidden = !caption.hidden; }, 300);
  });

  root.style.setProperty('--fade', `${FADE_MS}ms`);
  void root.requestFullscreen?.().catch(() => {});
  void wake();
  void (async () => {
    // A photo straight away from the clock's guess, then the real light.
    phase = phaseFromClock(new Date().getHours());
    pool = poolFor(phase, photos) as ClockPhoto[];
    show();
    at = await where();
    await recheck();
  })();
}
