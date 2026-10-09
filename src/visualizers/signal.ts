import type { Snapshot } from "../types";
import type { ArchiveSignal } from "./archive";

const finite = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);
const clamp = (n: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, finite(n)));
const mean = (values: number[], start: number, end: number) =>
  values.slice(start, end).reduce((sum, n) => sum + n, 0) /
  Math.max(1, end - start);
type Frame = {
  at: number;
  level: number;
  low: number;
  mid: number;
  high: number;
  hit: number;
  spectrum: number[];
};
type Onset = { at: number; n: number };

/** Bounded, playback-driven history. The archive's synthetic demo signal is never enabled. */
export class PlayerSignal implements ArchiveSignal {
  active = true;
  source = "player";
  level = 0;
  low = 0;
  mid = 0;
  high = 0;
  pulse = 0;
  hit = 0;
  beat = 0;
  songTime = 0;
  loopTime = 0;
  travel = 0;
  lowPhase = 0;
  midPhase = 0;
  highPhase = 0;
  kickAge = 30;
  snareAge = 30;
  hatAge = 30;
  noteAge = 30;
  private playing = false;
  private position: number | null = null;
  private sampleClock = 0;
  private revision: number | undefined;
  private track: string | undefined;
  private history: Frame[] = [];
  private waveform: number[] = [];
  private waveformDuration = 0.032;
  private onsets: Record<string, Onset[]> = {
    kick: [],
    snare: [],
    hat: [],
    note: [],
  };
  private previous = [0, 0, 0, 0];
  private spectrum = Array<number>(32).fill(0);

  update(snapshot: Snapshot) {
    const position = Math.max(0, finite(snapshot.position));
    const track =
      snapshot.index === null ? undefined : snapshot.queue[snapshot.index];
    const expectedProgress = this.playing
      ? Math.max(0, this.songTime - this.sampleClock)
      : 0;
    if (
      track !== this.track ||
      snapshot.visualizationRevision !== this.revision ||
      (this.position !== null &&
        (Math.abs(position - this.position - expectedProgress) > 0.25 ||
          (!snapshot.playing && position === 0 && this.position > 0) ||
          Math.abs(position - this.songTime) > 1.5))
    ) {
      this.history = [];
      this.onsets = { kick: [], snare: [], hat: [], note: [] };
      this.previous = [0, 0, 0, 0];
      this.beat =
        this.travel =
        this.lowPhase =
        this.midPhase =
        this.highPhase =
          0;
      this.songTime = position;
      this.loopTime = position;
      this.hit = this.pulse = 0;
      this.track = track;
    }
    this.revision = snapshot.visualizationRevision;
    this.sampleClock = this.songTime;
    this.position = position;
    this.playing = snapshot.playing;
    this.spectrum = Array.from({ length: 32 }, (_, i) =>
      snapshot.playing ? clamp(snapshot.spectrum[i] ?? 0) : 0,
    );
    this.waveform = snapshot.playing
      ? (snapshot.waveform ?? []).slice(0, 256).map((n) => clamp(n, -1, 1))
      : [];
    this.waveformDuration = Math.max(
      0.001,
      finite(snapshot.waveformDuration ?? 0.032, 0.032),
    );
    this.low = mean(this.spectrum, 0, 11);
    this.mid = mean(this.spectrum, 11, 23);
    this.high = mean(this.spectrum, 23, 32);
    const rms = Math.sqrt(
      this.waveform.reduce((sum, n) => sum + n * n, 0) /
        Math.max(1, this.waveform.length),
    );
    this.level = clamp(Math.max(rms * 3, mean(this.spectrum, 0, 32)));
    const bands = [this.low, this.mid, this.high, this.level];
    const names = ["kick", "snare", "hat", "note"];
    let onset = 0;
    bands.forEach((value, i) => {
      const events = this.onsets[names[i]];
      const last = events.at(-1);
      const change = value - this.previous[i];
      // These are band onsets, not claims to identify instruments or estimate BPM.
      if (
        snapshot.playing &&
        value > 0.045 &&
        change > 0.035 &&
        (!last || this.songTime - last.at >= 0.12)
      ) {
        events.push({ at: this.songTime, n: (last?.n ?? 0) + 1 });
        if (events.length > 240) events.shift();
        onset = Math.max(onset, clamp(change * 3));
      }
    });
    this.previous = bands;
    this.hit = snapshot.playing ? Math.max(this.hit, onset) : 0;
    this.pulse = this.hit;
    if (!snapshot.playing) this.history = [];
    const frame = {
      at: this.songTime,
      level: this.level,
      low: this.low,
      mid: this.mid,
      high: this.high,
      hit: this.hit,
      spectrum: this.spectrum,
    };
    if (this.history.at(-1)?.at === this.songTime)
      this.history[this.history.length - 1] = frame;
    else this.history.push(frame);
    if (this.history.length > 320) this.history.shift();
    this.refreshEvents();
  }

  advance(seconds: number) {
    if (!this.playing) return;
    const dt = clamp(seconds, 0, 0.1);
    this.songTime += dt;
    this.loopTime = this.songTime;
    this.travel += this.level * dt;
    this.lowPhase += this.low * dt;
    this.midPhase += this.mid * dt;
    this.highPhase += this.high * dt;
    this.hit *= Math.exp(-dt * 7);
    this.pulse = this.hit;
    this.refreshEvents();
  }

  private refreshEvents() {
    this.kickAge = this.eventAt("kick").age;
    this.snareAge = this.eventAt("snare").age;
    this.hatAge = this.eventAt("hat").age;
    this.noteAge = this.eventAt("note").age;
    this.beat = this.eventAt("kick").n;
  }

  private recall(age: number, read: (f: Frame) => number) {
    if (!this.playing || !this.history.length) return 0;
    const at = this.songTime - Math.max(0, finite(age));
    for (let i = this.history.length - 1; i >= 0; i--) {
      const older = this.history[i];
      if (older.at <= at) {
        const newer = this.history[i + 1] ?? older;
        const mix =
          newer.at > older.at
            ? clamp((at - older.at) / (newer.at - older.at))
            : 0;
        return clamp(read(older) * (1 - mix) + read(newer) * mix);
      }
    }
    return 0;
  }
  levelAt = (age = 0) => this.recall(age, (f) => f.level);
  hitAt = (age = 0) => (age <= 0 ? this.hit : this.recall(age, (f) => f.hit));
  bandAt = (band: string, age = 0) => {
    if (band === "balance") return 0;
    if (band === "travel")
      return this.playing
        ? Math.max(
            0,
            this.travel - Math.max(0, finite(age)) * this.levelAt(age),
          )
        : 0;
    if (band === "low" || band === "mid" || band === "high")
      return this.recall(age, (f) => f[band]);
    // Mono analysis represents amp/left/right without inventing stereo differences.
    return ["amp", "left", "right"].includes(band) ? this.levelAt(age) : 0;
  };
  spectrumAt = (position: number, age = 0) => {
    const index = clamp(position) * 31,
      first = Math.floor(index),
      mix = index - first;
    return this.recall(
      age,
      (f) =>
        f.spectrum[first] * (1 - mix) +
        f.spectrum[Math.min(31, first + 1)] * mix,
    );
  };
  sampleAt = (age = 0, _channel = "mono") => {
    if (!this.playing || !this.waveform.length || age > this.waveformDuration)
      return 0;
    const index =
      (1 - clamp(age / this.waveformDuration)) * (this.waveform.length - 1);
    const first = Math.floor(index),
      mix = index - first;
    return (
      this.waveform[first] * (1 - mix) +
      this.waveform[Math.min(this.waveform.length - 1, first + 1)] * mix
    );
  };
  eventAt = (kind: string, age = 0) => {
    if (!this.playing) return { n: 0, age: 30 };
    const at = this.songTime - Math.max(0, finite(age));
    const events = this.onsets[kind] ?? this.onsets.note;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].at <= at)
        return { n: events[i].n, age: clamp(at - events[i].at, 0, 30) };
    }
    return { n: 0, age: 30 };
  };
}
