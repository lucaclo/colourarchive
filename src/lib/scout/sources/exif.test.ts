import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  cameraName,
  commonsExifUrl,
  formatSettings,
  formatShutter,
  parseCommonsExif,
  parseFlickrExif,
  readNumber,
} from './exif.ts';

/** Trimmed from a real `prop=imageinfo&iiprop=metadata` answer, 2026-10-25. */
const COMMONS = {
  query: {
    pages: [
      {
        pageid: 83054390,
        imageinfo: [
          {
            metadata: [
              { name: 'Make', value: 'Canon' },
              { name: 'Model', value: 'Canon EOS-1D X' },
              { name: 'ExposureTime', value: '1/500' },
              { name: 'FNumber', value: '71/10' },
              { name: 'ISOSpeedRatings', value: 200 },
              { name: 'FocalLength', value: '70/1' },
            ],
          },
        ],
      },
      {
        pageid: 148721736,
        imageinfo: [
          {
            metadata: [
              { name: 'Make', value: 'OLYMPUS IMAGING CORP.' },
              { name: 'Model', value: 'E-M5MarkII' },
              { name: 'ExposureTime', value: '1/320' },
              { name: 'FNumber', value: '71/10' },
              { name: 'ISOSpeedRatings', value: 320 },
              { name: 'FocalLength', value: '20/1' },
              { name: 'FocalLengthIn35mmFilm', value: 40 },
            ],
          },
        ],
      },
      { pageid: 83097768, imageinfo: [{ metadata: [{ name: 'Make', value: 'TBA' }, { name: 'Model', value: 'TBA' }] }] },
      { pageid: 12762087, imageinfo: [{ metadata: [] }] },
    ],
  },
};

describe('Commons EXIF', () => {
  it('asks for metadata by page id', () => {
    const url = new URL(commonsExifUrl(['1', '2'], { cors: true }));
    assert.equal(url.searchParams.get('pageids'), '1|2');
    assert.equal(url.searchParams.get('iiprop'), 'metadata');
    assert.equal(url.searchParams.get('origin'), '*');
  });

  it('reads the settings a photographer uses', () => {
    const settings = parseCommonsExif(COMMONS);
    assert.deepEqual(settings.get('83054390'), {
      camera: 'Canon EOS-1D X',
      fNumber: 7.1,
      shutter: '1/500',
      iso: 200,
      focalMm: 70,
      focal35Mm: undefined,
    });
    assert.equal(formatSettings(settings.get('83054390')!), 'f/7.1 · 1/500 · ISO 200 · 70 mm');
    assert.equal(formatSettings(settings.get('148721736')!), 'f/7.1 · 1/320 · ISO 320 · 40 mm eq.');
    assert.equal(settings.get('148721736')!.camera, 'Olympus E-M5MarkII');
  });

  it('leaves out files with no exposure fields, rather than inventing any', () => {
    const settings = parseCommonsExif(COMMONS);
    assert.equal(settings.has('83097768'), false);
    assert.equal(settings.has('12762087'), false);
    assert.equal(parseCommonsExif({ error: 'x' }).size, 0);
  });
});

describe('Flickr EXIF', () => {
  // The documented shape of flickr.photos.getExif.
  const payload = {
    photo: {
      id: '1',
      camera: 'Fujifilm X-T5',
      exif: [
        { tagspace: 'ExifIFD', tag: 'ExposureTime', label: 'Exposure', raw: { _content: '1/250' } },
        { tagspace: 'ExifIFD', tag: 'FNumber', label: 'Aperture', raw: { _content: '8.0' } },
        { tagspace: 'ExifIFD', tag: 'ISO', label: 'ISO Speed', raw: { _content: '160' } },
        { tagspace: 'ExifIFD', tag: 'FocalLength', label: 'Focal Length', raw: { _content: '23.0 mm' } },
        { tagspace: 'ExifIFD', tag: 'FocalLengthIn35mmFormat', raw: { _content: '35 mm' } },
      ],
    },
    stat: 'ok',
  };

  it('reads the documented response', () => {
    const s = parseFlickrExif(payload)!;
    assert.equal(s.camera, 'Fujifilm X-T5');
    assert.equal(formatSettings(s), 'f/8 · 1/250 · ISO 160 · 35 mm eq.');
  });

  it('treats hidden EXIF as no settings', () => {
    assert.equal(parseFlickrExif({ stat: 'fail', code: 2, message: 'Permission denied' }), null);
    assert.equal(parseFlickrExif({ photo: { exif: [] } }), null);
  });
});

describe('the small readers', () => {
  it('reads rationals, plain numbers and units', () => {
    assert.equal(readNumber('71/10'), 7.1);
    assert.equal(readNumber('35.0 mm'), 35);
    assert.equal(readNumber(200), 200);
    assert.equal(readNumber('0/1'), undefined);
    assert.equal(readNumber('abc'), undefined);
  });

  it('says shutter speeds as fractions under a second and seconds over', () => {
    assert.equal(formatShutter('1/15'), '1/15');
    assert.equal(formatShutter('0.004'), '1/250');
    assert.equal(formatShutter('10/1'), '10 s');
    assert.equal(formatShutter('2.5'), '2.5 s');
  });

  it('does not repeat the maker in the model, and drops placeholders', () => {
    assert.equal(cameraName('Canon', 'Canon PowerShot S3 IS'), 'Canon PowerShot S3 IS');
    assert.equal(cameraName('EASTMAN KODAK COMPANY', 'KODAK EASYSHARE C433 ZOOM DIGITAL CAMERA'), 'KODAK EASYSHARE C433 ZOOM DIGITAL CAMERA');
    assert.equal(cameraName('FUJIFILM', 'X-T5'), 'Fujifilm X-T5');
    assert.equal(cameraName('TBA', 'TBA'), undefined);
  });
});
