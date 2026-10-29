import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraName, colophonLines } from './colophon';

test('cameraName says it as a person would', () => {
  assert.equal(cameraName('SONY ILCE-7CM2'), 'Sony a7C II');
  assert.equal(cameraName('RICOH IMAGING COMPANY, LTD. RICOH GR IIIx'), 'Ricoh GR IIIx');
  assert.equal(cameraName('NIKON CORPORATION NIKON Z 6'), 'Nikon Z 6');
});

test('colophonLines', () => {
  const lines = colophonLines([
    { medium: 'digital', camera: 'SONY ILCE-7CM2', lens: 'FE 40mm F2.5 G', capturedAt: '2023-02-17T21:05:18Z' },
    { medium: 'digital', camera: 'SONY ILCE-7CM2', lens: 'FE 40mm F2.5 G', capturedAt: '2026-06-27T15:58:00Z' },
    { medium: 'digital', camera: 'SONY ILCE-7M3', lens: '----' },
    { medium: 'film', camera: 'NORITSU KOKI EZ Controller', capturedAt: '2020-01-01T00:00:00Z' },
  ], ['Zermatt', 'Zermatt', 'Kyoto']);
  assert.deepEqual(lines, [
    '4 photographs, 3 digital, 1 on film.',
    'Made with the Sony a7C II and Sony a7 III.',
    'Lenses: FE 40mm F2.5 G.',
    'Film scanned on a Noritsu Koki.',
    'Taken between February 2023 and June 2026.',
    'In Zermatt and Kyoto.',
  ]);
});

test('colophonLines: a long list ends "and others"', () => {
  const lenses = ['A', 'B', 'C', 'D', 'E'].map((lens) => ({ medium: 'digital' as const, lens }));
  assert.equal(colophonLines(lenses)[1], 'Lenses: A, B, C, D and others.');
});
