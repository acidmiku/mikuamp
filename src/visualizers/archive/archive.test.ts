import { describe, expect, it } from 'vitest';
import { archivePresets, loadArchiveRenderer, type ArchiveSignal } from './index';

function signal(level: number, time: number, active = true): ArchiveSignal {
  return {
    active, source: 'player', level, low: level, mid: level, high: level,
    pulse: level, hit: level, kickAge: .1, snareAge: .2, hatAge: .05, noteAge: .2,
    beat: 10, songTime: time, loopTime: time, travel: time * .3,
    lowPhase: time, midPhase: time * 1.3, highPhase: time * 1.7,
    levelAt: () => level, hitAt: () => level,
    bandAt: band => band === 'balance' ? .1 : level,
    spectrumAt: () => level, sampleAt: (age = 0) => Math.sin(age * 100) * level,
    eventAt: () => ({ n: 10, age: .1 }),
  };
}

/** Canvas recording catches bad geometry without a DOM or browser/audio globals. */
function recordingContext() {
  let count = 0, depth = 0;
  const gradient = { addColorStop() {} };
  const fields: Record<string | symbol, unknown> = {
    getTransform: () => ({ a: 1, b: 0 }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: () => ({ width: 8 }),
    save: () => { depth++; }, restore: () => { depth--; },
  };
  const ctx = new Proxy(fields, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        count++;
        for (const value of args) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Nonfinite ${String(key)} coordinate`);
      };
    },
    set(target, key, value) { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, count: () => count, depth: () => depth };
}

describe('vendored archive renderers', () => {
  it('retains every actual public gallery preset under a unique stable ID', () => {
    expect(archivePresets).toHaveLength(155);
    expect(new Set(archivePresets.map(preset => preset.id)).size).toBe(155);
    expect(archivePresets.filter(preset => preset.shape === 'square')).toHaveLength(3);
  });

  it.each(archivePresets)('$name renders finite geometry at compact and expanded sizes', async preset => {
    const draw = await loadArchiveRenderer(preset.id);
    const recorder = recordingContext();
    for (const active of [false, true]) {
      for (const level of [0, .7]) {
        for (const time of [0, 4, 360]) {
          for (const [width, height] of [[232, 28], [450, 100]]) {
            draw(recorder.ctx, width, height, time, signal(level, time, active));
            expect(recorder.depth()).toBe(0);
          }
        }
      }
    }
    expect(recorder.count()).toBeGreaterThan(0);
  });

  it('rejects unknown IDs without evaluating supplied source', async () => {
    await expect(loadArchiveRenderer('not-a-preset')).rejects.toThrow('Unknown visualizer');
  });
});
