/**
 * The two-character helpers the page is written in.
 *
 * Scout addresses its markup by id, several hundred times. That is a deliberate
 * choice rather than an accident of age: the page is one document with one of
 * each thing in it, ids are what the `aria-controls` and `for` attributes in the
 * markup already use, and a query selector would be a second naming scheme for
 * the same elements.
 *
 * The cast is the compromise that makes it bearable. `getElementById` is typed
 * as returning `HTMLElement | null`, which is honest — but every id here is
 * written in the same file as the markup that carries it, so a null means the
 * markup was edited and the script was not, and that should fail loudly at the
 * first use rather than be threaded through three hundred null checks.
 */

/** An element by id, typed as whatever the caller knows it to be. */
export const $ = <T extends Element = HTMLElement>(id: string) =>
  document.getElementById(id) as unknown as T;

/** Listen on an element by id. */
export const on = (id: string, event: string, handler: (e: Event) => void) =>
  $(id).addEventListener(event, handler);

/**
 * The div a MapLibre marker is drawn from.
 *
 * The inner `<i>` is the mark itself; the outer div is what MapLibre positions,
 * and giving it a transform of its own would fight the one MapLibre puts there.
 *
 * Built at runtime, which is why the styles for these classes are `:global()` in
 * the page — Astro scopes a stylesheet by stamping an attribute onto the
 * elements *in the markup*, and an element made here never passes through that.
 */
export function markerElement(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.append(document.createElement('i'));
  return element;
}
