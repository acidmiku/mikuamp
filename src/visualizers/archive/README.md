# iwrzwr visual archive in MikuAmp

155 selectable renderers: the public archive's 152 compact studies and three square compositions. The original collection and study names are retained. The upstream “164” count includes an editorial convention for the three compositions; these are three actual canvases.

Original drawing code: [Kagan Yaldizkaya / iwrzwr visual archive](https://github.com/kaganin/iwrzwr-visual-archive), MIT, copyright 2026 Kagan Yaldizkaya. The complete license is preserved in [LICENSE](./LICENSE). The reviewed revision is `003922f7912dd5fa51073c4337686e5be161fb47`.

`generated/` contains static ES modules extracted from the upstream drawing dependency closures. There is no runtime source evaluation, iframe, remote fetch, hidden gallery, or separate audio engine. DOM controls, animation loops, demo synthesis, marketing, analytics, fonts, and unused studies are excluded. `provenance.json` records each source collection.

`loadArchiveRenderer(id)` lazily loads one collection and returns a new isolated renderer. The player owns the frame clock, canvas dimensions, visibility, and playback lifecycle. Compact studies preserve the archive's 44-unit height and scale uniformly; square compositions use a contained square. Renderers save and restore the canvas context.

The archive's existing `iwrSignal` seam receives the player's measured spectrum, waveform, envelopes, onsets, and history. The 32 sample-based studies use the same live signal through `signal-bridge.js`; their original synthetic demonstration soundtrack is removed. Authored geometry remains authored geometry: the effects respond to music but are not scientific measurements of it.

To reproduce vendoring, clone the repository into `output/reference/iwrzwr-visual-archive`, check out the revision above, then run `node scripts/vendor-visualizers.mjs`. An optional first argument selects a different local checkout. The script requires the exact reviewed commit and fails if DOM, network, dynamic evaluation, or audio engine dependencies survive extraction.
