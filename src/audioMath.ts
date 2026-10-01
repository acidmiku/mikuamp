import type { Band, Eq } from "./types";
export const toneControls = [
  ["Temperature", "Cool", "Warm"],
  ["Bass extension", "Light", "Deep"],
  ["Bass texture", "Fast", "Thumpy"],
  ["Note thickness", "Crisp", "Thick"],
  ["Vocals", "Recessed", "Forward"],
  ["Female overtones", "Under", "Over"],
  ["Sibilance · low", "Soft", "Crisp"],
  ["Sibilance · high", "Soft", "Crisp"],
  ["Impulse", "Slow", "Fast"],
  ["Air", "Soft", "Crisp"],
];
export function filters(eq: Eq): Band[] {
  const bands = eq.enabled ? eq.bands.slice() : [];
  if (eq.toneEnabled) {
    const v = eq.tone;
    const specs: [number, number, number, Band["kind"]][] = [
      [180, v[0] * 0.1, 0.5, "lowShelf"],
      [4500, -v[0] * 0.1, 0.5, "highShelf"],
      [55, v[1] * 0.25, 0.7, "lowShelf"],
      [90, v[2] * 0.2, 1, "peak"],
      [200, v[3] * 0.12, 0.7, "peak"],
      [650, v[4] * 0.12, 0.6, "peak"],
      [3300, v[5] * 0.09, 2, "peak"],
      [5500, v[6] * 0.1, 1.5, "peak"],
      [8500, v[7] * 0.1, 1.5, "peak"],
      [6500, v[8] * 0.1, 0.5, "peak"],
      [12000, v[9] * 0.25, 0.7, "highShelf"],
    ];
    for (const [frequency, gain, q, kind] of specs)
      bands.push({ frequency, gain, q, kind });
  }
  return bands;
}
export function coefficients(b: Band, rate = 48000) {
  const a = 10 ** (b.gain / 40),
    w = (2 * Math.PI * Math.min(b.frequency, rate * 0.45)) / rate,
    c = Math.cos(w),
    alpha = Math.sin(w) / (2 * b.q),
    t = 2 * Math.sqrt(a) * alpha;
  let values: number[];
  if (b.kind === "lowShelf")
    values = [
      a * (a + 1 - (a - 1) * c + t),
      2 * a * (a - 1 - (a + 1) * c),
      a * (a + 1 - (a - 1) * c - t),
      a + 1 + (a - 1) * c + t,
      -2 * (a - 1 + (a + 1) * c),
      a + 1 + (a - 1) * c - t,
    ];
  else if (b.kind === "highShelf")
    values = [
      a * (a + 1 + (a - 1) * c + t),
      -2 * a * (a - 1 + (a + 1) * c),
      a * (a + 1 + (a - 1) * c - t),
      a + 1 - (a - 1) * c + t,
      2 * (a - 1 - (a + 1) * c),
      a + 1 - (a - 1) * c - t,
    ];
  else
    values = [
      1 + alpha * a,
      -2 * c,
      1 - alpha * a,
      1 + alpha / a,
      -2 * c,
      1 - alpha / a,
    ];
  return values.map((n) => n / values[3]);
}
export function response(bands: Band[], frequency: number, rate = 48000) {
  const w = (2 * Math.PI * Math.min(frequency, rate * 0.49)) / rate;
  return bands.reduce((gain, b) => {
    const [b0, b1, b2, , a1, a2] = coefficients(b, rate);
    const n =
      (b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w)) ** 2 +
      (b1 * Math.sin(w) + b2 * Math.sin(2 * w)) ** 2;
    const d =
      (1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w)) ** 2 +
      (a1 * Math.sin(w) + a2 * Math.sin(2 * w)) ** 2;
    return gain + 10 * Math.log10(n / d);
  }, 0);
}
