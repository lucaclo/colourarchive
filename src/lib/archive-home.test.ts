import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appArchiveFolder, appProfileDir, realArchiveFolder } from './archive-home.ts';

describe('archive-home', () => {
  let tmp: string;
  let profile: string;
  let archive: string;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-home-'));
    profile = path.join(tmp, 'profile');
    archive = path.join(tmp, 'My Archive');
    fs.mkdirSync(profile, { recursive: true });
    fs.mkdirSync(path.join(archive, '.archive'), { recursive: true });
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const settings = (body: unknown) => fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(body));

  it('finds the app’s settings where desktop/main.cjs keeps them', () => {
    assert.equal(appProfileDir({}, '/Users/someone'), '/Users/someone/Library/Application Support/Colour Archive');
    assert.equal(appProfileDir({ COLOUR_ARCHIVE_PROFILE: profile }), profile);
  });

  it('reads the folder the app opens', () => {
    settings({ dataDir: archive, lan: true });
    assert.equal(appArchiveFolder({ COLOUR_ARCHIVE_PROFILE: profile }), archive);
  });

  it('is null with no settings, no folder chosen, or a folder that has gone', () => {
    assert.equal(appArchiveFolder({ COLOUR_ARCHIVE_PROFILE: path.join(tmp, 'none') }), null);
    settings({ lan: true });
    assert.equal(appArchiveFolder({ COLOUR_ARCHIVE_PROFILE: profile }), null);
    settings({ dataDir: path.join(tmp, 'moved') });
    assert.equal(appArchiveFolder({ COLOUR_ARCHIVE_PROFILE: profile }), null);
    fs.writeFileSync(path.join(profile, 'settings.json'), '{ not json');
    assert.equal(appArchiveFolder({ COLOUR_ARCHIVE_PROFILE: profile }), null);
  });

  it('lets an explicit COLOUR_ARCHIVE_DATA win, so tests stay on their throwaway copy', () => {
    settings({ dataDir: archive });
    assert.equal(realArchiveFolder({ COLOUR_ARCHIVE_PROFILE: profile, COLOUR_ARCHIVE_DATA: '/tmp/throwaway' }), '/tmp/throwaway');
    assert.equal(realArchiveFolder({ COLOUR_ARCHIVE_PROFILE: profile }), archive);
  });
});
