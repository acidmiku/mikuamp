/** MikuAmp's adapter for the archive's sample-backed draw programs (no demo audio). */
export function analysisAt(signal, seconds) {
  const age = Math.max(0, signal.songTime - seconds);
  const band = name => signal.bandAt(name, age);
  return {
    amp: signal.levelAt(age),
    low: band('low'), mid: band('mid'), high: band('high'),
    left: band('left'), right: band('right'), balance: band('balance'),
    travel: Math.max(0, signal.travel - age * Math.max(0, band('amp'))),
    bins: Array.from({ length: 8 }, (_, i) => signal.spectrumAt(i / 7, age)),
  };
}
