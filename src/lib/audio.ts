import type { Anthem } from "./anthem";

type Note = { freq: number; start: number; dur: number; type: OscillatorType };

/** Build a deterministic note motif from the anthem's key + BPM. */
function buildMotif(anthem: Anthem, bars: number): { notes: Note[]; duration: number } {
  const scale = anthem.musicKey.includes("minor")
    ? [220, 261.63, 329.63, 392, 329.63, 261.63]
    : [246.94, 293.66, 349.23, 440, 349.23, 293.66];
  const beat = 60 / Math.max(60, anthem.bpm);
  const step = beat / 2; // eighth notes
  const notes: Note[] = [];
  let end = 0;
  for (let bar = 0; bar < bars; bar++) {
    scale.forEach((freq, i) => {
      const start = (bar * scale.length + i) * step;
      const dur = step * 0.95;
      notes.push({ freq, start, dur, type: i % 2 ? "triangle" : "sawtooth" });
      end = start + dur;
    });
  }
  return { notes, duration: end + 0.25 };
}

function scheduleNote(ctx: BaseAudioContext, dest: AudioNode, n: Note, offset: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = n.type;
  osc.frequency.value = n.freq;
  const s = offset + n.start;
  gain.gain.setValueAtTime(0.0001, s);
  gain.gain.exponentialRampToValueAtTime(0.09, s + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, s + n.dur);
  osc.connect(gain).connect(dest);
  osc.start(s);
  osc.stop(s + n.dur + 0.05);
}

/** Play the beat live in the browser. */
export function playBeat(anthem: Anthem) {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const { notes, duration } = buildMotif(anthem, 2);
  const now = ctx.currentTime + 0.05;
  notes.forEach((n) => scheduleNote(ctx, ctx.destination, n, now));
  window.setTimeout(() => ctx.close().catch(() => {}), (duration + 0.2) * 1000);
}

/** Render the beat offline to a 16-bit PCM WAV blob (for IPFS pinning). */
export async function renderBeatWav(anthem: Anthem, bars = 4): Promise<Blob> {
  const OAC =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const sampleRate = 44100;
  const { notes, duration } = buildMotif(anthem, bars);
  const ctx = new OAC(1, Math.ceil(duration * sampleRate), sampleRate);
  notes.forEach((n) => scheduleNote(ctx, ctx.destination, n, 0));
  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const dataLength = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}
