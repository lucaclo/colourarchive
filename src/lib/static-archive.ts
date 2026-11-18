/**
 * A public build reads the real archive (D1, see ./archive-home).
 *
 * Imported for its side effect by astro.config.mjs, *before* publish.ts:
 * imports run first and in order, and publish.ts loads paths.ts, which reads
 * COLOUR_ARCHIVE_DATA once. Set any later and the build stamp would describe
 * this repository's copy while the pages showed the archive. No app settings
 * (CI, another machine): the repository's copy, as before.
 */
import { realArchiveFolder } from './archive-home';

if (process.env.PUBLIC_STATIC === 'true') {
  const archive = realArchiveFolder();
  if (archive) process.env.COLOUR_ARCHIVE_DATA = archive;
}
