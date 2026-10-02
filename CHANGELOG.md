# Changelog

## Unreleased

### Added

- Gapless native playback using one persistent output stream and sink, with the next track prepared and queued before the current track ends.
- Device-free Rust regression tests for sample-exact consecutive transitions, mixed sample rates and channel counts, repeat-one/all, shuffle, manual next/previous, pause, seek, queue removal/replacement/clear, failed preloads, shared EQ/spectrum processing, and no-autoplay session restoration.

### Fixed

- Queue index and playback position now follow individual source boundaries, including repeated tracks and duplicate queue entries.
- Queue and playback-mode changes invalidate an unstarted successor without interrupting the current track. Seeking prepares the selected track before replacing playback, preserving pause state and preventing seeks from landing on a newly started successor.
- The output mixer sees a constant device format across track boundaries and idle periods.

## 0.1.0 — 2026-10-01

- Initial Windows release with native playback, EQ and Tone processing, spectrum analysis, an album library, persistent queues and settings, and five bundled skins.
