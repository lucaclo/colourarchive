/**
 * "Go tonight", in the panel.
 *
 * `go-tonight.ts` answers the question in the abstract: given a spot's
 * nearest alignment and the two forecasts around it, is this one confirmed
 * clear? This is where every kept spot with an aimed frame actually gets
 * checked and the single soonest confirmed one becomes a row to press —
 * `goTo` moving the page to both the place and the moment, the same
 * contract `alignment-panel.ts` and `kept-list`'s own rows keep.
 *
 * Checking is a deliberate button press, not automatic on every visit: up to
 * `MAX_SPOTS` kept places, each a two-request forecast fetch, is a real
 * burst against a free service — worth doing when asked, not on every open
 * of a fold.
 *
 * Self-contained: it owns the `#fold-tonight` block.
 */

import { bestGoTonight, evaluateGoTonight, type GoTonightOpportunity } from '../go-tonight';
import type { SavedSpot } from '../spots';
import type { WeatherReport } from '../weather';
import { $, on } from './dom';

export interface GoTonightPair {
  pin: WeatherReport | null;
  gate: WeatherReport | null;
}

export interface GoTonightPorts {
  keptSpots(): SavedSpot[];
  from(): Date;
  /** The pin/gate forecast pair for a spot's own kept bearing. Network — the
   *  caller owns the transport, same split `loadWeather` keeps in page.ts. */
  fetchPair(spot: SavedSpot): Promise<GoTonightPair>;
  /** Move the map to this spot, the same path a kept-spot row takes. */
  goToSpot(spot: SavedSpot): void;
  /** Move the time slider to this instant. */
  goToInstant(instant: Date): void;
}

export interface GoTonightPanel {
  restate(): void;
}

const fmtDate = (at: Date) => at.toISOString().slice(0, 10);

export function createGoTonightPanel(ports: GoTonightPorts): GoTonightPanel {
  let checking = false;

  const button = () => $<HTMLButtonElement>('tonight-run');
  const note = () => $<HTMLElement>('tonight-note');
  const pick = () => $<HTMLElement>('tonight-pick');

  /** The idle state — before a check has been run, or after the count of
   *  aimed spots changed under it (a spot kept or forgotten elsewhere). */
  function render() {
    if (checking) return; // `check()` owns the message while one is running.
    const aimed = ports.keptSpots().filter((spot) => spot.frame);
    pick().replaceChildren();
    button().disabled = aimed.length === 0;
    note().textContent =
      aimed.length === 0
        ? 'Keep a spot with a lens aimed — the star on a spot, with Behind a target on — to get an answer here.'
        : `Press “Check tonight” to weigh ${aimed.length} kept spot${aimed.length === 1 ? '' : 's'} against this week’s forecast.`;
  }

  function renderPick(best: GoTonightOpportunity, checked: number) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tonight-row';
    const head = document.createElement('span');
    head.className = 'tonight-head';
    head.textContent = `${best.spot.name} — ${fmtDate(best.alignment.best.at)}`;
    const detail = document.createElement('span');
    detail.className = 'tonight-detail';
    detail.textContent = best.note;
    row.append(head, detail);
    row.addEventListener('click', () => {
      ports.goToSpot(best.spot);
      ports.goToInstant(best.alignment.best.at);
    });
    pick().replaceChildren(row);
    note().textContent = `1 of ${checked} checked opportunit${checked === 1 ? 'y is' : 'ies are'} confirmed clear.`;
  }

  async function check() {
    const aimed = ports.keptSpots().filter((spot) => spot.frame);
    if (!aimed.length || checking) return;
    checking = true;
    pick().replaceChildren();
    button().disabled = true;
    note().textContent = `Checking ${aimed.length} kept spot${aimed.length === 1 ? '' : 's'}…`;

    const from = ports.from();
    const opportunities: GoTonightOpportunity[] = [];
    await Promise.all(
      aimed.map(async (spot) => {
        let pair: GoTonightPair;
        try {
          pair = await ports.fetchPair(spot);
        } catch {
          pair = { pin: null, gate: null };
        }
        for (const body of ['sun', 'moon'] as const) {
          const opportunity = evaluateGoTonight(spot, body, from, pair.pin, pair.gate);
          if (opportunity) opportunities.push(opportunity);
        }
      }),
    );

    checking = false;
    button().disabled = ports.keptSpots().filter((spot) => spot.frame).length === 0;

    const best = bestGoTonight(opportunities);
    if (best) {
      renderPick(best, opportunities.length);
    } else if (opportunities.length) {
      const nearest = opportunities.reduce((a, b) =>
        a.alignment.best.at.getTime() <= b.alignment.best.at.getTime() ? a : b,
      );
      note().textContent = `None of ${opportunities.length} checked opportunities are confirmed clear yet. Nearest: ${nearest.spot.name} — ${nearest.note}`;
    } else {
      note().textContent = 'No kept spot has a meeting alignment in the year ahead.';
    }
  }

  on('tonight-run', 'click', () => void check());
  render();

  return { restate: render };
}
