import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rms, tidyTranscript, transcribe } from './transcribe';

test('tidyTranscript drops Whisper’s non-speech markers and tidies spaces', () => {
  assert.equal(tidyTranscript('  [BLANK_AUDIO] '), '');
  assert.equal(tidyTranscript('(music)'), '');
  assert.equal(tidyTranscript(' Warm   light  on the wall. '), 'Warm light on the wall.');
});

test('silence is no note, and never reaches the model', async () => {
  assert.equal(rms(new Float32Array(16000)), 0);
  assert.equal(await transcribe(new Float32Array(16000)), '');
  assert.equal(await transcribe(new Float32Array(100).fill(0.5)), '', 'too short to be a note');
});
