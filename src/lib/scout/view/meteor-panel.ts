/**
 * Meteor showers, in the panel. Owns `#fold-meteor`, the same contract the
 * aurora and go-tonight folds keep, and is built the first time the fold
 * opens.
 *
 * It follows the page's date, like the Milky Way core does: the shower worth
 * talking about is the busiest one active that night, else the next to peak,
 * and the night is read at the pin with its own sky brightness.
 */

import { meteorNight, upcomingShowers, type MeteorNight } from '../meteor';
import { formatClock, isoDateIn, zonedNoon } from '../daylight';
import type { LatLon } from '../geo';
import { $ } from './dom';

export interface MeteorPanelPorts {
  centre(): LatLon | null;
  lightPollutionZone(): number | null;
  /** Any instant on the page's chosen day. */
  day(): Date;
  timeZone(): string;
  goTo(instant: Date): void;
}

export interface MeteorPanel { restate(): void }

function dayMonth(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz });
  return fmt.format(d);
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function createMeteorPanel(ports: MeteorPanelPorts): MeteorPanel {
  const line = $('meteor-line');
  const when = $('meteor-when');
  const moon = $('meteor-moon');
  const list = $<HTMLDListElement>('meteor-list');
  const go = $<HTMLButtonElement>('meteor-go');
  let best: Date | null = null;
  go.addEventListener('click', () => { if (best) ports.goTo(best); });

  function restate() {
    const at = ports.centre();
    const tz = ports.timeZone();
    const day = ports.day();
    const upcoming = upcomingShowers(day);
    list.replaceChildren(
      ...upcoming.flatMap((u) => {
        const dt = document.createElement('dt');
        dt.textContent = u.shower.name;
        const dd = document.createElement('dd');
        dd.textContent = u.active ? `now · peak ${dayMonth(u.peak, tz)}` : dayMonth(u.peak, tz);
        return [dt, dd];
      }),
    );
    best = null;
    go.hidden = true;
    if (!at) { line.textContent = '—'; when.textContent = ''; moon.textContent = ''; return; }

    const active = upcoming.filter((u) => u.active);
    if (!active.length) {
      const next = upcoming[0];
      line.textContent = `${next.shower.name} in ${plural(Math.ceil(next.days), 'day')}`;
      when.textContent = `Peak ${dayMonth(next.peak, tz)}`;
      moon.textContent = '';
      return;
    }
    // Several showers overlap most of the year; lead with the one that gives
    // the most tonight at this pin, not the one with the biggest name.
    const noon = zonedNoon(isoDateIn(day, tz), tz);
    const zone = ports.lightPollutionZone();
    const nights: MeteorNight[] = active.map((u) => meteorNight(u.shower, at.lat, at.lon, noon, zone));
    const night = nights.reduce((a, b) => ((b.best?.rate ?? 0) > (a.best?.rate ?? 0) ? b : a));
    if (night.neverUp || !night.best) {
      line.textContent = `${night.shower.name}: not visible from here`;
      when.textContent = '';
      moon.textContent = '';
      return;
    }
    const r = night.best.rate;
    line.textContent = `${night.shower.name} · ${r < 1 ? 'under 1' : `~${Math.round(r)}`} an hour at best`;
    when.textContent = night.window
      ? `Dark with the radiant up ${formatClock(night.window.start, tz)}–${formatClock(night.window.end, tz)} · best ${formatClock(night.best.at, tz)}`
      : `Best ${formatClock(night.best.at, tz)}`;
    const pct = Math.round(night.moon.fraction * 100);
    moon.textContent = `Moon ${pct}%, ${night.moon.upAtBest ? 'up' : 'down'} at the best hour`;
    best = night.best.at;
    go.hidden = false;
  }

  return { restate };
}
