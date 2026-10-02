# MikuAmp

A Windows desktop music player inspired by Winamp 2. Rust handles playback and DSP. Tauri v2 hosts the React controls in WebView2.

[Download for Windows](https://github.com/acidmiku/mikuamp/releases/latest/download/MikuAmp-Setup.exe) · [Website](https://mikuamp.iridescence.tech/) · [Releases](https://github.com/acidmiku/mikuamp/releases)

## Builds and publishing

[Windows build](https://github.com/acidmiku/mikuamp/actions/workflows/windows.yml) tests the frontend and Rust engine, then builds a Windows x64 installer and standalone executable. App changes on `main` and pull requests produce downloadable workflow artifacts. Pushing a matching version tag (for example, `v0.1.0`) publishes both executables and SHA-256 checksums to a GitHub Release. Update `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together before tagging. Release executables are currently unsigned.

[Publish website](https://github.com/acidmiku/mikuamp/actions/workflows/pages.yml) builds the landing page, runs browser checks against the production output, and deploys it to GitHub Pages when website changes land on `main`. Pull requests build and test without deploying. Actions are pinned to commit SHAs. macOS and Linux packaging is not enabled yet.

The website source is in `site/`. Run `npm run site:dev` to preview it, or `npm run site:build` followed by `npm run site:preview` for a production preview. `SITE_URL=http://127.0.0.1:4174/ npm run site:test` tests that build (set `$env:SITE_URL` in PowerShell). It uses local WebGL shaders, self-hosted Space Grotesk under the included SIL Open Font License, and real app screenshots. `scripts/site-assets.mjs` derives website images from the visual-review captures and bundled skin atlases.

The custom domain `mikuamp.iridescence.tech` is a DNS-only Cloudflare CNAME to `acidmiku.github.io`. GitHub Pages manages HTTPS. Deployment requires no Cloudflare token; DNS credentials are not stored in this repository or in Actions.

## Run

```powershell
npm install
npm run desktop
```

Build a standalone executable and Windows installer:

```powershell
npm run tauri -- build
```

The executable is `src-tauri/target/release/mikuamp.exe`. The installer is in `src-tauri/target/release/bundle/nsis/`. Windows needs WebView2, which the installer checks for. Development needs Node, Rust, and the Visual Studio C++ build tools.

`npm run dev` is a browser preview. Its local-file playback uses the browser decoder; native metadata, DSP, spectrum, and separate windows are provided by the desktop application.

## Controls

- Open button or **Ctrl+O**: add audio files to the queue and library.
- Drag files or folders into any window to import them.
- **Space**: play/pause; when a button is focused, activate that button. **Left/Right**: seek five seconds. In the playlist, **Up/Down/Home/End** select tracks; double-click or **Enter** plays the selection. **Delete** removes it and keeps focus on the next track. **Tab** moves out of the list.
- **EQ / PL / LIB**: toggle the equalizer, playlist, or album library. The buttons light up while their windows are open; closing a window also releases its button. Hiding a panel does not interrupt playback.
- Drag any panel by its titlebar to separate it. Bring its edge near another panel to snap them together. Dragging the main player moves its connected panels with it. Window positions and visibility persist.
- The player and its open panels share taskbar activation and minimize/restore behavior.
- **SKINS**: show/hide the skin picker; choose a built-in skin or import a `.mikuamp.json` pack. All windows update together.
- Scale selector in **SKINS**: 100%, 115%, or 130%, in addition to normal Windows display scaling.
- Library, queue, volume, shuffle, repeat, EQ, Tone, and skin selections persist. Startup does not autoplay.

## Audio

The pipeline is **Symphonia → 32-bit floating-point PCM → Rust biquad DSP → windowed-sinc resampling → Rodio/CPAL → WASAPI shared**. Source-rate DSP uses 64-bit filter coefficients and state. Files stream from disk rather than being decoded fully into memory. The bar spectrum is a 2048-point Hann-windowed FFT of processed audio, not an animation. Rate changes use a 256-tap Blackman-windowed sinc filter, 1024 interpolated phases, and preallocated streaming buffers. Matching sample rates bypass the converter. Downsampling rejects ultrasonic content instead of folding it into audible frequencies.

FLAC, MP3, WAV, AIFF, AAC/M4A, ALAC and Ogg Vorbis are supported by the configured decoders. Source files can be high resolution; shared output follows the Windows device mix rate. **Exclusive output, ASIO, and bit-perfect playback are not implemented.** Device selection currently follows the default output when the stream opens; changing devices during playback requires restarting the player.

Native playback is gapless: the upcoming track is opened, processed, resampled, and queued ahead of time on the same output stream and sink. The audio callback crosses source boundaries without waiting for the UI or the worker's polling interval, including repeat-one/all and mixed source rates or channel counts. Source-boundary notifications keep the queue index and per-track position in sync. Symphonia trims encoder delay and padding where supported by the format and its metadata; silence recorded into the audio itself remains. If an upcoming file cannot be opened or decoded, the current track finishes and playback stops with an error. Browser-preview playback does not use this native pipeline.

The requested quality indicator is based on file encoding and bitrate:

| Badge | Rule |
|---|---|
| LQ | Lossy formats, including MP3 and AAC |
| SQ | Lossless at or below 1500 kbps |
| HR | Lossless above 1500 kbps |

This deliberately follows the requested bitrate rule. It is not a scientific quality rating: a highly compressible 24/96 FLAC can still fall below 1500 kbps.

### Equalizer

Ten parametric bands with editable frequency, gain, Q, and peak/low-shelf/high-shelf type, plus preamp, bypass, presets, and a response plot. Processing is independent per channel. Full-scale overflow is clamped; lower the preamp when boosting PEQ bands. Flat, disabled processing does not add an effect.

### Tone

Independent MSEB-inspired filters estimated from [Pragmatic Audio's HiBy R1 measurements](https://www.pragmaticaudio.com/reviews/2025/02/hiby-r1/#mseb-eq-measurements). These are **approximations, not HiBy's implementation or a calibrated emulation**. The graphs provide extreme responses but not exact slider laws, all intermediate settings, or phase/time-domain behavior. The impulse slider here changes frequency response only.

Positive temperature adds warmth; other positive controls boost their named region. Sliders are linearly mapped to filter gains. See `docs/tone-curves.md` for the frequencies, Q and gains. Tone applies automatic attenuation based on the combined EQ response to leave headroom. The graph shows the response before this automatic attenuation. No HiBy code or graph artwork is bundled.

## Library

Unicode paths and tags, album-artist grouping, disc/track order, recursive folder scans, search, album playback, and queueing. Folder artwork (`cover`, `folder`, `front`, `album`, then other image files) is preferred, with embedded artwork as a fallback. Supported cover files: JPEG, PNG, WebP. Artwork is decoded with memory limits and reduced to thumbnails. Metadata and covers are cached locally. Web cover lookup is not implemented.

The Windows data directory is `%APPDATA%/audio.mikuamp.desktop` (resolved through Tauri). `MIKUAMP_DATA_DIR` can override native data storage for isolated tests. Skin/UI preferences live in WebView2 local storage. Saved playlists are UTF-8 M3U8; playlist import is not yet implemented.

## Skins

Five bundled skins: Classic Teal, Sakura, Midnight, Snow, and 39.exe (dot matrix). Each has its own generated Miku illustration, sliced scene/chrome/preview assets, and color tokens. Text, hit targets and controls are rendered separately at device resolution.

- Full atlases: `assets/skin-atlases/`
- Runtime slices and crop coordinates: `public/skins/`
- Exact image-generation prompts and source provenance: `scripts/skin-sources.json`
- Portable packs: `output/skin-packs/` (regenerate with `node scripts/pack-skins.mjs`)
- Skin format: `docs/skins.md`

Artwork was generated using the built-in image generation tool, then deterministically cropped with Sharp. The DSEG display font is bundled under the SIL Open Font License; its license is in `public/fonts/DSEG-LICENSE.txt`. MikuAmp is an independent fan project, not affiliated with Winamp, Crypton Future Media, or HiBy. Classic Winamp WSZ skins are not compatible with this format.

## Validation

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
node scripts/ui-smoke.mjs
node scripts/visual-review.mjs final
node scripts/visual-interactions.mjs
node scripts/visual-scale-check.mjs
```

The Rust suite includes device-free gapless tests that render real WAV decoders through DSP, resampling, and Rodio's sink/mixer, checking exact consecutive output samples, mixed formats, repeat/shuffle, seek, pause, skip, queue edits, preload failures, and no-autoplay restoration. The full application Rust test command currently requires Windows because of the native window module.

Browser checks require the Vite server on port 1420 and Microsoft Edge. The visual harness runs Edge headlessly with simulated desktop IPC, all five themes, Unicode metadata, window scaling, keyboard navigation, and skin import. It never opens or controls the native player. Results and screenshots are in `output/visual-review/`. Its artwork fixtures and import packs are generated by `node scripts/make-fixtures.mjs` and `node scripts/pack-skins.mjs`.

Native integration tests generate low-volume original test signals with FFmpeg (`node scripts/make-fixtures.mjs`), launch the debug app with an isolated data directory and WebView2 remote debugging on port 9223, then run `node scripts/native-smoke.mjs`. Do not enable the debugging port for normal listening. Results are written to `output/native-test-results.json`; screenshots to `output/screenshots/`.
