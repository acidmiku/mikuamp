import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDown,
  Check,
  ChevronDown,
  Disc3,
  FolderOpen,
  LibraryBig,
  ListMusic,
  Minus,
  Music2,
  Palette,
  Pause,
  Pin,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import * as api from "./bridge";
import {
  albumsFrom,
  defaultEq,
  emptySnapshot,
  hz,
  time,
  type Band,
  type Eq,
  type Snapshot,
  type Track,
} from "./types";
import { filters, response, toneControls } from "./audioMath";
import {
  isLightSkin,
  loadSkins,
  skins,
  validateSkin,
  type Skin,
} from "./skins";

const panelName = new URLSearchParams(location.search).get("panel") || "main";
const isNative = api.native;
if (isNative) document.documentElement.classList.add("native");
type Panel = "library" | "equalizer" | "playlist" | "skins";
const labels: Record<Panel, string> = {
  library: "ALBUM LIBRARY",
  equalizer: "EQUALIZER",
  playlist: "PLAYLIST",
  skins: "SKINS",
};
function IconButton({
  label,
  children,
  onClick,
  active,
  disabled = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Titlebar({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="mini-mark" data-tauri-drag-region>
        m
      </span>
      <div className="title-center" data-tauri-drag-region>
        <span className="title-lines" data-tauri-drag-region />
        <span className="window-title" data-tauri-drag-region>
          {title}
        </span>
        <span className="title-lines" data-tauri-drag-region />
      </div>
      <div className="title-actions">
        {!onClose && isNative && panelName === "main" && (
          <IconButton
            label="Minimize"
            onClick={() => void getCurrentWindow().minimize()}
          >
            <Minus size={12} />
          </IconButton>
        )}
        <IconButton
          label={`Close ${title.toLowerCase()}`}
          onClick={
            onClose ||
            (() => {
              if (isNative) void getCurrentWindow().close();
            })
          }
        >
          <X size={12} />
        </IconButton>
      </div>
    </header>
  );
}
function Quality({ track }: { track?: Track }) {
  return (
    <span
      className={`quality quality-${track?.quality || "SQ"}`}
      title="LQ: lossy · SQ: lossless up to 1500 kbps · HR: lossless above 1500 kbps"
    >
      {track?.quality || "—"}
    </span>
  );
}
function Spectrum({ bars, playing }: { bars: number[]; playing: boolean }) {
  return (
    <div
      className={`spectrum ${playing ? "playing" : ""}`}
      aria-label="Live audio spectrum"
    >
      {bars.map((n, i) => (
        <span key={i}>
          <i style={{ height: `${Math.max(2, n * 100)}%` }} />
          <b style={{ bottom: `${Math.min(96, Math.max(3, n * 100 + 3))}%` }} />
        </span>
      ))}
    </div>
  );
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]),
    [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot),
    [eq, setEq] = useState<Eq>(defaultEq);
  const [skinList, setSkinList] = useState(loadSkins),
    [skinId, setSkinId] = useState(
      localStorage.getItem("mikuamp-skin") || "classic",
    );
  const [showEq, setShowEq] = useState(
      localStorage.getItem("mikuamp-eq-visible") !== "false",
    ),
    [showPlaylist, setShowPlaylist] = useState(
      localStorage.getItem("mikuamp-pl-visible") !== "false",
    ),
    [showLibrary, setShowLibrary] = useState(false),
    [showSkins, setShowSkins] = useState(false);
  const [modal, setModal] = useState<Panel | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [pinned, setPinned] = useState(false),
    [scale, setScale] = useState(
      Number(localStorage.getItem("mikuamp-scale")) || 1,
    );
  const browserInput = useRef<HTMLInputElement>(null),
    eqTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const unmutedVolume = useRef(0.65);
  useEffect(() => {
    if (snapshot.volume > 0) unmutedVolume.current = snapshot.volume;
  }, [snapshot.volume]);
  const selectedSkin = skinList.find((s) => s.id === skinId) || skins[0];
  const current =
    snapshot.index !== null
      ? tracks.find((t) => t.id === snapshot.queue[snapshot.index!])
      : undefined;
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError(String(e));
    }
  }, []);
  const act = useCallback(
    (action: string, value?: unknown) => {
      void run(() => api.command(action, value));
    },
    [run],
  );
  const refresh = useCallback(
    async () => setTracks(await api.getLibrary()),
    [],
  );
  useEffect(() => {
    let alive = true,
      polling = false;
    void Promise.all([api.getLibrary(), api.getEq()])
      .then(([l, e]) => {
        if (alive) {
          setTracks(l);
          setEq(e);
        }
      })
      .catch((e) => setError(String(e)));
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const s = await api.getSnapshot();
        if (alive) setSnapshot(s);
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 100);
    const unlisteners: Promise<() => void>[] = [];
    if (isNative) {
      unlisteners.push(
        listen("library-changed", () => void refresh()),
        listen<Eq>("eq-changed", (event) => setEq(event.payload)),
      );
    }
    return () => {
      alive = false;
      clearInterval(timer);
      unlisteners.forEach((p) => void p.then((f) => f()));
    };
  }, [refresh]);
  useEffect(() => {
    if (!isNative) return;
    const sync = (panels: { label: string; visible: boolean }[]) => {
      setShowEq(panels.some((p) => p.label === "equalizer" && p.visible));
      setShowPlaylist(panels.some((p) => p.label === "playlist" && p.visible));
      setShowLibrary(panels.some((p) => p.label === "library" && p.visible));
      setShowSkins(panels.some((p) => p.label === "skins" && p.visible));
    };
    const off = listen<{ label: string; visible: boolean }[]>(
      "panels-changed",
      (e) => sync(e.payload),
    );
    void invoke<{ label: string; visible: boolean }[]>("get_panels").then(sync);
    return () => {
      void off.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (!isNative || !shellRef.current) return;
    const shell = shellRef.current;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void run(() =>
          invoke("fit_panel", {
            height:
              panelName === "main" || panelName === "equalizer"
                ? shell.getBoundingClientRect().height
                : null,
            scale,
            pixelRatio: window.devicePixelRatio,
          }),
        );
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(shell);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      cancelAnimationFrame(frame);
    };
  }, [scale, run]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === "mikuamp-skin") setSkinId(e.newValue || "classic");
      if (e.key === "mikuamp-custom-skins") setSkinList(loadSkins());
      if (e.key === "mikuamp-scale") setScale(Number(e.newValue) || 1);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    localStorage.setItem("mikuamp-eq-visible", String(showEq));
    localStorage.setItem("mikuamp-pl-visible", String(showPlaylist));
  }, [showEq, showPlaylist]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const importFiles = useCallback(
    async (paths: string[], queue = true) => {
      setBusy(true);
      try {
        const result = await api.importPaths(paths);
        await refresh();
        if (queue && result.tracks.length)
          await api.enqueue(result.tracks.map((t) => t.id));
        setNotice(
          `${result.tracks.length} track${result.tracks.length === 1 ? "" : "s"} added`,
        );
        if (result.warnings.length)
          setError(
            `${result.warnings.length} file(s) skipped. ${result.warnings[0]}`,
          );
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  useEffect(() => {
    if (!isNative) return;
    const p = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") void importFiles(event.payload.paths);
    });
    return () => {
      void p.then((f) => f());
    };
  }, [importFiles]);
  const chooseFiles = useCallback(
    async (folder = false, queue = true) => {
      if (!isNative) {
        browserInput.current?.click();
        return;
      }
      await run(async () => {
        const paths = await open({
          directory: folder,
          multiple: !folder,
          title: folder ? "Add your music folder" : "Open music",
          filters: folder
            ? undefined
            : [
                {
                  name: "Audio",
                  extensions: [
                    "flac",
                    "mp3",
                    "wav",
                    "aiff",
                    "aif",
                    "m4a",
                    "aac",
                    "ogg",
                  ],
                },
              ],
        });
        if (paths)
          await importFiles(Array.isArray(paths) ? paths : [paths], queue);
      });
    },
    [importFiles, run],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          "input,select,textarea,[contenteditable=true]",
        )
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void chooseFiles();
        return;
      }
      if (e.key === "Escape") setModal(null);
      if ((e.target as HTMLElement).closest("button,a,[role=option]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (snapshot.queue.length) act(snapshot.playing ? "pause" : "play");
        else void chooseFiles();
      } else if (e.code === "ArrowRight" && current)
        act("seek", Math.min(current.duration, snapshot.position + 5));
      else if (e.code === "ArrowLeft")
        act("seek", Math.max(0, snapshot.position - 5));
      else if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    snapshot.playing,
    snapshot.position,
    snapshot.queue.length,
    current,
    act,
    chooseFiles,
  ]);
  const updateEq = (next: Eq) => {
    setEq(next);
    if (eqTimer.current) clearTimeout(eqTimer.current);
    eqTimer.current = setTimeout(
      () =>
        void run(async () => {
          await api.setEq(next);
        }),
      100,
    );
  };
  const togglePanel = (panel: Panel, visible: boolean) => {
    if (isNative)
      void run(() => invoke("set_panel_visible", { label: panel, visible }));
    else if (panel === "equalizer") setShowEq(visible);
    else if (panel === "playlist") setShowPlaylist(visible);
    else setModal(visible ? panel : null);
  };
  const libraryOpen = isNative ? showLibrary : modal === "library";
  const skinsOpen = isNative ? showSkins : modal === "skins";
  const chooseSkin = (s: Skin) => {
    setSkinId(s.id);
    localStorage.setItem("mikuamp-skin", s.id);
    setNotice(`${s.name} skin applied`);
  };
  const queueTracks = (ts: Track[], play = false) =>
    void run(async () => {
      await api.enqueue(
        ts.map((t) => t.id),
        play,
      );
      if (play) await api.command("play", 0);
      else setNotice(`${ts.length} tracks queued`);
    });
  const skinStyle = {
    ...Object.fromEntries(
      Object.entries(selectedSkin.colors).map(([k, v]) => [`--${k}`, v]),
    ),
    "--scene": `url("${selectedSkin.scene}")`,
    "--chrome": `url("${selectedSkin.chrome}")`,
    "--scale": scale,
  } as CSSProperties;
  const sharedPanel = (panel: Panel, detached = false) => {
    if (panel === "equalizer")
      return (
        <Equalizer
          eq={eq}
          update={updateEq}
          expanded={detached && !isNative}
          native={isNative}
        />
      );
    if (panel === "playlist")
      return (
        <Playlist
          tracks={tracks}
          snapshot={snapshot}
          act={act}
          openFiles={() => void chooseFiles()}
          run={run}
        />
      );
    if (panel === "library")
      return (
        <AlbumLibrary
          tracks={tracks}
          current={current}
          queue={queueTracks}
          addFolder={() => void chooseFiles(true, false)}
          busy={busy}
        />
      );
    return (
      <SkinGallery
        skins={skinList}
        selected={selectedSkin.id}
        select={chooseSkin}
        scale={scale}
        setScale={(value) => {
          setScale(value);
          localStorage.setItem("mikuamp-scale", String(value));
        }}
        importSkin={(s) => {
          const list = loadSkins().filter(
            (x) => x.id.startsWith("custom-") && x.id !== s.id,
          );
          list.push(s);
          localStorage.setItem("mikuamp-custom-skins", JSON.stringify(list));
          setSkinList(loadSkins());
          chooseSkin(s);
        }}
        error={setError}
      />
    );
  };
  return (
    <div
      ref={shellRef}
      className={`app-shell ${isNative ? `native-shell native-${panelName}` : "preview-shell"} ${selectedSkin.dotMatrix ? "dot-matrix" : ""} ${panelName === "main" ? "main-shell" : "detached-shell"} ${isLightSkin(selectedSkin) ? "light-skin" : ""}`}
      style={skinStyle}
    >
      <input
        ref={browserInput}
        type="file"
        accept="audio/*,.flac"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) {
            const files = e.target.files;
            void run(async () => {
              const added = await api.importBrowser(files);
              await refresh();
              await api.enqueue(added.map((t) => t.id));
              setNotice(`${added.length} tracks added`);
            });
          }
          e.target.value = "";
        }}
      />
      {panelName === "main" ? (
        <>
          <section className="player panel">
            <Titlebar title="MIKUAMP" />
            <div className="player-toolbar">
              <span className="wordmark">
                miku<span>amp</span>
                <i>01</i>
              </span>
              <IconButton
                label="Always on top"
                active={pinned}
                onClick={() => {
                  setPinned(!pinned);
                  if (isNative)
                    void run(() => getCurrentWindow().setAlwaysOnTop(!pinned));
                }}
              >
                <Pin size={12} />
              </IconButton>
            </div>
            <div className="player-scene">
              <div className="scene-shade" />
              <div className="listening-label">
                <i className={snapshot.playing ? "lit" : ""} />
                {snapshot.playing
                  ? "PLAYING"
                  : snapshot.position > 0
                    ? "PAUSED"
                    : "STOPPED"}
              </div>
              <div className="display">
                <div className="clock-row">
                  <span className="play-indicator">
                    {snapshot.playing ? (
                      <Play size={14} fill="currentColor" />
                    ) : (
                      <Pause size={14} />
                    )}
                  </span>
                  <span className="digital-time">
                    {time(snapshot.position).padStart(5, "0")}
                  </span>
                  <div className="channel-label">
                    {current?.channels === 1 ? "MONO" : "STEREO"}
                    <span>
                      {eq.enabled || eq.toneEnabled ? "DSP ON" : "EQ OFF"}
                    </span>
                  </div>
                </div>
                <Spectrum bars={snapshot.spectrum} playing={snapshot.playing} />
                <div className="format-line">
                  <Quality track={current} />
                  <span>
                    {current
                      ? `${current.format} · ${current.bitrate || "—"} kbps`
                      : "READY TO PLAY"}
                  </span>
                  <span>
                    {current?.sampleRate
                      ? `${+(current.sampleRate / 1000).toFixed(1)} kHz`
                      : ""}
                  </span>
                </div>
              </div>
              <div className="track-caption">
                <h1 title={current?.title}>
                  {current?.title || "No track loaded"}
                </h1>
                <p
                  title={
                    current ? `${current.artist} / ${current.album}` : undefined
                  }
                >
                  {current
                    ? `${current.artist}  /  ${current.album}`
                    : "Open files or drop music here"}
                </p>
              </div>
            </div>
            <div className="seek-row">
              <span>{time(snapshot.position)}</span>
              <input
                aria-label="Seek"
                type="range"
                min="0"
                max={current?.duration || 1}
                step=".1"
                value={Math.min(snapshot.position, current?.duration || 1)}
                disabled={!current}
                onChange={(e) => act("seek", +e.target.value)}
                style={
                  {
                    "--progress": `${current ? (snapshot.position / current.duration) * 100 : 0}%`,
                  } as CSSProperties
                }
              />
              <span>{time(current?.duration || 0)}</span>
            </div>
            <div className="transport">
              <div className="transport-buttons">
                <IconButton
                  label="Previous track"
                  disabled={!snapshot.queue.length}
                  onClick={() => act("previous")}
                >
                  <SkipBack size={17} fill="currentColor" />
                </IconButton>
                <IconButton
                  label={snapshot.playing ? "Pause" : "Play"}
                  className="play-button"
                  onClick={() =>
                    snapshot.queue.length
                      ? act(snapshot.playing ? "pause" : "play")
                      : void chooseFiles()
                  }
                >
                  {snapshot.playing ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" />
                  )}
                </IconButton>
                <IconButton
                  label="Stop"
                  disabled={!snapshot.queue.length}
                  onClick={() => act("stop")}
                >
                  <Square size={14} fill="currentColor" />
                </IconButton>
                <IconButton
                  label="Next track"
                  disabled={!snapshot.queue.length}
                  onClick={() => act("next")}
                >
                  <SkipForward size={17} fill="currentColor" />
                </IconButton>
                <span className="transport-divider" />
                <IconButton
                  label="Open music files"
                  onClick={() => void chooseFiles()}
                >
                  <FolderOpen size={17} />
                </IconButton>
              </div>
              <div className="volume-control">
                <IconButton
                  label={snapshot.volume ? "Mute" : "Unmute"}
                  onClick={() =>
                    act("volume", snapshot.volume ? 0 : unmutedVolume.current)
                  }
                >
                  {snapshot.volume ? (
                    <Volume2 size={15} />
                  ) : (
                    <VolumeX size={15} />
                  )}
                </IconButton>
                <input
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={snapshot.volume}
                  onChange={(e) => act("volume", +e.target.value)}
                />
                <span>{Math.round(snapshot.volume * 100)}</span>
              </div>
            </div>
            <div className="panel-switches">
              <button
                className={showEq ? "selected" : ""}
                aria-pressed={showEq}
                title={showEq ? "Hide equalizer" : "Show equalizer"}
                onClick={() => togglePanel("equalizer", !showEq)}
              >
                <SlidersHorizontal size={12} />
                EQ
              </button>
              <button
                className={showPlaylist ? "selected" : ""}
                aria-pressed={showPlaylist}
                title={showPlaylist ? "Hide playlist" : "Show playlist"}
                onClick={() => togglePanel("playlist", !showPlaylist)}
              >
                <ListMusic size={12} />
                PL
              </button>
              <button
                className={libraryOpen ? "selected" : ""}
                aria-pressed={libraryOpen}
                title={
                  libraryOpen ? "Hide album library" : "Show album library"
                }
                onClick={() => togglePanel("library", !libraryOpen)}
              >
                <LibraryBig size={12} />
                LIB
              </button>
              <span />
              <IconButton
                label="Shuffle"
                active={snapshot.shuffle}
                onClick={() => act("shuffle", !snapshot.shuffle)}
              >
                <Shuffle size={14} />
              </IconButton>
              <IconButton
                label={`Repeat: ${snapshot.repeat}`}
                active={snapshot.repeat !== "off"}
                onClick={() =>
                  act(
                    "repeat",
                    snapshot.repeat === "off"
                      ? "all"
                      : snapshot.repeat === "all"
                        ? "one"
                        : "off",
                  )
                }
              >
                {snapshot.repeat === "one" ? (
                  <Repeat1 size={14} />
                ) : (
                  <Repeat size={14} />
                )}
              </IconButton>
              <button
                className={`skins-button ${skinsOpen ? "selected" : ""}`}
                aria-pressed={skinsOpen}
                title={skinsOpen ? "Hide skins" : "Show skins"}
                onClick={() => togglePanel("skins", !skinsOpen)}
              >
                <Palette size={13} />
                SKINS
              </button>
            </div>
          </section>
          {!isNative && showEq && (
            <section className="panel equalizer-panel">
              <Titlebar title="EQUALIZER" onClose={() => setShowEq(false)} />
              {sharedPanel("equalizer")}
            </section>
          )}
          {!isNative && showPlaylist && (
            <section className="panel playlist-panel">
              <Titlebar
                title="PLAYLIST"
                onClose={() => setShowPlaylist(false)}
              />
              {sharedPanel("playlist")}
            </section>
          )}
        </>
      ) : (
        <section className={`panel detached-panel detached-${panelName}`}>
          <Titlebar title={labels[panelName as Panel] || "MIKUAMP"} />
          {sharedPanel(panelName as Panel, true)}
        </section>
      )}
      {busy && (
        <div className="toast">
          <Activity size={14} className="spin" />
          Reading your music…
        </div>
      )}
      {notice && !busy && (
        <div className="toast">
          <Check size={14} />
          {notice}
        </div>
      )}
      {(error || snapshot.error) && (
        <div className="error-toast" role="alert">
          <span>{error || snapshot.error}</span>
          <IconButton
            label="Dismiss error"
            onClick={() => {
              setError("");
              act("clearError");
              setSnapshot((s) => ({ ...s, error: null }));
            }}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`panel modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-label={labels[modal]}
          >
            <Titlebar title={labels[modal]} onClose={() => setModal(null)} />
            {sharedPanel(modal, true)}
          </section>
        </div>
      )}
    </div>
  );
}

function Equalizer({
  eq,
  update,
  expanded,
  native,
}: {
  eq: Eq;
  update: (e: Eq) => void;
  expanded: boolean;
  native: boolean;
}) {
  const [tab, setTab] = useState<"peq" | "tone">("peq"),
    [selected, setSelected] = useState(4),
    [detail, setDetail] = useState(expanded),
    [preset, setPreset] = useState("Custom");
  const band = eq.bands[selected];
  const setBand = (patch: Partial<Band>) => {
    setPreset("Custom");
    update({
      ...eq,
      bands: eq.bands.map((b, i) => (i === selected ? { ...b, ...patch } : b)),
    });
  };
  const applyPreset = (name: string) => {
    const gains: Record<string, number[]> = {
      Flat: Array(10).fill(0),
      "Bass lift": [5, 4, 2, 0, 0, 0, 0, 0, 0, 0],
      "Vocal focus": [-2, -2, -1, 0, 2, 3, 2, 1, 0, -1],
      "Soft treble": [0, 0, 0, 0, 0, 0, -1, -2, -4, -4],
    };
    if (!gains[name]) return;
    setPreset(name);
    update({
      ...eq,
      enabled: true,
      preamp: name === "Flat" ? 0 : -5,
      bands: defaultEq().bands.map((b, i) => ({ ...b, gain: gains[name][i] })),
    });
  };
  const active = tab === "peq" ? eq.enabled : eq.toneEnabled;
  return (
    <div className={`equalizer ${expanded ? "expanded" : ""}`}>
      <div className="eq-toolbar">
        <div className="segmented">
          <button
            className={tab === "peq" ? "active" : ""}
            onClick={() => setTab("peq")}
          >
            PARAMETRIC EQ
          </button>
          <button
            className={tab === "tone" ? "active" : ""}
            onClick={() => setTab("tone")}
          >
            TONE
          </button>
        </div>
        <button
          className={`toggle ${active ? "on" : ""}`}
          aria-label={`Enable ${tab === "peq" ? "parametric EQ" : "Tone"}`}
          aria-pressed={active}
          onClick={() =>
            update({
              ...eq,
              ...(tab === "peq"
                ? { enabled: !eq.enabled }
                : { toneEnabled: !eq.toneEnabled }),
            })
          }
        >
          <i />
          {active ? "ON" : "OFF"}
        </button>
      </div>
      {!native && (
        <div className="preview-note">
          DSP runs in the desktop app. These controls preview its settings.
        </div>
      )}
      {tab === "peq" ? (
        <>
          <div className="eq-sliders">
            <div className="eq-axis">
              <span>+15</span>
              <span>0 dB</span>
              <span>−15</span>
            </div>
            <div className="eq-band preamp-band">
              <output>
                {eq.preamp > 0 ? "+" : ""}
                {eq.preamp}
              </output>
              <input
                type="range"
                className="vertical-slider"
                aria-label="Preamp"
                min="-18"
                max="12"
                step=".5"
                value={eq.preamp}
                onChange={(e) => update({ ...eq, preamp: +e.target.value })}
              />
              <button onClick={() => update({ ...eq, preamp: 0 })}>PRE</button>
            </div>
            <div className="eq-divider" />
            {eq.bands.map((b, i) => (
              <div
                key={i}
                className={`eq-band ${selected === i ? "selected-band" : ""}`}
              >
                <output>
                  {b.gain > 0 ? "+" : ""}
                  {b.gain}
                </output>
                <input
                  aria-label={`Band ${i + 1} gain`}
                  type="range"
                  className="vertical-slider"
                  min="-15"
                  max="15"
                  step=".5"
                  value={b.gain}
                  onPointerDown={() => setSelected(i)}
                  onChange={(e) => {
                    setPreset("Custom");
                    update({
                      ...eq,
                      bands: eq.bands.map((v, n) =>
                        n === i ? { ...v, gain: +e.target.value } : v,
                      ),
                    });
                  }}
                />
                <button
                  title={`Edit band ${i + 1}`}
                  onClick={() => {
                    setSelected(i);
                    setDetail(true);
                  }}
                >
                  {hz(b.frequency)}
                </button>
              </div>
            ))}
          </div>
          <div className="eq-bottom">
            <button className="text-button" onClick={() => setDetail(!detail)}>
              <Settings2 size={12} />
              BAND {String(selected + 1).padStart(2, "0")}
              <ChevronDown size={11} />
            </button>
            <select
              aria-label="EQ preset"
              value={preset}
              onChange={(e) => applyPreset(e.target.value)}
            >
              {[
                "Custom",
                "Flat",
                "Bass lift",
                "Vocal focus",
                "Soft treble",
              ].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <button
              className="text-button"
              onClick={() => {
                setPreset("Flat");
                update({ ...eq, preamp: 0, bands: defaultEq().bands });
              }}
            >
              RESET
            </button>
          </div>
          {detail && (
            <div className="band-details">
              <label>
                FREQUENCY
                <NumberField
                  label="Band frequency"
                  min={20}
                  max={20000}
                  step={1}
                  value={band.frequency}
                  onCommit={(frequency) => setBand({ frequency })}
                />
              </label>
              <label>
                Q
                <NumberField
                  label="Band Q"
                  min={0.1}
                  max={12}
                  step={0.1}
                  value={band.q}
                  onCommit={(q) => setBand({ q })}
                />
              </label>
              <label>
                FILTER
                <select
                  aria-label="Band filter type"
                  value={band.kind}
                  onChange={(e) =>
                    setBand({ kind: e.target.value as Band["kind"] })
                  }
                >
                  <option value="peak">Peak</option>
                  <option value="lowShelf">Low shelf</option>
                  <option value="highShelf">High shelf</option>
                </select>
              </label>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="tone-list">
            {toneControls.map(([name, left, right], i) => (
              <label className="tone-row" key={name}>
                <span>
                  {name}
                  <output>
                    {eq.tone[i] > 0 ? "+" : ""}
                    {eq.tone[i]}
                  </output>
                </span>
                <div>
                  <small>{left}</small>
                  <input
                    aria-label={name}
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={eq.tone[i]}
                    onChange={(e) =>
                      update({
                        ...eq,
                        tone: eq.tone.map((n, j) =>
                          j === i ? +e.target.value : n,
                        ),
                      })
                    }
                    onDoubleClick={() =>
                      update({
                        ...eq,
                        tone: eq.tone.map((n, j) => (j === i ? 0 : n)),
                      })
                    }
                  />
                  <small>{right}</small>
                </div>
              </label>
            ))}
          </div>
          <div className="tone-note">
            <button
              className="text-button"
              onClick={() => update({ ...eq, tone: Array(10).fill(0) })}
            >
              RESET
            </button>
          </div>
        </>
      )}
      {(expanded || detail || tab === "tone") && <ResponseCurve eq={eq} />}
    </div>
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    const next =
      draft.trim() && Number.isFinite(number)
        ? Math.min(max, Math.max(min, number))
        : value;
    setDraft(String(next));
    onCommit(next);
  };
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function ResponseCurve({ eq }: { eq: Eq }) {
  const bands = filters(eq);
  const points = Array.from({ length: 180 }, (_, i) => {
    const f = 20 * 1000 ** (i / 179);
    const db = response(bands, f) + (eq.enabled ? eq.preamp : 0);
    return `${((i / 179) * 440).toFixed(2)},${Math.max(2, Math.min(78, 40 - db * 1.4)).toFixed(2)}`;
  }).join(" ");
  return (
    <div className="response-graph">
      <svg
        viewBox="0 0 440 80"
        role="img"
        aria-label="Combined EQ and Tone frequency response before automatic headroom"
      >
        <path
          d="M0 20H440M0 40H440M0 60H440M102 0V80M249 0V80M395 0V80"
          className="graph-grid"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.8"
        />
      </svg>
      <div>
        <span>20 Hz</span>
        <span>100</span>
        <span>1k</span>
        <span>10k</span>
        <span>20k</span>
      </div>
    </div>
  );
}

function Playlist({
  tracks,
  snapshot,
  act,
  openFiles,
  run,
}: {
  tracks: Track[];
  snapshot: Snapshot;
  act: (a: string, v?: unknown) => void;
  openFiles: () => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const afterRemove = useRef<{ length: number; index: number } | null>(null);
  const list = snapshot.queue
    .map((id, index) => ({ track: tracks.find((t) => t.id === id), index }))
    .filter((x): x is { track: Track; index: number } => !!x.track)
    .filter(({ track }) =>
      `${track.title} ${track.artist}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    );
  const total = snapshot.queue.reduce(
    (n, id) => n + (tracks.find((t) => t.id === id)?.duration || 0),
    0,
  );
  const selectedVisible = list.some((entry) => entry.index === selected);
  const tabIndex = selectedVisible
    ? selected
    : (list.find((entry) => entry.index === snapshot.index)?.index ??
      list[0]?.index);
  const focusRow = (index: number) => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${index}"]`,
    );
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  };
  const remove = (index: number) => {
    afterRemove.current = { length: snapshot.queue.length, index };
    act("remove", index);
  };
  useEffect(() => {
    const pending = afterRemove.current;
    if (!pending || snapshot.queue.length === pending.length) return;
    afterRemove.current = null;
    const next =
      list.find((entry) => entry.index >= pending.index) ?? list.at(-1);
    setSelected(next?.index ?? null);
    if (next) focusRow(next.index);
    else searchRef.current?.focus();
  }, [snapshot.queue, list]);
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
          list
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
          {String(snapshot.queue.length).padStart(2, "0")} TRACKS <b> / </b>
          {time(total)}
        </span>
        <label className="search-field">
          <Search size={12} />
          <input
            ref={searchRef}
            aria-label="Search playlist"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a track"
          />
        </label>
      </div>
      <div
        ref={listRef}
        className="track-list"
        role="listbox"
        aria-label="Playlist tracks"
      >
        {list.length ? (
          list.map(({ track: t, index }) => (
            <div
              key={`${t.id}-${index}`}
              role="option"
              aria-selected={selected === index}
              title={`${t.artist} — ${t.title}\n${t.album}`}
              className={`track-row ${snapshot.index === index ? "current-track" : ""} ${selected === index ? "selected-track" : ""}`}
              data-index={index}
              tabIndex={index === tabIndex ? 0 : -1}
              onFocus={() => setSelected(index)}
              onClick={() => setSelected(index)}
              onDoubleClick={() => act("play", index)}
              onKeyDown={(e) => {
                const position = list.findIndex(
                  (entry) => entry.index === index,
                );
                let next = position;
                if (e.key === "ArrowDown")
                  next = Math.min(list.length - 1, position + 1);
                else if (e.key === "ArrowUp") next = Math.max(0, position - 1);
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = list.length - 1;
                else if (e.key === "Enter") act("play", index);
                else if (e.code === "Space")
                  act(
                    snapshot.index === index && snapshot.playing
                      ? "pause"
                      : "play",
                    index,
                  );
                else if (e.key === "Delete") remove(index);
                else return;
                e.preventDefault();
                e.stopPropagation();
                if (next !== position) focusRow(list[next].index);
              }}
            >
              <span className="track-index">
                {snapshot.index === index && snapshot.playing ? (
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
                {t.artist && <small>· {t.artist}</small>}
              </div>
              <span className="track-duration">{time(t.duration)}</span>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <Music2 size={24} />
            <strong>{search ? "No matching tracks" : "Playlist empty"}</strong>
            <span>
              {search
                ? "Try a different title or artist."
                : "Add files or drag them here."}
            </span>
          </div>
        )}
      </div>
      <div className="playlist-actions">
        <button onClick={openFiles}>
          <Plus size={12} />
          ADD
        </button>
        <button
          disabled={!selectedVisible}
          onClick={() => {
            if (selected !== null && selectedVisible) remove(selected);
          }}
        >
          <Minus size={12} />
          REMOVE
        </button>
        <button
          disabled={!snapshot.queue.length}
          onClick={() => act("clear")}
          title="Clear queue; your library is kept"
        >
          <Trash2 size={12} />
          CLEAR
        </button>
        <span />
        <button disabled={!snapshot.queue.length} onClick={exportList}>
          SAVE LIST <ArrowDown size={11} />
        </button>
      </div>
    </div>
  );
}

function AlbumLibrary({
  tracks,
  current,
  queue,
  addFolder,
  busy,
}: {
  tracks: Track[];
  current?: Track;
  queue: (ts: Track[], play?: boolean) => void;
  addFolder: () => void;
  busy: boolean;
}) {
  const [search, setSearch] = useState(""),
    [albumId, setAlbumId] = useState<string | null>(null);
  const albums = albumsFrom(tracks);
  const visible = albums.filter((a) =>
    `${a.title} ${a.artist} ${a.tracks.map((t) => t.title).join(" ")}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const selected = albums.find((a) => a.id === albumId);
  return (
    <div className="album-library">
      <div className="library-heading">
        <p>
          {albums.length} albums <b>·</b> {tracks.length} tracks
        </p>
        <button className="primary-button" onClick={addFolder} disabled={busy}>
          <FolderOpen size={15} />
          ADD FOLDER
        </button>
      </div>
      <div className="library-search">
        <Search size={15} />
        <input
          aria-label="Search library"
          placeholder="Search albums, artists, tracks"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setAlbumId(null);
          }}
        />
      </div>
      {selected ? (
        <div className="album-detail">
          <button className="text-button" onClick={() => setAlbumId(null)}>
            ← ALL ALBUMS
          </button>
          <div className="album-detail-heading">
            <Cover cover={selected.cover} title={selected.title} />
            <div>
              <h2 title={selected.title}>{selected.title}</h2>
              <p title={selected.artist}>{selected.artist}</p>
              <button
                className="primary-button"
                onClick={() => queue(selected.tracks, true)}
              >
                <Play size={14} />
                PLAY ALBUM
              </button>
              <button
                className="text-button"
                onClick={() => queue(selected.tracks)}
              >
                + QUEUE
              </button>
            </div>
          </div>
          {selected.tracks.map((t, i) => (
            <button
              className={`album-song ${current?.id === t.id ? "active" : ""}`}
              key={t.id}
              title={`${t.title} — ${t.artist}`}
              onClick={() => queue(selected.tracks.slice(i), true)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div className="track-info">
                <strong>{t.title}</strong>
                <Quality track={t} />
              </div>
              <span>{time(t.duration)}</span>
              <Play size={12} />
            </button>
          ))}
        </div>
      ) : visible.length ? (
        <div className="album-grid">
          {visible.map((a) => (
            <article className="album-card" key={a.id}>
              <button
                className="album-cover-button"
                onClick={() => setAlbumId(a.id)}
                aria-label={`Open ${a.title}`}
              >
                <Cover cover={a.cover} title={a.title} />
                <span className="album-count">{a.tracks.length} TRACKS</span>
              </button>
              <div className="album-card-info">
                <button
                  onClick={() => setAlbumId(a.id)}
                  title={`${a.title} — ${a.artist}`}
                >
                  <strong>{a.title}</strong>
                  <small>{a.artist}</small>
                </button>
                <IconButton
                  label={`Play album ${a.title}`}
                  onClick={() => queue(a.tracks, true)}
                >
                  <Play size={14} fill="currentColor" />
                </IconButton>
              </div>
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
              ADD FOLDER
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function Cover({ cover, title }: { cover: string | null; title: string }) {
  return cover ? (
    <img className="album-cover" src={cover} alt={`${title} cover`} />
  ) : (
    <div className="album-cover cover-placeholder">
      <Disc3 size={54} strokeWidth={1} />
      <span>{title.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

function SkinGallery({
  skins: collection,
  selected,
  select,
  scale,
  setScale,
  importSkin,
  error,
}: {
  skins: Skin[];
  selected: string;
  select: (s: Skin) => void;
  scale: number;
  setScale: (scale: number) => void;
  importSkin: (s: Skin) => void;
  error: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="skin-gallery">
      <div className="skin-heading">
        <label className="interface-scale">
          Scale
          <select
            aria-label="Interface scale"
            value={scale}
            onChange={(e) => setScale(+e.target.value)}
          >
            <option value="1">100%</option>
            <option value="1.15">115%</option>
            <option value="1.3">130%</option>
          </select>
        </label>
        <button
          className="secondary-button"
          onClick={() => input.current?.click()}
        >
          <Upload size={13} /> IMPORT SKIN
        </button>
      </div>
      <div className="skin-grid">
        {collection.map((s) => (
          <button
            key={s.id}
            aria-label={s.name}
            aria-pressed={selected === s.id}
            className={`skin-card ${selected === s.id ? "chosen" : ""}`}
            onClick={() => select(s)}
          >
            <div
              className="skin-art"
              style={{ backgroundImage: `url(${s.preview})` }}
            >
              {selected === s.id && (
                <span className="skin-check">
                  <Check size={15} />
                </span>
              )}
            </div>
            <div className="skin-card-caption">
              <strong>{s.name}</strong>
              <div className="swatches">
                {[s.colors.accent, s.colors.secondary, s.colors.bg].map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept=".json,.mikuamp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file)
            try {
              if (file.size > 24_000_000)
                throw new Error("Skin file is too large.");
              importSkin(validateSkin(JSON.parse(await file.text())));
            } catch (err) {
              error(String(err));
            }
          e.target.value = "";
        }}
      />
    </div>
  );
}
