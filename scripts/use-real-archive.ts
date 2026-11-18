/**
 * Point this command at the real archive (src/lib/archive-home.ts).
 *
 * Imported first by commands that read or publish the real archive, before
 * anything imports `paths.ts`, which reads COLOUR_ARCHIVE_DATA once when it
 * loads. Refuses to go on without one: publishing this repository's
 * development copy would replace the public site with old photographs.
 */
import os from 'node:os';
import { realArchiveFolder } from '../src/lib/archive-home.ts';

const folder = realArchiveFolder();
if (!folder) {
  console.error('No archive found. Open the Mac app once and choose its folder, or set COLOUR_ARCHIVE_DATA.');
  process.exit(1);
}
process.env.COLOUR_ARCHIVE_DATA = folder;
console.log(`Archive: ${folder.replace(os.homedir(), '~')}`);
