/**
 * Accessibility, on a phone: every page of the archive run through axe
 * (WCAG 2.2 A and AA) at iPhone size with touch emulation, plus the main
 * dialogs opened the way a thumb opens them.
 *
 *   npm run a11y                    against https://localhost:4321 (the dev server)
 *   npm run a11y -- --json out.json  also write every finding
 *
 * Read-only by construction: every request to the archive that isn't a GET is
 * refused before it leaves the browser, so nothing it clicks can upload,
 * remove or reorder anything in the real archive.
 *
 * Fails (exit 1) on any serious or critical finding.
 */
import fs from 'node:fs';
import { chromium, devices, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const ORIGIN = process.env.A11Y_ORIGIN ?? 'https://localhost:4321';
const jsonAt = process.argv.indexOf('--json');
const JSON_OUT = jsonAt > 0 ? process.argv[jsonAt + 1] : null;

type Step = { name: string; path: string; open?: (page: Page) => Promise<void>; expect?: string };

/** Click something the way a second tap would, and give the overlay time to open. */
const press = (fn: () => void) => async (page: Page) => {
  await page.evaluate(fn);
  await page.waitForTimeout(1200);
};

const STEPS: Step[] = [
  { name: 'Archive', path: '/' },
  { name: 'Archive · lightbox', path: '/', expect: '#lightbox', open: press(() => (document.querySelector('.frame') as HTMLElement)?.click()) },
  { name: 'Inspiration', path: '/inspiration' },
  {
    name: 'Inspiration · picture', path: '/inspiration', expect: '#lb',
    open: press(() => {
      const f = document.querySelector('.insp-frame');
      f?.classList.add('is-active');
      (f?.querySelector('img.photo') as HTMLElement)?.click();
    }),
  },
  { name: 'Inspiration · match', path: '/inspiration', expect: '#mx', open: press(() => (document.querySelector('.cell-match') as HTMLElement)?.click()) },
  { name: 'Inspiration · similar', path: '/inspiration', expect: '#sim', open: press(() => (document.querySelector('.cell-similar') as HTMLElement)?.click()) },
  { name: 'Inspiration · add', path: '/inspiration/add' },
  { name: 'Scout', path: '/scout?at=55.935,-3.2375&tz=Europe/London&n=Edinburgh' },
  { name: 'Scout · cards', path: '/scout/cards' },
  { name: 'Book', path: '/book' },
  { name: 'Book · view', path: '/book/view' },
  { name: 'Magazine', path: '/book/zine' },
  { name: 'Add & remove', path: '/upload' },
  { name: 'Get the app', path: '/get' },
  { name: 'Not found', path: '/no-such-page' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true });
await context.route(`${ORIGIN}/**`, (route) =>
  route.request().method() === 'GET' || route.request().method() === 'HEAD' ? route.continue() : route.abort(),
);

type Finding = { step: string; id: string; impact: string; help: string; nodes: { target: string; html: string }[] };
const findings: Finding[] = [];

for (const step of STEPS) {
  const page = await context.newPage();
  try {
    await page.goto(ORIGIN + step.path, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForTimeout(1500);
    if (step.open) await step.open(page);
    if (step.expect && !(await page.locator(step.expect).isVisible())) {
      console.log(`? ${step.name.padEnd(26)} didn’t open ${step.expect}`);
      continue;
    }
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      // The map canvas and its attribution are MapLibre's, not ours.
      .exclude('.maplibregl-canvas-container')
      .analyze();
    for (const v of result.violations) {
      findings.push({
        step: step.name,
        id: v.id,
        impact: v.impact ?? 'minor',
        help: v.help,
        nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160) })),
      });
    }
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').length;
    console.log(`${bad ? '✖' : '✔'} ${step.name.padEnd(26)} ${result.violations.length} rule(s) broken, ${bad} serious`);
  } catch (err) {
    console.log(`? ${step.name.padEnd(26)} couldn’t check: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 } as Record<string, number>;
findings.sort((a, b) => order[a.impact] - order[b.impact] || a.id.localeCompare(b.id));
console.log('');
for (const f of findings) {
  console.log(`[${f.impact}] ${f.step} · ${f.id}: ${f.help}`);
  for (const n of f.nodes.slice(0, 3)) console.log(`    ${n.target}`);
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(findings, null, 2));
const serious = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
process.exit(serious.length ? 1 : 0);
