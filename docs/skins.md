# MikuAmp skin format v1

A skin is a UTF-8 JSON file, conventionally named `name.mikuamp.json`. The complete examples (one per built-in skin) are in `output/skin-packs/`. Packs embed their WebP/PNG/JPEG assets as data URIs, so they remain portable after import. Remote asset URLs and arbitrary CSS are rejected.

```json
{
  "version": 1,
  "id": "my-skin",
  "name": "My skin",
  "subtitle": "Teal / charcoal",
  "dotMatrix": false,
  "sketch": false,
  "scene": "data:image/webp;base64,...",
  "chrome": "data:image/webp;base64,...",
  "preview": "data:image/webp;base64,...",
  "colors": {
    "bg": "#111b1e", "panel": "#1c2a2f", "screen": "#08191b",
    "text": "#e1eeec", "muted": "#92aaa9", "accent": "#65e6cf",
    "secondary": "#f683b8", "edge": "#405353"
  }
}
```

All eight colors are six-digit hex. A light `screen` color turns the display into "paper": the clock, spectrum and other readouts use the `text` color instead of a glow, and visualizers are drawn dark on light. `dotMatrix: true` adds an LED dot texture; `sketch: true` adds hand-drawn styling (handwritten labels using Windows' Segoe Print, uneven pencil outlines, hatched selections and ruled notebook lines in the queue). Each embedded asset must be under approximately 6 MB; the full input file must be under 24 MB. Actual local-storage capacity depends on WebView2, so compact WebP assets are recommended. Failed imports show an error and leave the current skin selected.

The scene is a wide illustration behind the player display; place the character on the right and leave the left half quiet. Chrome is the horizontal title-bar material. Preview is a square thumbnail. Do not bake labels or controls into artwork: MikuAmp draws these independently for Unicode text, scaling, focus and accessible hit targets.

The generated masters are 1536×1024 atlases. The top 73.5% becomes the scene, the bottom material strip becomes chrome (after an 8-pixel gutter), and a crop of the right half becomes the preview. Exact pixel coordinates are recorded in each `public/skins/<id>/slices.json`. Full masters are kept in `assets/skin-atlases/`.

Run `node scripts/pack-skins.mjs` to package the current built-in runtime slices as standalone importable skins. `scripts/slice-skins.mjs` rebuilds the slices from the original generated-image locations recorded in `scripts/skin-sources.json`; the masters in the repository are the portable source of truth if those original locations are unavailable.
