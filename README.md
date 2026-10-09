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

`npm run dev` is a browser preview. Its local-file playback uses the browser decoder and a WebAudio analyser; native metadata, DSP, and separate windows are provided by the desktop application.

## Controls

- Open button or **Ctrl+O**: add audio files to the queue and library.
- Drag files or folders into any window to import them.
- **Space**: play/pause; when a button is focused, activate that button. **Left/Right**: seek five seconds. The mouse wheel over the artwork changes volume. Click the total time to show time remaining.
- **EQ / Queue / Library**: toggle the equalizer, queue, or album library. The buttons light up while their windows are open; closing a window also releases its button. Hiding a panel does not interrupt playback.
- Mini player button or **Ctrl+M**: shrink the player to a compact window. Open panels are tucked away and come back attached when you return to the full player.
- In the queue, **Up/Down/Home/End** select tracks; double-click or **Enter** plays the selection and **Ctrl+Enter** plays it next. **Delete** removes it and keeps focus on the next track. Drag a row, or press **Alt+Up/Down**, to reorder. Right-click (or **Shift+F10**) for Play now, Play next, Show album and Remove. **Tab** moves out of the list.
- In the library, album covers offer Play, Play next and Add to queue on hover. **Ctrl+F** searches. Playing an album replaces the queue; Remove, Clear and replacing the queue can be undone from the notice that follows.
- **Visuals**: hover the display's visual for previous/next arrows and its name; click the name (or press **Enter** on the focused visual) to open the Visuals browser. **V** / **Shift+V** flip to the next/previous visual from anywhere in the player, cycling through your favorites once you have starred two. Right-click the visual for Next, Previous, Add to favorites, Surprise me, Browse and Enlarge; **F** stars the focused visual, and double-click enlarges the display. In the browser one click switches the player immediately and the browser stays open; arrow keys move through the previews and **F** stars one. The browser can also change the visual with each new track.
- In the equalizer, drag a band's point on the curve to set frequency and gain (hold **Shift** to change gain only), use the mouse wheel over it for Q, and double-click to reset its gain. A focused point also responds to **arrow keys** (gain and frequency; **Shift** for fine steps) and **Page Up/Down** (Q). The headroom badge warns when parametric boosts can clip and offers to lower the preamp.
- Drag any panel by its titlebar to separate it. Bring its edge near another panel to snap them together. Dragging the main player moves its connected panels with it. Window positions and visibility persist.
- The player and its open panels share taskbar activation and minimize/restore behavior.
- **Skins** (the button shows the current skin): show/hide the skin picker; choose a built-in skin or import a `.mikuamp.json` pack. All windows update together.
- Scale selector in **Skins**: 100%, 115%, or 130%, in addition to normal Windows display scaling.
- Library, queue, volume, shuffle, repeat, EQ, Tone, skin, visual, favorite visuals, saved EQ presets and mini-player selections persist. Startup does not autoplay.
- Animations follow the Windows "Animation effects" setting (reduced motion turns them off).

## Audio

The pipeline is **Symphonia → 32-bit floating-point PCM → Rust biquad DSP → windowed-sinc resampling → Rodio/CPAL → WASAPI shared**. Source-rate DSP uses 64-bit filter coefficients and state. Files stream from disk rather than being decoded fully into memory. The bar spectrum is a 2048-point Hann-windowed FFT of processed audio, not an animation. Rate changes use a 256-tap Blackman-windowed sinc filter, 1024 interpolated phases, and preallocated streaming buffers. Matching sample rates bypass the converter. Downsampling rejects ultrasonic content instead of folding it into audible frequencies.

FLAC, MP3, WAV, AIFF, AAC/M4A, ALAC and Ogg Vorbis are supported by the configured decoders. Source files can be high resolution; shared output follows the Windows device mix rate. **Exclusive output, ASIO, bit-perfect playback, and gapless playback are not implemented.** Device selection currently follows the default output when the stream opens; changing devices during playback requires restarting the player.

The requested quality indicator is based on file encoding and bitrate:

| Badge | Rule |
|---|---|
| LQ | Lossy formats, including MP3 and AAC |
| SQ | Lossless at or below 1500 kbps |
| HR | Lossless above 1500 kbps |

This deliberately follows the requested bitrate rule. It is not a scientific quality rating: a highly compressible 24/96 FLAC can still fall below 1500 kbps.

### Equalizer

Ten parametric bands with editable frequency, gain, Q, and peak/low-shelf/high-shelf type, plus preamp, bypass, presets, and a response plot. Processing is independent per channel. Full-scale overflow is clamped; lower the preamp when boosting PEQ bands. Flat, disabled processing does not add an effect.

### Visualizers

Classic bars plus all **155 runnable presets** from [Kagan Yaldizkaya's iwrzwr visual archive](https://github.com/kaganin/iwrzwr-visual-archive): 152 compact studies and three square compositions, organized into their original 28 collections. Square compositions open in a larger display so their details remain visible. The Visuals browser shows every preset as a live preview driven by the current playback, grouped by collection, with search, favorites and recently used lists; off-screen previews do not draw.

The bundled Canvas renderers load one collection at a time and run at up to 30 fps, rendered at display pixel density. The player supplies its actual post-DSP FFT bands, a roughly 32 ms mono waveform, measured band onsets, and bounded audio history; there is no synthetic demo soundtrack or microphone access. Pausing freezes the display, and hidden windows skip drawing. Native audio capture uses fixed buffers and the existing nonblocking analysis lock. These are artistic visualizers, not calibrated instruments or stereo phase meters.

The original MIT license is included at `public/licenses/iwrzwr-visual-archive.txt`. Source revision, adaptation details, and reproduction instructions are in `src/visualizers/archive/README.md`.

### Tone

Independent MSEB-inspired filters estimated from [Pragmatic Audio's HiBy R1 measurements](https://www.pragmaticaudio.com/reviews/2025/02/hiby-r1/#mseb-eq-measurements). These are **approximations, not HiBy's implementation or a calibrated emulation**. The graphs provide extreme responses but not exact slider laws, all intermediate settings, or phase/time-domain behavior. The impulse slider here changes frequency response only.

Positive temperature adds warmth; other positive controls boost their named region. Sliders are linearly mapped to filter gains. See `docs/tone-curves.md` for the frequencies, Q and gains. Tone applies automatic attenuation based on the combined EQ response to leave headroom. The graph shows the response before this automatic attenuation. No HiBy code or graph artwork is bundled.

## Library

Unicode paths and tags, album-artist grouping, disc/track order, recursive folder scans, search, album playback, and queueing. Folder artwork (`cover`, `folder`, `front`, `album`, then other image files) is preferred, with embedded artwork as a fallback. Supported cover files: JPEG, PNG, WebP. Artwork is decoded with memory limits and reduced to thumbnails. Metadata and covers are cached locally. Web cover lookup is not implemented.

The Windows data directory is `%APPDATA%/audio.mikuamp.desktop` (resolved through Tauri). `MIKUAMP_DATA_DIR` can override native data storage for isolated tests. Skin/UI preferences live in WebView2 local storage. Saved playlists are UTF-8 M3U8; playlist import is not yet implemented.

## Skins

Six bundled skins: Classic Teal, Sakura, Midnight, Snow, 39.exe (dot matrix), and Pencil (a graphite sketch on ruled notebook paper, with handwritten labels and a paper display). Each has its own generated Miku illustration, sliced scene/chrome/preview assets, and color tokens. Text, hit targets and controls are rendered separately at device resolution.

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
node scripts/visualizer-picker-check.mjs
node scripts/visualizer-audio-check.mjs
```

Browser checks require the Vite server on port 1420 and Microsoft Edge. The visual harness runs Edge headlessly with simulated desktop IPC, all six themes, Unicode metadata, window scaling, keyboard navigation, and skin import. It never opens or controls the native player. Results and screenshots are in `output/visual-review/`. Its artwork fixtures and import packs are generated by `node scripts/make-fixtures.mjs` and `node scripts/pack-skins.mjs`.

Native integration tests generate low-volume original test signals with FFmpeg (`node scripts/make-fixtures.mjs`), launch the debug app with an isolated data directory and WebView2 remote debugging on port 9223, then run `node scripts/native-smoke.mjs`. Do not enable the debugging port for normal listening. Results are written to `output/native-test-results.json`; screenshots to `output/screenshots/`.
