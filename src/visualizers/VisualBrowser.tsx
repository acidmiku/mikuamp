import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Clock3, LayoutGrid, Search, Shuffle, Star } from "lucide-react";
import type { Snapshot } from "../types";
import {
  choose,
  randomFrom,
  toggleFavorite,
  useVisualPrefs,
  visualPresets,
  type AutoChange,
  type VisualPreset,
} from "./preferences";
import { createPainter, fitCanvas, lcdTint, tint, type Painter } from "./paint";
import { PlayerSignal } from "./signal";

type Filter = "all" | "favorites" | "recent" | string;
type Card = {
  preset: VisualPreset;
  canvas: HTMLCanvasElement;
  painter: Painter | null;
  loading: boolean;
  visible: boolean;
  drawn: boolean;
};

const categories = (() => {
  const counts = new Map<string, number>();
  for (const p of visualPresets)
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts];
})();

/**
 * Live previews for on-screen cards. One loop draws every visible card at a
 * modest frame rate from the same playback signal; off-screen cards cost nothing.
 */
function usePreviews(
  snapshot: Snapshot,
  root: RefObject<HTMLElement | null>,
  skin: string,
) {
  const cards = useRef(new Map<HTMLCanvasElement, Card>());
  const signal = useRef(new PlayerSignal());
  const playing = useRef(snapshot.playing);
  const color = useRef("#fff");
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    signal.current.update(snapshot);
    if (playing.current !== snapshot.playing)
      cards.current.forEach((c) => (c.drawn = false));
    playing.current = snapshot.playing;
  }, [snapshot]);
  useEffect(() => {
    color.current = lcdTint(root.current);
    cards.current.forEach((c) => (c.drawn = false));
  }, [skin, root]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const card = cards.current.get(entry.target as HTMLCanvasElement);
          if (!card) continue;
          card.visible = entry.isIntersecting;
          card.drawn = false;
          if (card.visible && !card.painter && !card.loading) {
            card.loading = true;
            void createPainter(card.preset)
              .then((p) => (card.painter = p))
              .catch(() => undefined)
              .finally(() => (card.loading = false));
          }
        }
      },
      { root: root.current, rootMargin: "80px" },
    );
    observer.current = io;
    cards.current.forEach((c) => io.observe(c.canvas));
    let frame = 0,
      last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden || now - last < 1000 / 20) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.05;
      last = now;
      signal.current.advance(dt);
      cards.current.forEach((card) => {
        // Paused previews draw once and then hold still.
        if (!card.visible || !card.painter || (card.drawn && !playing.current))
          return;
        const ctx = card.canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        const { width, height, ratio } = fitCanvas(card.canvas);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        try {
          card.painter(ctx, width, height, signal.current);
          tint(ctx, width, height, color.current);
        } catch {
          card.painter = null;
        }
        card.drawn = true;
      });
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      observer.current = null;
    };
  }, [root]);
  // One stable ref callback per preset, so re-renders never reload a painter.
  const refs = useRef(
    new Map<string, (canvas: HTMLCanvasElement | null) => () => void>(),
  );
  return (preset: VisualPreset) => {
    let ref = refs.current.get(preset.id);
    if (!ref) {
      ref = (canvas: HTMLCanvasElement | null) => {
        if (canvas) {
          cards.current.set(canvas, {
            preset,
            canvas,
            painter: null,
            loading: false,
            visible: false,
            drawn: false,
          });
          observer.current?.observe(canvas);
        }
        return () => {
          if (!canvas) return;
          observer.current?.unobserve(canvas);
          cards.current.delete(canvas);
        };
      };
      refs.current.set(preset.id, ref);
    }
    return ref;
  };
}

export function VisualBrowser({
  snapshot,
  skin,
}: {
  snapshot: Snapshot;
  skin: string;
}) {
  const [prefs, update] = useVisualPrefs();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const preview = usePreviews(snapshot, grid, skin);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    const base =
      filter === "favorites"
        ? visualPresets.filter((p) => prefs.favorites.includes(p.id))
        : filter === "recent"
          ? prefs.recent
              .map((id) => visualPresets.find((p) => p.id === id)!)
              .filter(Boolean)
          : filter === "all"
            ? visualPresets
            : visualPresets.filter((p) => p.category === filter);
    return base.filter((p) => {
      const text = `${p.name} ${p.category}`.toLocaleLowerCase();
      return terms.every((t) => text.includes(t));
    });
  }, [filter, prefs.favorites, prefs.recent, terms.join(" ")]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Bring the current visual into view when the browser opens or the filter changes.
  useEffect(() => {
    grid.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [filter]);

  /** Arrow keys move through the grid by its live column count. */
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const picks = Array.from(
      grid.current?.querySelectorAll<HTMLButtonElement>(".vb-pick") ?? [],
    );
    const at = picks.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const top = picks[0]?.offsetTop;
    const columns = Math.max(
      1,
      picks.filter((p) => p.offsetTop === top).length,
    );
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
      Home: -at,
      End: picks.length - 1 - at,
    };
    if (e.key.toLowerCase() === "f") {
      update(toggleFavorite(shown[at].id));
      e.preventDefault();
      return;
    }
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next =
      picks[Math.max(0, Math.min(picks.length - 1, at + moves[e.key]))];
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  };

  const rail: [Filter, string, number, ReactNode][] = [
    ["all", "All visuals", visualPresets.length, <LayoutGrid size={13} />],
    ["favorites", "Favorites", prefs.favorites.length, <Star size={13} />],
    ["recent", "Recent", prefs.recent.length, <Clock3 size={13} />],
  ];
  const empty =
    filter === "favorites" && !prefs.favorites.length
      ? "Star visuals to build a rotation. ‹ › and V then flip through just those."
      : filter === "recent" && !prefs.recent.length
        ? "Visuals you pick show up here."
        : "No visuals match.";

  return (
    <div className="visual-browser">
      <div className="vb-toolbar">
        <label className="library-search">
          <Search size={14} />
          <input
            ref={search}
            aria-label="Search visuals"
            placeholder="Search visuals"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>Ctrl F</kbd>
        </label>
        <button
          className="secondary-button"
          onClick={() => update((p) => choose(randomFrom(p, false))(p))}
        >
          <Shuffle size={13} />
          Surprise me
        </button>
      </div>
      <div className="vb-body">
        <nav className="vb-rail" aria-label="Visual collections">
          {rail.map(([id, label, count, icon]) => (
            <button
              key={id}
              className={filter === id ? "on" : ""}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {icon}
              <span>{label}</span>
              <i>{count}</i>
            </button>
          ))}
          <hr />
          {categories.map(([name, count]) => (
            <button
              key={name}
              className={filter === name ? "on" : ""}
              aria-pressed={filter === name}
              onClick={() => setFilter(name)}
            >
              <span>{name}</span>
              <i>{count}</i>
            </button>
          ))}
        </nav>
        <div
          ref={grid}
          className="vb-grid"
          role="group"
          aria-label="Visuals"
          onKeyDown={onGridKey}
        >
          {shown.map((preset, i) => {
            const current = preset.id === prefs.selected;
            const star = prefs.favorites.includes(preset.id);
            return (
              <article
                key={preset.id}
                className={`vb-card ${current ? "current" : ""} ${preset.shape}`}
                style={{ "--i": Math.min(i, 12) } as CSSProperties}
              >
                <button
                  className="vb-pick"
                  aria-pressed={current}
                  aria-label={`Show ${preset.name}`}
                  title={`${preset.name} · ${preset.category}`}
                  tabIndex={
                    current ||
                    (i === 0 && !shown.some((p) => p.id === prefs.selected))
                      ? 0
                      : -1
                  }
                  onClick={() => update(choose(preset.id))}
                >
                  <span className="vb-art">
                    <canvas ref={preview(preset)} aria-hidden="true" />
                  </span>
                  <span className="vb-meta">
                    <strong>{preset.name}</strong>
                    <small>{preset.category}</small>
                  </span>
                  {current && <span className="vb-now">SHOWING</span>}
                </button>
                <button
                  className={`vb-star ${star ? "on" : ""}`}
                  aria-label={`${star ? "Remove" : "Add"} ${preset.name} ${star ? "from" : "to"} favorites`}
                  aria-pressed={star}
                  title={
                    star ? "Remove from favorites (F)" : "Add to favorites (F)"
                  }
                  tabIndex={-1}
                  onClick={() => update(toggleFavorite(preset.id))}
                >
                  <Star size={13} fill={star ? "currentColor" : "none"} />
                </button>
              </article>
            );
          })}
          {!shown.length && <p className="vb-empty">{empty}</p>}
        </div>
      </div>
      <footer className="vb-footer">
        <label>
          With each new track
          <select
            aria-label="Change visual with each new track"
            value={prefs.auto}
            onChange={(e) =>
              update((p) => ({ ...p, auto: e.target.value as AutoChange }))
            }
          >
            <option value="off">keep this visual</option>
            <option value="favorites">pick a favorite</option>
            <option value="all">pick any visual</option>
          </select>
        </label>
        <span className="vb-credit" title="MIT licence; see public/licenses">
          Art: Kagan Yaldizkaya · iwrzwr visual archive
        </span>
      </footer>
    </div>
  );
}
