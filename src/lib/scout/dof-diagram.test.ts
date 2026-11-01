import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AXIS, FOCUS_INFINITY_M, SLIDER_STEPS, axisTicks, describeSplit, distanceX, dofSplit,
  focusToSlider, roundFocus, sliderToFocus, zoneX,
} from './dof-diagram';
import { depthOfField } from './frame';

test('the axis is logarithmic and ends at the infinity mark', () => {
  const one = distanceX(1), ten = distanceX(10), hundred = distanceX(100);
  assert.ok(Math.abs((ten - one) - (hundred - ten)) < 1e-9);
  assert.equal(distanceX(Infinity), DEFAULT_AXIS.xInf);
  assert.equal(distanceX(5000), DEFAULT_AXIS.xInf);
  assert.equal(distanceX(0.1), DEFAULT_AXIS.x0);
});

test('a zone to infinity reaches the mark', () => {
  const z = zoneX(3.4, Infinity);
  assert.equal(z.x + z.width, DEFAULT_AXIS.xInf);
});

test('ticks are labelled in the page’s units, infinity last', () => {
  const m = axisTicks('m').filter((t) => t.label);
  assert.deepEqual(m.map((t) => t.label), ['1 m', '10 m', '100 m', '1 km', '∞']);
  const ft = axisTicks('ft').filter((t) => t.label);
  assert.deepEqual(ft.map((t) => t.label), ['3 ft', '30 ft', '300 ft', '1 mi', '∞']);
});

test('the focus slider round-trips at two significant figures, and its end is infinity', () => {
  assert.equal(sliderToFocus(SLIDER_STEPS), FOCUS_INFINITY_M);
  assert.equal(focusToSlider(FOCUS_INFINITY_M), SLIDER_STEPS);
  for (const m of [0.5, 1, 3.4, 10, 27, 450]) {
    const back = sliderToFocus(focusToSlider(m));
    assert.ok(Math.abs(back - m) / m < 0.03, `${m} → ${back}`);
  }
  assert.equal(roundFocus(3.4567), 3.5);
  assert.equal(roundFocus(0.4234), 0.42);
  assert.equal(roundFocus(1234), 1200);
});

test('the split says where the focus sits against hyperfocal', () => {
  const c = 0.0288;
  const H = depthOfField(24, 8, c, 10).hyperfocalM;
  const at = depthOfField(24, 8, c, H);
  assert.equal(dofSplit(at, H).situation, 'at-hyperfocal');
  assert.match(describeSplit(dofSplit(at, H)), /^At the hyperfocal/);
  const past = depthOfField(24, 8, c, H * 3);
  assert.equal(dofSplit(past, H * 3).situation, 'past-hyperfocal');
  // Close up the split is near half and half; further out more lies behind.
  const close = dofSplit(depthOfField(24, 8, c, 0.5), 0.5);
  const mid = dofSplit(depthOfField(24, 8, c, 1.5), 1.5);
  assert.ok(close.frontShare! > 0.4 && close.frontShare! < 0.5);
  assert.ok(mid.frontShare! < close.frontShare!);
  assert.match(describeSplit(mid), /^\d+% of it in front of the focus, \d+% behind\.$/);
});
