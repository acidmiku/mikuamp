import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../types";
import { PlayerSignal } from "./signal";

const playing = () => ({
  ...emptySnapshot(),
  queue: ["song-a"],
  index: 0,
  playing: true,
  waveformDuration: 0.032,
});

describe("player-driven archive signal", () => {
  it("reports real signed samples and distinct frequency bands, with silence outside its history", () => {
    const signal = new PlayerSignal();
    const state = playing();
    state.spectrum = Array.from({ length: 32 }, (_, i) => (i < 11 ? 0.8 : 0));
    state.waveform = Array.from({ length: 256 }, (_, i) => (i / 255) * 2 - 1);
    signal.update(state);
    expect(signal.low).toBeCloseTo(0.8);
    expect(signal.mid).toBe(0);
    expect(signal.high).toBe(0);
    expect(signal.sampleAt(0)).toBeCloseTo(1);
    expect(signal.sampleAt(0.016)).toBeCloseTo(0);
    expect(signal.sampleAt(0.032)).toBeCloseTo(-1);
    expect(signal.sampleAt(0.1)).toBe(0);
    expect(signal.spectrumAt(0)).toBe(0.8);
    expect(signal.spectrumAt(1)).toBe(0);
    expect(signal.levelAt(1)).toBe(0);
    expect(signal.eventAt("kick").n).toBe(1);
  });
  it("does not invent music or keep advancing when paused", () => {
    const signal = new PlayerSignal();
    const state = playing();
    state.spectrum.fill(0.5);
    state.waveform = Array(256).fill(0.2);
    signal.update(state);
    signal.advance(0.1);
    expect(signal.travel).toBeGreaterThan(0);
    signal.update({ ...state, playing: false });
    const time = signal.songTime;
    signal.advance(0.1);
    expect(signal.songTime).toBe(time);
    expect([
      signal.level,
      signal.hit,
      signal.bandAt("low"),
      signal.spectrumAt(0.5),
      signal.sampleAt(0),
    ]).toEqual([0, 0, 0, 0, 0]);
    expect(signal.active).toBe(true); // Prevents the archive's demo fallback.
  });
  it("interpolates history and discards the preceding track or seek's events", () => {
    const signal = new PlayerSignal();
    const state = playing();
    state.spectrum.fill(0.2);
    signal.update(state);
    signal.advance(0.1);
    state.spectrum.fill(0.8);
    signal.update({ ...state, position: 0.1 });
    expect(signal.bandAt("low", 0.05)).toBeCloseTo(0.5);
    signal.update({
      ...state,
      queue: ["song-b"],
      spectrum: Array(32).fill(0),
      position: 0,
    });
    expect(signal.levelAt(0.05)).toBe(0);
    expect(signal.eventAt("kick").n).toBe(0);
    signal.update({ ...state, position: 50 });
    expect(signal.songTime).toBe(50);
    expect(signal.levelAt(1)).toBe(0);
  });
  it("bounds malformed data and returns finite values", () => {
    const signal = new PlayerSignal();
    signal.update({
      ...playing(),
      spectrum: [NaN, Infinity, -5, 9],
      waveform: [NaN, Infinity, -3, 3],
    });
    for (const value of [
      signal.level,
      signal.spectrumAt(NaN),
      signal.sampleAt(NaN),
      signal.bandAt("missing"),
      signal.eventAt("missing").age,
    ])
      expect(Number.isFinite(value)).toBe(true);
    expect(signal.sampleAt(0)).toBe(1);
    expect(signal.bandAt("missing")).toBe(0);
  });
  it("clears history and onset envelopes on short seeks and explicit transport revisions", () => {
    const signal = new PlayerSignal();
    const state = {
      ...playing(),
      position: 10,
      spectrum: Array(32).fill(1),
      visualizationRevision: 1,
    };
    signal.update(state);
    signal.advance(0.1);
    signal.update({ ...state, position: 10.1 });
    expect(signal.hit).toBeGreaterThan(0);
    signal.update({ ...state, position: 10.8, spectrum: Array(32).fill(0) });
    expect(signal.songTime).toBe(10.8);
    expect(signal.levelAt(0.1)).toBe(0);
    expect(signal.hit).toBe(0);
    expect(signal.pulse).toBe(0);
    signal.update({ ...state, position: 10.8 });
    signal.update({
      ...state,
      position: 10.85,
      visualizationRevision: 2,
      spectrum: Array(32).fill(0),
    });
    expect(signal.songTime).toBe(10.85);
    expect(signal.levelAt(0.05)).toBe(0);
    expect(signal.hit).toBe(0);
  });
});
