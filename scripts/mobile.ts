// Opens the dev server in a desktop window that behaves like an iPhone, so the
// phone layout can be tried and critiqued on the laptop.
//
//   npm run mobile                  iPhone 16 Pro, home page
//   npm run mobile -- /scout        start on a given path
//   npm run mobile -- --ipad        iPad Mini instead
//
// A resized desktop window isn't enough: much of the phone UI is keyed off
// (pointer: coarse) and (hover: none), which only change when the browser
// itself believes it's a touch device. Playwright's device emulation sets
// both, plus touch events, the device pixel ratio and an iOS user agent.
// The profile is kept between runs, so saved zines and placements survive.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ORIGIN = process.env.MOBILE_ORIGIN ?? 'https://localhost:4321';
const args = process.argv.slice(2);
const ipad = args.includes('--ipad');
const path = args.find((a) => a.startsWith('/')) ?? '/';

// Safe areas: Chromium reports env(safe-area-inset-*) as 0 unless told
// otherwise, which would hide how the tab bar and sheets sit around the
// Dynamic Island and the home indicator.
const preset = ipad
  ? { device: devices['iPad Mini'], insets: { top: 24, bottom: 20, left: 0, right: 0 } }
  : { device: devices['iPhone 16 Pro'], insets: { top: 62, bottom: 34, left: 0, right: 0 } };

async function serverUp(): Promise<boolean> {
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

if (!(await serverUp())) {
  console.log('Dev server not running — starting it…');
  const dev = spawn('npm', ['run', 'dev'], { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)) });
  process.on('exit', () => dev.kill());
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 1000));
}

// The descriptor names WebKit as its browser; only Chromium is installed.
const { defaultBrowserType: _ignored, ...device } = preset.device;
const profile = fileURLToPath(new URL('../node_modules/.cache/mobile-preview', import.meta.url));
const context = await chromium.launchPersistentContext(profile, {
  ...device,
  headless: false,
  ignoreHTTPSErrors: true,
  args: [`--window-size=${device.viewport.width + 40},${device.viewport.height + 140}`],
});

async function applyInsets(page: import('playwright').Page) {
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: preset.insets } as never);
  } catch {
    // Older Chromium without the override — insets stay 0.
  }
}

// Astro's dev toolbar is a desktop tool and on a phone-sized screen it sits
// under the tab bar, where it looks like part of the app.
await context.addInitScript(() => {
  const hide = () => document.querySelector('astro-dev-toolbar')?.remove();
  new MutationObserver(hide).observe(document, { childList: true, subtree: true });
});

context.on('page', applyInsets);
const page = context.pages()[0] ?? (await context.newPage());
await applyInsets(page);
await page.goto(ORIGIN + path);

console.log(`${ipad ? 'iPad Mini' : 'iPhone 16 Pro'} preview open at ${ORIGIN + path}. Close the window to quit.`);
context.on('close', () => process.exit(0));
