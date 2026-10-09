import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Shuffle,
  Star,
} from "lucide-react";
import type { Snapshot } from "../types";
import { withTransition } from "../motion";
import { Menu, Spectrum, type MenuItem } from "../ui";
import {
  CLASSIC,
  choose,
  presetFor,
  randomFrom,
  rotation,
  stepFrom,
  toggleFavorite,
  useVisualPrefs,
} from "./preferences";
import { createPainter, fitCanvas, lcdTint, tint, type Painter } from "./paint";
import { PlayerSignal } from "./signal";

/** The player's display visual: Classic bars or an archive renderer, with quick switching. */
export function Visualizer({
  snapshot,
  trackId,
  skin,
  onExpandedChange,
  onBrowse,
}: {
  snapshot: Snapshot;
  trackId: string | undefined;
  skin: string;
  onExpandedChange: (expanded: boolean) => void;
  onBrowse: () => void;
}) {
  const [prefs, update] = useVisualPrefs();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // The name chip shows for a few seconds after load or a change, then fades.
  const [fresh, setFresh] = useState(true);
  const [announce, setAnnounce] = useState(0);
  const [failed, setFailed] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const painter = useRef<Painter | null>(null);
  const signal = useRef(new PlayerSignal());
  const latest = useRef(snapshot);
  const dirty = useRef(true);
  const color = useRef("#fff");
  const preset = presetFor(
    failed === prefs.selected ? CLASSIC : prefs.selected,
  );
  const classic = preset.id === CLASSIC;
  const favorite = prefs.favorites.includes(prefs.selected);

  useEffect(() => {
    const wasPlaying = latest.current.playing;
    latest.current = snapshot;
    signal.current.update(snapshot);
    if (snapshot.playing || wasPlaying !== snapshot.playing)
      dirty.current = true;
  }, [snapshot]);
  useEffect(() => {
    onExpandedChange(prefs.expanded);
  }, [prefs.expanded, onExpandedChange]);
  useEffect(() => {
    color.current = lcdTint(surface.current);
    dirty.current = true;
  }, [skin]);

  const first = useRef(true);
  useEffect(() => {
    setFresh(true);
    if (first.current) first.current = false;
    else setAnnounce((n) => n + 1);
    const t = setTimeout(() => setFresh(false), 3000);
    return () => clearTimeout(t);
  }, [prefs.selected]);

  // Optional: a different visual for each new track.
  const lastTrack = useRef(trackId);
  useEffect(() => {
    if (trackId === lastTrack.current) return;
    lastTrack.current = trackId;
    if (trackId && prefs.auto !== "off")
      update((p) => choose(randomFrom(p, p.auto === "favorites"))(p));
  }, [trackId, prefs.auto, update]);

  useEffect(() => {
    let alive = true;
    painter.current = null;
    dirty.current = true;
    if (!classic)
      void createPainter(preset)
        .then((paint) => {
          if (alive) {
            painter.current = paint;
            dirty.current = true;
          }
        })
        .catch(() => alive && setFailed(preset.id));
    return () => {
      alive = false;
    };
  }, [preset, classic]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d", { alpha: false });
    if (!el || !ctx) return;
    let frame = 0,
      last = 0,
      size = fitCanvas(el);
    const observer = new ResizeObserver(() => {
      size = fitCanvas(el);
      dirty.current = true;
    });
    observer.observe(el);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden || now - last < 1000 / 30) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
      last = now;
      const paint = painter.current;
      if (!paint || (!latest.current.playing && !dirty.current)) return;
      dirty.current = false;
      signal.current.advance(dt);
      const { width, height, ratio } = size;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      try {
        paint(ctx, width, height, signal.current);
        tint(ctx, width, height, color.current);
      } catch {
        setFailed(preset.id);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [classic, preset.id]);

  const step = useCallback(
    (direction: 1 | -1) => update((p) => choose(stepFrom(p, direction))(p)),
    [update],
  );
  const expand = () =>
    withTransition(() => update((p) => ({ ...p, expanded: !p.expanded })));
  // V / Shift+V flip visuals from anywhere in the player window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "v" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.defaultPrevented ||
        (e.target as HTMLElement).closest("input,select,textarea")
      )
        return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const list = rotation(prefs);
  const position = list.findIndex((v) => v.id === prefs.selected) + 1;
  const items: MenuItem[] = [
    {
      label: "Next visual",
      icon: <ChevronRight size={13} />,
      shortcut: "V",
      onSelect: () => step(1),
    },
    {
      label: "Previous visual",
      icon: <ChevronLeft size={13} />,
      shortcut: "Shift+V",
      onSelect: () => step(-1),
    },
    {
      label: favorite ? "Remove from favorites" : "Add to favorites",
      icon: <Star size={13} fill={favorite ? "currentColor" : "none"} />,
      shortcut: "F",
      onSelect: () => update(toggleFavorite(prefs.selected)),
    },
    {
      label: "Surprise me",
      icon: <Shuffle size={13} />,
      onSelect: () => update((p) => choose(randomFrom(p, false))(p)),
    },
    "divider",
    {
      label: "Browse visuals…",
      icon: <LayoutGrid size={13} />,
      shortcut: "Enter",
      onSelect: onBrowse,
    },
    {
      label: prefs.expanded ? "Shrink display" : "Enlarge display",
      icon: prefs.expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />,
      onSelect: expand,
    },
  ];
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <div
      ref={surface}
      className={`visualizer ${classic ? "is-classic" : ""}`}
      data-visualizer={preset.id}
      data-shape={preset.shape}
      role="group"
      aria-label={`Visual: ${preset.name}`}
      tabIndex={0}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) expand();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key.toLowerCase() === "f")
          update(toggleFavorite(prefs.selected));
        else if (e.key === "Enter") onBrowse();
        else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left + 12, y: r.bottom });
        } else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {classic ? (
        <Spectrum bars={snapshot.spectrum} />
      ) : (
        <canvas ref={canvas} key={preset.id} aria-hidden="true" />
      )}
      <div className={`viz-controls ${fresh ? "fresh" : ""}`}>
        <button
          aria-label="Previous visual"
          title="Previous visual (Shift+V)"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={12} />
        </button>
        <button
          className="viz-name"
          key={announce}
          aria-label={`Browse visuals; showing ${preset.name}`}
          title="Browse visuals · right-click for more"
          onClick={onBrowse}
        >
          {favorite && <Star size={8} fill="currentColor" />}
          {preset.name}
          {fresh && announce > 0 && position > 0 && (
            <small>
              {position}/{list.length}
            </small>
          )}
        </button>
        <button
          aria-label="Next visual"
          title="Next visual (V)"
          onClick={() => step(1)}
        >
          <ChevronRight size={12} />
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {announce ? `Visual: ${preset.name}` : ""}
      </span>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Visual"
          items={items}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
