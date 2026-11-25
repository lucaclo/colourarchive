/**
 * Which build this server, and every page it serves, came from: package.json's
 * version and the moment the build started, baked in by astro.config.mjs
 * (`vite.define`). The published site's `publish.json` carries the same
 * `builtAt`, so a page can tell whether it is the live build.
 *
 * Outside Vite (unit tests under tsx) nothing is baked in: the version is
 * 0.0.0 and the moment is when this module loaded.
 */
declare const __BUILD_VERSION__: string;
declare const __BUILT_AT__: string;

export interface BuildInfo {
  version: string;
  builtAt: string;
}

export const BUILD: BuildInfo = {
  version: typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : '0.0.0',
  builtAt: typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : new Date().toISOString(),
};
