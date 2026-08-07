/**
 * Finding a place by typing its name.
 *
 * A combobox, and the accessibility of one is the whole reason it is not three
 * lines: the field owns `aria-expanded`, each result is an `option` with
 * `aria-selected`, the arrows move a highlight that the pointer never sees, and
 * Enter takes whichever result is highlighted or the first if none is. Every
 * one of those is state that has to stay in step with the list on screen, so
 * the list and the state are owned together, here, rather than by the page.
 *
 * The page keeps two jobs it cannot delegate: what to *do* with a chosen place,
 * and the kept-spots list, which appears only while the field is empty and so
 * has to be told whenever what is typed changes.
 */

import { getScoutJson, type Place } from './scout-api';
import { $, on } from './dom';

export interface SearchBoxPorts {
  /** A place was chosen, by pointer or by Enter. */
  onChoose(place: Place): void;
  /**
   * What is typed has changed, or the box has been opened or shut.
   *
   * The kept list belongs to an empty field — with a query typed, the results
   * below are what was asked for and the kept list would be arguing with them.
   */
  onQueryChanged(): void;
}

export interface SearchBox {
  /** What is typed, trimmed. */
  query(): string;
  /** Put a name in the field, without searching for it. */
  setQuery(text: string): void;
  /** Whether the box itself is open, which is not whether results are showing. */
  isOpen(): boolean;
  /** Open the box, for the page that starts with nowhere chosen. */
  show(): void;
  /** Shut the box. Used when a spot is chosen some other way. */
  hide(): void;
  /** Shut the results list, leaving the field as it is. */
  closeResults(): void;
  focus(): void;
}

/**
 * Nominatim asks for no more than a request a second, and a person types
 * faster than that. Wait for a pause rather than sending one per keystroke.
 */
const DEBOUNCE_MS = 350;

/** Below this, a query is too vague to be worth a round trip. */
const MIN_QUERY = 2;

export function createSearchBox(ports: SearchBoxPorts): SearchBox {
  const placeInput = $<HTMLInputElement>('place');
  const resultsEl = $<HTMLUListElement>('place-results');
  let searchToken = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let results: Place[] = [];
  let highlighted = -1;

  const box = () => $<HTMLElement>('searchbox');

  const closeResults = () => {
    resultsEl.hidden = true;
    placeInput.setAttribute('aria-expanded', 'false');
    highlighted = -1;
  };

  function showMessage(text: string, isError = false) {
    results = [];
    highlighted = -1;
    resultsEl.replaceChildren(
      Object.assign(document.createElement('li'), {
        className: `msg${isError ? ' err' : ''}`,
        textContent: text,
      }),
    );
    resultsEl.hidden = false;
    placeInput.setAttribute('aria-expanded', 'true');
  }

  function renderResults(places: Place[]) {
    results = places;
    highlighted = -1;
    if (!places.length) {
      showMessage('No place by that name.');
      return;
    }
    resultsEl.replaceChildren(
      ...places.map((place, index) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.index = String(index);

        const kind = document.createElement('span');
        kind.className = 'kd';
        kind.textContent = place.kind.replace(/_/g, ' ');

        const name = document.createElement('span');
        name.className = 'nm';
        name.textContent = place.name;

        li.append(kind, name);
        if (place.detail) {
          const detail = document.createElement('span');
          detail.className = 'dt';
          detail.textContent = place.detail;
          li.append(detail);
        }
        return li;
      }),
    );
    resultsEl.hidden = false;
    placeInput.setAttribute('aria-expanded', 'true');
  }

  function highlight(next: number) {
    if (!results.length) return;
    const items = Array.from(resultsEl.children) as HTMLElement[];
    if (highlighted >= 0) items[highlighted]?.setAttribute('aria-selected', 'false');
    highlighted = (next + results.length) % results.length;
    const item = items[highlighted];
    item?.setAttribute('aria-selected', 'true');
    item?.scrollIntoView({ block: 'nearest' });
  }

  function choose(index: number) {
    const place = results[index];
    if (!place) return;
    placeInput.value = place.name;
    closeResults();
    box().hidden = true;
    ports.onChoose(place);
  }

  async function search(query: string) {
    const token = ++searchToken;
    try {
      const data = await getScoutJson(`/api/scout/geocode?q=${encodeURIComponent(query)}`);
      // A slower earlier request must not overwrite a faster later one.
      if (token !== searchToken) return;
      if (!data.ok) throw new Error(data.error || 'Place search failed.');
      renderResults(data.places as Place[]);
    } catch (err) {
      if (token !== searchToken) return;
      showMessage(err instanceof Error ? err.message : 'Place search failed.', true);
    }
  }

  placeInput.addEventListener('input', () => {
    const query = placeInput.value.trim();
    clearTimeout(debounce);
    // The kept list appears and disappears with the first and last character.
    ports.onQueryChanged();
    if (query.length < MIN_QUERY) {
      searchToken++; // cancel anything in flight
      closeResults();
      return;
    }
    debounce = setTimeout(() => search(query), DEBOUNCE_MS);
  });

  placeInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(highlighted + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(highlighted - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results.length) choose(highlighted >= 0 ? highlighted : 0);
    } else if (event.key === 'Escape') {
      closeResults();
    }
  });

  resultsEl.addEventListener('click', (event) => {
    const li = (event.target as HTMLElement).closest('li');
    if (li?.dataset.index) choose(Number(li.dataset.index));
  });

  on('search-button', 'click', () => {
    const open = box().hidden;
    box().hidden = !open;
    $('search-button').setAttribute('aria-expanded', String(open));
    if (open) placeInput.focus();
    else closeResults();
    ports.onQueryChanged();
  });

  return {
    query: () => placeInput.value.trim(),
    setQuery: (text: string) => {
      placeInput.value = text;
    },
    isOpen: () => !box().hidden,
    show: () => {
      box().hidden = false;
    },
    hide: () => {
      box().hidden = true;
    },
    closeResults,
    focus: () => placeInput.focus(),
  };
}
