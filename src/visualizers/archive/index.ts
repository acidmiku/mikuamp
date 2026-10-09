/// <reference types="vite/client" />
import catalog from './presets.json';

/** PCM-derived features supplied by MikuAmp; values and historical reads must be finite. */
export interface ArchiveSignal {
  active: boolean;
  source: string;
  level: number;
  low: number;
  mid: number;
  high: number;
  pulse: number;
  hit: number;
  kickAge: number;
  snareAge: number;
  hatAge: number;
  noteAge: number;
  beat: number;
  songTime: number;
  loopTime: number;
  travel: number;
  lowPhase: number;
  midPhase: number;
  highPhase: number;
  levelAt(age: number): number;
  hitAt(age: number): number;
  /** amp, low, mid, high, left, right, balance, travel. Unknown bands return zero. */
  bandAt(band: string, age?: number): number;
  spectrumAt(position: number, age?: number): number;
  /** Signed waveform sample at an age in seconds, usually within the last 32 ms. */
  sampleAt(age?: number, channel?: string): number;
  eventAt(kind: string, age?: number): { n: number; age: number };
}

export interface ArchivePreset {
  id: string;
  name: string;
  category: string;
  collectionId: string;
  item: number;
  shape: 'strip' | 'square';
}

export type ArchiveRenderer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  signal: ArchiveSignal,
) => void;

type ArchiveModule = { default: (item: number) => ArchiveRenderer };
const modules = import.meta.glob<ArchiveModule>('./generated/*.js');

export const archivePresets = catalog as readonly ArchivePreset[];

/** Loads one static collection chunk and creates a new, isolated renderer instance. */
export async function loadArchiveRenderer(id: string): Promise<ArchiveRenderer> {
  const preset = archivePresets.find(entry => entry.id === id);
  if (!preset) throw new Error(`Unknown visualizer: ${id}`);
  const load = modules[`./generated/${preset.collectionId}.js`];
  if (!load) throw new Error(`Missing visualizer collection: ${preset.collectionId}`);
  const module = await load();
  return module.default(preset.item);
}
