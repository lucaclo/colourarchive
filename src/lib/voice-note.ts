// Hold to speak (issue #149), the browser half: record while the button is
// held, resample to what Whisper wants (16 kHz mono float), and send it to
// /api/notes/voice, which writes it down on the Mac. Recording starts on the
// press itself, because iOS only grants the microphone inside a user gesture.

const RATE = 16_000;

export type VoiceState = 'idle' | 'listening' | 'writing';

export async function toSamples(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * RATE);
    const off = new OfflineAudioContext(1, Math.max(1, frames), RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination); // a mono destination mixes the channels down
    src.start();
    return (await off.startRendering()).getChannelData(0);
  } finally {
    void ctx.close();
  }
}

/** Wire `button` as hold-to-speak. `onText` gets the words (maybe empty). */
export function holdToSpeak(
  button: HTMLButtonElement,
  onText: (text: string) => void,
  onState: (state: VoiceState, error?: string) => void,
): void {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    button.hidden = true;
    return;
  }
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let releasedEarly = false;

  const stop = () => {
    if (recorder && recorder.state === 'recording') recorder.stop();
    else releasedEarly = true;
  };

  button.addEventListener('pointerdown', async (event) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    releasedEarly = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      onState('idle', 'The microphone isn’t allowed for this page.');
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      onState('writing');
      try {
        const samples = await toSamples(new Blob(chunks, { type: recorder?.mimeType }));
        const res = await fetch('/api/notes/voice', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: samples.buffer as ArrayBuffer });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        onText(data.text);
        onState('idle', data.text ? undefined : 'Nothing was heard. Hold, speak, then let go.');
      } catch (err) {
        onState('idle', err instanceof Error ? err.message : 'It couldn’t be written down.');
      }
    };
    recorder.start();
    onState('listening');
    if (releasedEarly) stop();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, stop);
  // Space or Enter held on the keyboard does the same.
  button.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1 })); } });
  button.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
}
