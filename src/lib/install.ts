// Which install path this browser has, for the /get page.
//
// Only Chromium browsers (Chrome, Edge, Samsung Internet, Android) can install
// from a button on the page, via `beforeinstallprompt`. Everywhere else the
// browser keeps the install command in its own chrome, so the page's job is to
// point at it. Kept pure (no `navigator` reads) so it can be tested.

export type InstallPath =
  | 'installed'     // already running as the app
  | 'iphone'        // Safari on iPhone: Share sits at the foot of the screen
  | 'ipad'          // Safari on iPad: Share sits top right
  | 'ios-other'     // Chrome/Firefox/Edge on iOS: Share in their own toolbar
  | 'mac-safari'    // Safari 17+ on the Mac: Add to Dock
  | 'android'       // any Android browser
  | 'desktop-chromium'
  | 'unsupported';  // Firefox desktop, old Safari: cannot install at all

export interface InstallEnv {
  ua: string;
  maxTouchPoints: number;
  standalone: boolean;
}

export function installPath({ ua, maxTouchPoints, standalone }: InstallEnv): InstallPath {
  if (standalone) return 'installed';
  // iPadOS asks for the desktop site by default and reports itself as a Mac;
  // touch points are the tell.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 0);
  const iOS = iPad || /iPhone|iPod/.test(ua);
  if (iOS) {
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-other';
    return iPad ? 'ipad' : 'iphone';
  }
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'unsupported';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'desktop-chromium';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) {
    const v = ua.match(/Version\/(\d+)/);
    return v && Number(v[1]) >= 17 ? 'mac-safari' : 'unsupported';
  }
  return 'unsupported';
}

// Running as the installed app rather than in a tab. Chrome's app window
// matches `standalone` (checked in a real `--app` window, across a reload);
// the other two are what an app that opts into them reports instead. iOS
// home-screen apps set `navigator.standalone`. `window.toolbar.visible` is
// no help: it stays true in Chrome's app window.
export function inAppWindow(): boolean {
  return (
    ['standalone', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia(`(display-mode: ${m})`).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// The manifest registers this protocol, so navigating to it from a browser tab
// opens the installed app in its own window. A plain link to the archive
// would stay in the tab.
export const OPEN_IN_APP = 'web+colour:open';

/**
 * Whether this browser has the app installed, asked from an ordinary tab.
 * Chromium only (`getInstalledRelatedApps`, matched against the manifest's
 * `related_applications`). Anywhere else the answer is "don't know", which is
 * treated as no.
 */
export async function installedElsewhere(): Promise<boolean> {
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<{ platform: string }[]> };
  if (!nav.getInstalledRelatedApps) return false;
  try {
    return (await nav.getInstalledRelatedApps()).some((a) => a.platform === 'webapp');
  } catch {
    return false;
  }
}
