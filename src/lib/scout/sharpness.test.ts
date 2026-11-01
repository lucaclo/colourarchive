import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleOfConfusionMm, cocForPrintMm, readSharpness, sharpWhere } from './sharpness';
import { SENSORS, depthOfField } from './frame';

const ff = SENSORS[0];
const apsc = SENSORS[1];

test('the print standard is the diagonal over 1500, and smaller sensors get smaller circles', () => {
  assert.ok(Math.abs(circleOfConfusionMm('print', ff, 33) - 0.0288) < 0.0002);
  assert.ok(Math.abs(circleOfConfusionMm('print', apsc, 24) - 0.0188) < 0.0002);
  // Resolution plays no part in print.
  assert.equal(circleOfConfusionMm('print', ff, 24), circleOfConfusionMm('print', ff, 61));
});

test('pixel-sharp is two pixels, so a 61 MP body is far stricter than a print', () => {
  const px61 = circleOfConfusionMm('pixel', ff, 61);
  assert.ok(Math.abs(px61 - 0.0076) < 0.0002);
  assert.ok(px61 < circleOfConfusionMm('pixel', ff, 24));
  assert.ok(px61 < circleOfConfusionMm('print', ff, 61) / 3);
});

test('the same lens is sharp much nearer by print than by pixel', () => {
  const print = depthOfField(24, 8, circleOfConfusionMm('print', ff, 33), 10);
  const pixel = depthOfField(24, 8, circleOfConfusionMm('pixel', ff, 33), 10);
  assert.ok(print.hyperfocalM < pixel.hyperfocalM / 2);
  assert.equal(print.farM, Infinity);
});

test('a bigger print asks for a smaller circle, and a 10 × 8 lands near the standard', () => {
  const tenByEight = cocForPrintMm(ff, 254, 203);
  assert.ok(Math.abs(tenByEight - circleOfConfusionMm('print', ff, 33)) < 0.003);
  assert.ok(cocForPrintMm(ff, 400, 300) < tenByEight);
  assert.ok(Math.abs(cocForPrintMm(ff, 400, 300) - 0.0173) < 0.0003);
});

test('the answer names its standard', () => {
  assert.equal(sharpWhere('print'), 'Sharp in a 10 × 8 print');
  assert.equal(sharpWhere('pixel'), 'Sharp at 100%');
  assert.equal(readSharpness('pixel'), 'pixel');
  assert.equal(readSharpness(undefined), 'print');
});
