import { useCallback, useEffect, useState } from "react";
import { archivePresets } from "./archive";

export type VisualPreset = {
  id: string;
  name: string;
  category: string;
  shape: "strip" | "square";
};
export type AutoChange = "off" | "favorites" | "all";
export type VisualPrefs = {
  selected: string;
  favorites: string[];
  recent: string[];
  expanded: boolean;
  auto: AutoChange;
};

export const CLASSIC = "classic-bars";
export const visualPresets: readonly VisualPreset[] = [
  { id: CLASSIC, name: "Classic bars", category: "Classic", shape: "strip" },
  ...archivePresets.map(({ id, name, category, shape }) => ({
    id,
    name,
    category,
    shape,
  })),
];
const byId = new Map(visualPresets.map((p) => [p.id, p]));
export const presetFor = (id: string) => byId.get(id) ?? visualPresets[0];

const KEY = "mikuamp-visualizer";
const SYNC = "mikuamp-visual-prefs";
const RECENT = 12;

/** Reads saved preferences, including the earlier {selected, favorites, expanded} shape. */
export function parsePrefs(raw: string | null): VisualPrefs {
  const ids = (value: unknown, limit: number) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string => typeof id === "string" && byId.has(id),
            ),
          ),
        ].slice(0, limit)
      : [];
  try {
    const saved = JSON.parse(raw ?? "null");
    return {
      selected: byId.has(saved?.selected) ? saved.selected : CLASSIC,
      favorites: ids(saved?.favorites, visualPresets.length),
      recent: ids(saved?.recent, RECENT),
      expanded: saved?.expanded === true,
      auto: ["favorites", "all"].includes(saved?.auto) ? saved.auto : "off",
    };
  } catch {
    return parsePrefs(null);
  }
}
function readPrefs() {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return parsePrefs(null);
  }
}

/** Shared between windows through localStorage, like the skin selection. */
export function useVisualPrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    // Other windows hear about changes through storage events; components in
    // this window (the player and a preview-mode browser) through SYNC.
    const sync = (e: StorageEvent) => {
      if (e.key === KEY) setPrefs(parsePrefs(e.newValue));
    };
    const local = (e: Event) =>
      setPrefs((e as CustomEvent<VisualPrefs>).detail);
    window.addEventListener("storage", sync);
    window.addEventListener(SYNC, local);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SYNC, local);
    };
  }, []);
  const update = useCallback(
    (change: (p: VisualPrefs) => VisualPrefs) => {
      const next = change(prefs);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* Preferences still apply for this session without storage. */
      }
      window.dispatchEvent(new CustomEvent(SYNC, { detail: next }));
    },
    [prefs],
  );
  return [prefs, update] as const;
}

export const choose =
  (id: string) =>
  (p: VisualPrefs): VisualPrefs =>
    id === p.selected
      ? p
      : {
          ...p,
          selected: id,
          // Square compositions need the large display to be legible.
          expanded: presetFor(id).shape === "square" || p.expanded,
          recent: [id, ...p.recent.filter((r) => r !== id)].slice(0, RECENT),
        };
export const toggleFavorite =
  (id: string) =>
  (p: VisualPrefs): VisualPrefs => ({
    ...p,
    favorites: p.favorites.includes(id)
      ? p.favorites.filter((f) => f !== id)
      : [...p.favorites, id],
  });

/** Next/previous flips through favourites once there are two, else the whole catalog. */
export function rotation(p: VisualPrefs) {
  return p.favorites.length >= 2
    ? visualPresets.filter((v) => p.favorites.includes(v.id))
    : visualPresets;
}
export function stepFrom(p: VisualPrefs, direction: 1 | -1) {
  const list = rotation(p);
  const at = list.findIndex((v) => v.id === p.selected);
  const next =
    at < 0
      ? direction > 0
        ? 0
        : list.length - 1
      : (at + direction + list.length) % list.length;
  return list[next].id;
}
export function randomFrom(p: VisualPrefs, onlyFavorites: boolean) {
  const pool = visualPresets.filter(
    (v) =>
      v.id !== p.selected &&
      (!onlyFavorites || !p.favorites.length || p.favorites.includes(v.id)),
  );
  return pool.length
    ? pool[Math.floor(Math.random() * pool.length)].id
    : p.selected;
}
