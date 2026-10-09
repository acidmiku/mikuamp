import { loadArchiveRenderer, type ArchiveRenderer } from "./archive";
import { CLASSIC, type VisualPreset } from "./preferences";
import type { PlayerSignal } from "./signal";

/** Draws Classic bars on a canvas (used where the DOM spectrum is not). */
function classicBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  signal: PlayerSignal,
) {
  const step = width / 32,
    bar = Math.max(1, step - 2);
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 32; i++) {
    const level = signal.spectrumAt(i / 31);
    const h = Math.max(1, level * (height - 2));
    for (let y = 0; y < h; y += 3)
      ctx.fillRect(i * step, height - y - 2, bar, Math.min(2, h - y));
  }
}

export type Painter = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  signal: PlayerSignal,
) => void;

/**
 * Creates an isolated painter for one preset. Archive art is authored in white
 * and red on black; the caller tints it and blends black away (see `tint`).
 */
export async function createPainter(preset: VisualPreset): Promise<Painter> {
  if (preset.id === CLASSIC)
    return (ctx, w, h, signal) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      classicBars(ctx, w, h, signal);
    };
  const draw: ArchiveRenderer = await loadArchiveRenderer(preset.id);
  return (ctx, w, h, signal) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    // Strips keep the archive's 226×44 proportion; squares stay square.
    const dw = preset.shape === "square" ? Math.min(w, h) : w;
    const dh = preset.shape === "square" ? dw : Math.min(h, (w * 44) / 226);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.translate((w - dw) / 2, (h - dh) / 2);
    try {
      draw(ctx, dw, dh, signal.songTime, signal);
    } finally {
      ctx.restore();
    }
  };
}

/** Multiplies the white artwork toward the skin's display colour; black stays black. */
export function tint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
}

/** Resolves the skin's LCD colour (which may be a color-mix) and softens it toward white. */
export function lcdTint(from: Element | null) {
  if (!from) return "#fff";
  const probe = document.createElement("i");
  probe.style.cssText = "position:absolute;color:var(--lcd)";
  from.appendChild(probe);
  const rgb = getComputedStyle(probe)
    .color.match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  probe.remove();
  if (!rgb || rgb.length < 3) return "#fff";
  // A dark LCD colour means a paper display: CSS inverts the art there instead.
  if (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 128) return "#fff";
  // Half-way to white keeps the archive's red accents readable.
  const [r, g, b] = rgb.map((v) => Math.round(v + (255 - v) * 0.45));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Canvas backing size for the element's on-screen pixels (CSS zoom × DPI). */
export function fitCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  const ratio = Math.min(
    4,
    Math.max(1, (bounds.width / Math.max(1, width)) * devicePixelRatio),
  );
  const w = Math.max(1, Math.round(width * ratio)),
    h = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width, height, ratio };
}
