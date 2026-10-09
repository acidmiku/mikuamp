import { useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import {
  ChevronLeft,
  Disc3,
  FolderOpen,
  ListPlus,
  ListStart,
  Play,
  Plus,
  Search,
} from "lucide-react";
import { albumsFrom, time, type Track } from "./types";
import { withTransition } from "./motion";
import { Cover, IconButton, Quality } from "./ui";

export type QueueMode = "play" | "next" | "end";

export function Library({
  tracks,
  current,
  queue,
  addFolder,
  busy,
  request,
}: {
  tracks: Track[];
  current?: Track;
  queue: (ts: Track[], mode: QueueMode, start?: number) => void;
  addFolder: () => void;
  busy: boolean;
  request: { id: string; at: number } | null;
}) {
  const [search, setSearch] = useState(""),
    [albumId, setAlbumId] = useState<string | null>(null),
    // The card whose cover morphs into the detail header and back.
    [morph, setMorph] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const albums = albumsFrom(tracks);
  const needle = search.toLocaleLowerCase();
  const visible = albums.filter((a) =>
    `${a.title} ${a.artist} ${a.tracks.map((t) => t.title).join(" ")}`
      .toLocaleLowerCase()
      .includes(needle),
  );
  const selected = albums.find((a) => a.id === albumId);
  const open = (id: string | null) => {
    if (id) flushSync(() => setMorph(id));
    withTransition(() => setAlbumId(id));
  };
  useEffect(() => {
    if (request) {
      // Opened from another window: no cover to morph from, so no transition.
      setSearch("");
      setMorph(request.id);
      setAlbumId(request.id);
    }
    // A new request (even for the same album) re-opens it.
  }, [request]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const morphName = (id: string): CSSProperties =>
    (morph === id ? { viewTransitionName: "album-art" } : {}) as CSSProperties;

  return (
    <div className="album-library">
      <div className="library-heading">
        <p>
          {albums.length} {albums.length === 1 ? "album" : "albums"} <b>·</b>{" "}
          {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
        </p>
        <button className="primary-button" onClick={addFolder} disabled={busy}>
          <FolderOpen size={14} />
          Add folder
        </button>
      </div>
      <label className="library-search">
        <Search size={14} />
        <input
          ref={searchRef}
          aria-label="Search library"
          placeholder="Search albums, artists, tracks"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (albumId) open(null);
          }}
        />
        <kbd>Ctrl F</kbd>
      </label>
      {selected ? (
        <div className="album-detail">
          <button
            className="text-button back-button"
            onClick={() => open(null)}
          >
            <ChevronLeft size={13} />
            All albums
          </button>
          <div className="album-detail-heading">
            <div className="detail-art" style={morphName(selected.id)}>
              <Cover cover={selected.cover} title={selected.title} />
            </div>
            <div>
              <h2 title={selected.title}>{selected.title}</h2>
              <p title={selected.artist}>{selected.artist}</p>
              <p className="album-meta">
                {selected.tracks.length}{" "}
                {selected.tracks.length === 1 ? "track" : "tracks"} ·{" "}
                {time(selected.tracks.reduce((n, t) => n + t.duration, 0))}
              </p>
              <div className="album-buttons">
                <button
                  className="primary-button"
                  onClick={() => queue(selected.tracks, "play")}
                >
                  <Play size={13} fill="currentColor" />
                  Play
                </button>
                <button
                  className="secondary-button"
                  onClick={() => queue(selected.tracks, "next")}
                >
                  <ListStart size={13} />
                  Play next
                </button>
                <button
                  className="secondary-button"
                  onClick={() => queue(selected.tracks, "end")}
                >
                  <ListPlus size={13} />
                  Add to queue
                </button>
              </div>
            </div>
          </div>
          <div className="album-songs">
            {selected.tracks.map((t, i) => (
              <div
                key={t.id}
                className={`album-song ${current?.id === t.id ? "active" : ""}`}
                style={{ "--i": Math.min(i, 16) } as CSSProperties}
              >
                <button
                  className="album-song-play"
                  title={`Play ${t.title} and the rest of the album`}
                  onClick={() => queue(selected.tracks, "play", i)}
                >
                  <span className="album-song-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Play
                    size={11}
                    fill="currentColor"
                    className="album-song-icon"
                  />
                  <span className="track-info">
                    <strong>{t.title}</strong>
                    <Quality track={t} />
                  </span>
                  <span className="track-duration">{time(t.duration)}</span>
                </button>
                <IconButton
                  label={`Play ${t.title} next`}
                  onClick={() => queue([t], "next")}
                >
                  <ListStart size={13} />
                </IconButton>
                <IconButton
                  label={`Add ${t.title} to queue`}
                  onClick={() => queue([t], "end")}
                >
                  <ListPlus size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      ) : visible.length ? (
        <div className="album-grid">
          {visible.map((a, i) => (
            <article
              className="album-card"
              key={a.id}
              style={{ "--i": Math.min(i, 14) } as CSSProperties}
            >
              <div className="album-art" style={morphName(a.id)}>
                <button
                  className="album-cover-button"
                  onClick={() => open(a.id)}
                  aria-label={`Open ${a.title}`}
                >
                  <Cover cover={a.cover} title={a.title} />
                </button>
                <span className="album-count">
                  {a.tracks.length} {a.tracks.length === 1 ? "TRACK" : "TRACKS"}
                </span>
                <div className="album-actions">
                  <button
                    className="album-play"
                    aria-label={`Play album ${a.title}`}
                    title="Play album"
                    onClick={() => queue(a.tracks, "play")}
                  >
                    <Play size={17} fill="currentColor" />
                  </button>
                  <button
                    aria-label={`Play ${a.title} next`}
                    title="Play next"
                    onClick={() => queue(a.tracks, "next")}
                  >
                    <ListStart size={14} />
                  </button>
                  <button
                    aria-label={`Add ${a.title} to queue`}
                    title="Add to queue"
                    onClick={() => queue(a.tracks, "end")}
                  >
                    <ListPlus size={14} />
                  </button>
                </div>
              </div>
              <button
                className="album-card-info"
                onClick={() => open(a.id)}
                title={`${a.title} — ${a.artist}`}
              >
                <strong>{a.title}</strong>
                <small>{a.artist}</small>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <Disc3 size={36} strokeWidth={1} />
          <h2>{search ? "No matching albums" : "Library empty"}</h2>
          <p>
            {search
              ? "Try another album, artist, or song."
              : "Add a music folder to scan albums and cover art."}
          </p>
          {!search && (
            <button className="primary-button" onClick={addFolder}>
              <Plus size={15} />
              Add folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
