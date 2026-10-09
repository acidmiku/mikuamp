import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowDown,
  GripVertical,
  LibraryBig,
  ListStart,
  Minus,
  Music2,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { time, type Snapshot, type Track } from "./types";
import { reducedMotion, useFlip } from "./motion";
import { isNative, Menu, Quality, type MenuItem } from "./ui";

type Entry = { track: Track; index: number; key: string };
type Gesture = {
  key: string;
  from: number;
  startY: number;
  startScroll: number;
  row: number;
  zoom: number;
  moved: boolean;
};

/** Where an entry must move so it plays right after the current track. */
export function nextSlot(from: number, current: number | null) {
  if (current === null) return 0;
  return from > current ? current + 1 : current;
}

export function Queue({
  tracks,
  snapshot,
  act,
  openFiles,
  run,
  remove,
  clear,
  showAlbum,
}: {
  tracks: Track[];
  snapshot: Snapshot;
  act: (a: string, v?: unknown) => void;
  openFiles: () => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  remove: (index: number) => void;
  clear: () => void;
  showAlbum: (track: Track) => void;
}) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(
      null,
    ),
    [drag, setDrag] = useState<{
      key: string;
      over: number;
      dy: number;
    } | null>(null),
    [optimistic, setOptimistic] = useState<string[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const focusKey = useRef<string | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const afterRemove = useRef<{ length: number; index: number } | null>(null);

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const queueKey = snapshot.queue.join("\n");
  const entries = useMemo(() => {
    const seen = new Map<string, number>();
    const out: Entry[] = [];
    snapshot.queue.forEach((id, index) => {
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      const track = byId.get(id);
      if (track) out.push({ track, index, key: `${id}#${n}` });
    });
    return out;
    // queueKey captures the queue's contents; the array identity changes every poll.
  }, [queueKey, byId]);
  // A dropped row stays where it landed until the engine reports that order.
  // Polls can skip intermediate states, so a stale guess also expires.
  useEffect(() => {
    if (!optimistic) return;
    const expected = optimistic
      .map((k) => k.slice(0, k.lastIndexOf("#")))
      .join("\n");
    if (expected === queueKey) {
      setOptimistic(null);
      return;
    }
    const t = setTimeout(() => setOptimistic(null), 600);
    return () => clearTimeout(t);
  }, [queueKey, optimistic]);
  // Until then, indices follow the dropped order so quick follow-up actions
  // (another move, Play next, Delete) address the rows the user sees.
  const ordered = optimistic
    ? optimistic
        .map((k) => entries.find((e) => e.key === k))
        .filter((e): e is Entry => !!e)
        .map((e, index) => ({ ...e, index }))
    : entries;
  const needle = search.toLocaleLowerCase();
  const list = needle
    ? ordered.filter(({ track }) =>
        `${track.title} ${track.artist} ${track.album}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : ordered;
  const capture = useFlip(listRef, list.map((e) => e.key).join("|"));
  const total = entries.reduce((n, e) => n + e.track.duration, 0);
  const selectedVisible = list.some((entry) => entry.index === selected);
  const tabIndex = selectedVisible
    ? selected
    : (list.find((entry) => entry.index === snapshot.index)?.index ??
      list[0]?.index);
  const canReorder = !needle && list.length > 1;

  const rowEl = (selector: string) =>
    listRef.current?.querySelector<HTMLElement>(selector);
  const focusRow = (index: number) => {
    const row = rowEl(`[data-index="${index}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  };
  const removeAt = (index: number) => {
    afterRemove.current = { length: snapshot.queue.length, index };
    remove(index);
  };
  // Moving a focused row re-parents its DOM node, which drops focus. Keep it on
  // that row through the optimistic and confirmed re-renders that follow.
  const keepFocus = (key: string) => {
    focusKey.current = key;
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => (focusKey.current = null), 1000);
  };
  const move = (entry: Entry, to: number) => {
    if (to === entry.index || to < 0 || to >= snapshot.queue.length) return;
    keepFocus(entry.key);
    setSelected(to);
    act("move", { from: entry.index, to });
  };
  const playNext = (entry: Entry) =>
    move(entry, nextSlot(entry.index, snapshot.index));

  useEffect(() => {
    const pending = afterRemove.current;
    if (pending && snapshot.queue.length !== pending.length) {
      afterRemove.current = null;
      const next =
        list.find((entry) => entry.index >= pending.index) ?? list.at(-1);
      setSelected(next?.index ?? null);
      if (next) focusRow(next.index);
      else searchRef.current?.focus();
    }
    if (focusKey.current)
      rowEl(`[data-flip="${CSS.escape(focusKey.current)}"]`)?.focus({
        preventScroll: true,
      });
    // Runs once per queue change, after rows are re-keyed.
  }, [queueKey, optimistic]);

  // Follow playback through the list unless the user is working in it.
  useEffect(() => {
    const root = listRef.current;
    if (
      snapshot.index === null ||
      !root ||
      root.matches(":hover, :focus-within")
    )
      return;
    rowEl(`[data-index="${snapshot.index}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [snapshot.index]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, entry: Entry) => {
    if (!canReorder || e.button !== 0 || e.ctrlKey || e.shiftKey) return;
    const row = e.currentTarget;
    const rect = row.getBoundingClientRect();
    gesture.current = {
      key: entry.key,
      from: list.indexOf(entry),
      startY: e.clientY,
      startScroll: listRef.current?.scrollTop ?? 0,
      row: row.offsetHeight,
      // Pointer deltas are in screen pixels; transforms are in zoomed CSS pixels.
      zoom: rect.height / row.offsetHeight || 1,
      moved: false,
    };
    row.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const root = listRef.current;
    if (!g || !root) return;
    if (!g.moved && Math.abs(e.clientY - g.startY) < 5) return;
    g.moved = true;
    // Edge auto-scroll while carrying a row.
    const bounds = root.getBoundingClientRect();
    if (e.clientY < bounds.top + 24) root.scrollTop -= 8;
    else if (e.clientY > bounds.bottom - 24) root.scrollTop += 8;
    const dy =
      (e.clientY - g.startY) / g.zoom + (root.scrollTop - g.startScroll);
    const over = Math.min(
      list.length - 1,
      Math.max(0, g.from + Math.round(dy / g.row)),
    );
    setDrag({ key: g.key, over, dy });
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved || !drag) {
      setDrag(null);
      return;
    }
    swallowClick.current = true;
    const to = drag.over;
    if (to !== g.from) {
      capture();
      const keys = list.map((x) => x.key);
      const [key] = keys.splice(g.from, 1);
      keys.splice(to, 0, key);
      setOptimistic(keys);
      const entry = list[g.from];
      keepFocus(entry.key);
      setSelected(list[to].index);
      act("move", { from: entry.index, to: list[to].index });
    } else capture();
    setDrag(null);
  };
  const shiftFor = (position: number, key: string) => {
    if (!drag) return undefined;
    const g = gesture.current;
    if (key === drag.key) return `translateY(${drag.dy}px)`;
    if (!g) return undefined;
    if (g.from < drag.over && position > g.from && position <= drag.over)
      return `translateY(${-g.row}px)`;
    if (drag.over < g.from && position >= drag.over && position < g.from)
      return `translateY(${g.row}px)`;
    return undefined;
  };

  const menuItems = (entry: Entry): MenuItem[] => [
    {
      label: "Play now",
      icon: <Play size={13} />,
      shortcut: "Enter",
      onSelect: () => act("play", entry.index),
    },
    {
      label: "Play next",
      icon: <ListStart size={13} />,
      shortcut: "Ctrl+Enter",
      disabled:
        snapshot.index === null ||
        entry.index === snapshot.index ||
        entry.index === snapshot.index + 1,
      onSelect: () => playNext(entry),
    },
    {
      label: "Show album",
      icon: <LibraryBig size={13} />,
      onSelect: () => showAlbum(entry.track),
    },
    "divider",
    {
      label: "Remove from queue",
      icon: <Minus size={13} />,
      shortcut: "Del",
      danger: true,
      onSelect: () => removeAt(entry.index),
    },
  ];
  const closeMenu = useCallback(() => setMenu(null), []);

  const exportList = () =>
    void run(async () => {
      if (isNative) {
        const path = await save({
          defaultPath: "MikuAmp.m3u8",
          filters: [{ name: "UTF-8 playlist", extensions: ["m3u8"] }],
        });
        if (path) await invoke("export_playlist", { path });
      } else {
        const text =
          "#EXTM3U\n" +
          entries
            .map(
              ({ track }) =>
                `#EXTINF:${Math.floor(track.duration)},${track.artist} - ${track.title}\n${track.path}`,
            )
            .join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(
          new Blob([text], { type: "audio/x-mpegurl" }),
        );
        a.download = "MikuAmp.m3u8";
        a.click();
        URL.revokeObjectURL(a.href);
      }
    });

  return (
    <div className="playlist">
      <div className="playlist-meta">
        <span>
          {snapshot.queue.length}{" "}
          {snapshot.queue.length === 1 ? "track" : "tracks"}
          <b>·</b>
          {time(total)}
        </span>
        <label className="search-field">
          <Search size={12} />
          <input
            ref={searchRef}
            aria-label="Search queue"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find in queue"
          />
        </label>
      </div>
      <div
        ref={listRef}
        className={`track-list ${drag ? "reordering" : ""}`}
        role="listbox"
        aria-label="Queue tracks"
      >
        {list.length ? (
          list.map((entry, position) => {
            const { track: t, index, key } = entry;
            const current = snapshot.index === index;
            return (
              <div
                key={key}
                role="option"
                aria-selected={selected === index}
                aria-current={current || undefined}
                title={`${t.artist} — ${t.title}\n${t.album}`}
                className={`track-row ${current ? "current-track" : ""} ${selected === index ? "selected-track" : ""} ${drag?.key === key ? "lifted" : ""}`}
                data-index={index}
                data-flip={key}
                style={{ transform: shiftFor(position, key) }}
                tabIndex={index === tabIndex ? 0 : -1}
                onFocus={() => setSelected(index)}
                onClick={() => {
                  if (swallowClick.current) swallowClick.current = false;
                  else setSelected(index);
                }}
                onDoubleClick={() => act("play", index)}
                onPointerDown={(e) => onPointerDown(e, entry)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected(index);
                  setMenu({ x: e.clientX, y: e.clientY, entry });
                }}
                onKeyDown={(e) => {
                  let next = position;
                  if (e.altKey && e.key === "ArrowUp" && canReorder)
                    move(entry, index - 1);
                  else if (e.altKey && e.key === "ArrowDown" && canReorder)
                    move(entry, index + 1);
                  else if (e.key === "ArrowDown")
                    next = Math.min(list.length - 1, position + 1);
                  else if (e.key === "ArrowUp")
                    next = Math.max(0, position - 1);
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = list.length - 1;
                  else if (e.key === "Enter" && e.ctrlKey) playNext(entry);
                  else if (e.key === "Enter") act("play", index);
                  else if (e.code === "Space")
                    act(current && snapshot.playing ? "pause" : "play", index);
                  else if (e.key === "Delete") removeAt(index);
                  else if (
                    e.key === "ContextMenu" ||
                    (e.shiftKey && e.key === "F10")
                  ) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.left + 40, y: r.bottom, entry });
                  } else return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (next !== position) focusRow(list[next].index);
                }}
              >
                {canReorder && (
                  <GripVertical size={12} className="grip" aria-hidden="true" />
                )}
                <span className="track-index">
                  {current && snapshot.playing ? (
                    <span className="mini-playing" aria-label="Playing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <div className="track-info">
                  <strong>{t.title}</strong>
                  <Quality track={t} />
                  {t.artist && <small>{t.artist}</small>}
                </div>
                <span className="track-duration">{time(t.duration)}</span>
              </div>
            );
          })
        ) : (
          <div className="empty-state">
            <Music2 size={24} />
            <strong>{search ? "No matching tracks" : "Queue is empty"}</strong>
            <span>
              {search
                ? "Try a different title, artist or album."
                : "Add files, or drop music here."}
            </span>
          </div>
        )}
      </div>
      <div className="playlist-actions">
        <button onClick={openFiles}>
          <Plus size={12} />
          Add
        </button>
        <button
          disabled={!selectedVisible}
          onClick={() => {
            if (selected !== null && selectedVisible) removeAt(selected);
          }}
        >
          <Minus size={12} />
          Remove
        </button>
        <button
          disabled={!snapshot.queue.length}
          onClick={clear}
          title="Clear queue; your library is kept"
        >
          <Trash2 size={12} />
          Clear
        </button>
        <span />
        <button disabled={!snapshot.queue.length} onClick={exportList}>
          Save list <ArrowDown size={11} />
        </button>
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Track actions"
          items={menuItems(menu.entry)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
