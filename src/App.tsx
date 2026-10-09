import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent,
} from "react";
import {
  Activity,
  Check,
  FolderOpen,
  LibraryBig,
  ListMusic,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Pin,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Undo2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import * as api from "./bridge";
import {
  defaultEq,
  emptySnapshot,
  time,
  type Eq,
  type Snapshot,
  type Track,
} from "./types";
import {
  isLightScreen,
  isLightSkin,
  loadSkins,
  skins,
  type Skin,
} from "./skins";
import { usePresence, withTransition } from "./motion";
import {
  Cover,
  IconButton,
  isNative,
  panelName,
  Quality,
  SeekBar,
  Spectrum,
  Titlebar,
  type Panel,
} from "./ui";
import { Equalizer } from "./Equalizer";
import { Queue } from "./Queue";
import { Library, type QueueMode } from "./Library";
import { SkinGallery } from "./SkinGallery";
import { Visualizer } from "./visualizers/Visualizer";
import { VisualBrowser } from "./visualizers/VisualBrowser";

if (isNative) document.documentElement.classList.add("native");
const labels: Record<Panel, string> = {
  library: "LIBRARY",
  equalizer: "EQUALIZER",
  playlist: "QUEUE",
  skins: "SKINS",
  visuals: "VISUALS",
};
const panels = Object.keys(labels) as Panel[];
const albumId = (t: Track) => `${t.albumArtist}\0${t.album}`;
type Toast = { text: string; undo?: () => Promise<unknown> };

function PlayButton({
  playing,
  onClick,
}: {
  playing: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      label={playing ? "Pause" : "Play"}
      className={`play-button ${playing ? "is-playing" : ""}`}
      onClick={onClick}
    >
      <Play className="glyph-play" size={20} fill="currentColor" />
      <Pause className="glyph-pause" size={20} fill="currentColor" />
    </IconButton>
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
    [showSkins, setShowSkins] = useState(false),
    [showVisuals, setShowVisuals] = useState(false),
    [vizExpanded, setVizExpanded] = useState(false);
  const [modal, setModal] = useState<Panel | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState<Toast | null>(null),
    [error, setError] = useState(""),
    [pinned, setPinned] = useState(false),
    [scale, setScale] = useState(
      Number(localStorage.getItem("mikuamp-scale")) || 1,
    ),
    [mini, setMini] = useState(
      panelName === "main" && localStorage.getItem("mikuamp-mini") === "true",
    ),
    [remaining, setRemaining] = useState(
      localStorage.getItem("mikuamp-time") === "remaining",
    ),
    [volumeFlash, setVolumeFlash] = useState(false),
    [albumRequest, setAlbumRequest] = useState<{
      id: string;
      at: number;
    } | null>(null);
  const browserInput = useRef<HTMLInputElement>(null),
    eqTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    restorePanels = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const unmutedVolume = useRef(0.65);
  const toastView = usePresence(!!toast);
  const lastToast = useRef<Toast | null>(null);
  if (toast) lastToast.current = toast;
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
  const notify = useCallback(
    (text: string, undo?: () => Promise<unknown>) => setToast({ text, undo }),
    [],
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
      if (panelName === "library")
        unlisteners.push(
          listen<string>("show-album", (event) =>
            setAlbumRequest({ id: event.payload, at: Date.now() }),
          ),
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
      setShowVisuals(panels.some((p) => p.label === "visuals" && p.visible));
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
        void run(async () => {
          await invoke("fit_panel", {
            width: panelName === "main" && mini ? 280 : null,
            height:
              panelName === "main" || panelName === "equalizer"
                ? shell.getBoundingClientRect().height
                : null,
            scale,
            pixelRatio: window.devicePixelRatio,
          });
          // Panels come back only once the player has its full width again.
          if (restorePanels.current && !mini) {
            restorePanels.current = false;
            const saved: Panel[] = JSON.parse(
              localStorage.getItem("mikuamp-mini-panels") || "[]",
            );
            for (const label of saved.filter((p) => panels.includes(p)))
              await invoke("set_panel_visible", { label, visible: true });
            await getCurrentWindow().setFocus();
          }
        });
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
  }, [scale, run, mini]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === "mikuamp-skin")
        withTransition(() => setSkinId(e.newValue || "classic"));
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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const importFiles = useCallback(
    async (paths: string[], queue = true) => {
      setBusy(true);
      try {
        const result = await api.importPaths(paths);
        await refresh();
        if (queue && result.tracks.length)
          await api.enqueue(result.tracks.map((t) => t.id));
        notify(
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
    [refresh, notify],
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
  const isOpen = (panel: Panel) =>
    panel === "equalizer"
      ? showEq
      : panel === "playlist"
        ? showPlaylist
        : isNative
          ? { library: showLibrary, skins: showSkins, visuals: showVisuals }[
              panel
            ]
          : modal === panel;
  const toggleMini = useCallback(async () => {
    if (panelName !== "main") return;
    if (!mini) {
      // Remember which panels were open, tuck them away, then narrow the player.
      const openPanels = isNative ? panels.filter(isOpen) : [];
      localStorage.setItem("mikuamp-mini-panels", JSON.stringify(openPanels));
      if (isNative)
        await Promise.all(
          openPanels.map((label) =>
            invoke("set_panel_visible", { label, visible: false }),
          ),
        );
      setModal(null);
    } else restorePanels.current = true;
    localStorage.setItem("mikuamp-mini", String(!mini));
    withTransition(() => setMini(!mini));
    // isOpen reads the same visibility state listed here.
  }, [mini, showEq, showPlaylist, showLibrary, showSkins, showVisuals, modal]);
  const changeVolume = useCallback(
    (volume: number) => {
      act("volume", Math.min(1, Math.max(0, Math.round(volume * 100) / 100)));
      setVolumeFlash(true);
      if (volumeTimer.current) clearTimeout(volumeTimer.current);
      volumeTimer.current = setTimeout(() => setVolumeFlash(false), 900);
    },
    [act],
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        void toggleMini();
        return;
      }
      if (e.key === "MediaPlayPause")
        return act(snapshot.playing ? "pause" : "play");
      if (e.key === "MediaTrackNext") return act("next");
      if (e.key === "MediaTrackPrevious") return act("previous");
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
    toggleMini,
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
  const chooseSkin = (s: Skin) => {
    withTransition(() => setSkinId(s.id));
    localStorage.setItem("mikuamp-skin", s.id);
    notify(`${s.name} skin applied`);
  };
  /** Restores a queue captured before a destructive change. */
  const restorer = (before: Snapshot) => async () => {
    await api.enqueue(before.queue, true);
    if (before.index !== null && before.playing) {
      await api.command("play", before.index);
      if (before.position > 1) await api.command("seek", before.position);
    }
  };
  const queueTracks = (ts: Track[], mode: QueueMode, start = 0) =>
    void run(async () => {
      const ids = ts.map((t) => t.id);
      const n = `${ts.length} track${ts.length === 1 ? "" : "s"}`;
      if (mode === "play") {
        const before = snapshot;
        await api.enqueue(ids, true);
        await api.command("play", start);
        if (before.queue.length)
          notify("Now playing; queue replaced", restorer(before));
      } else if (mode === "next") {
        await api.enqueue(
          ids,
          false,
          snapshot.index === null ? 0 : snapshot.index + 1,
        );
        notify(`${n} will play next`);
      } else {
        await api.enqueue(ids);
        notify(`${n} added to the queue`);
      }
    });
  const removeAt = (index: number) =>
    void run(async () => {
      const id = snapshot.queue[index];
      const title = tracks.find((t) => t.id === id)?.title;
      await api.command("remove", index);
      notify(`Removed ${title ? `“${title}”` : "track"}`, () =>
        api.enqueue([id], false, index),
      );
    });
  const clearQueue = () =>
    void run(async () => {
      const before = snapshot;
      await api.command("clear");
      notify("Queue cleared", restorer(before));
    });
  const showAlbum = (track: Track) =>
    void run(async () => {
      if (isNative) {
        await invoke("set_panel_visible", { label: "library", visible: true });
        await emit("show-album", albumId(track));
      } else {
        setAlbumRequest({ id: albumId(track), at: Date.now() });
        setModal("library");
      }
    });
  const onWheelVolume = (e: WheelEvent) => {
    if (!e.deltaY) return;
    changeVolume(snapshot.volume + (e.deltaY < 0 ? 0.02 : -0.02));
  };
  const skinStyle = {
    ...Object.fromEntries(
      Object.entries(selectedSkin.colors).map(([k, v]) => [`--${k}`, v]),
    ),
    "--scene": `url("${selectedSkin.scene}")`,
    "--chrome": `url("${selectedSkin.chrome}")`,
    "--skin-preview": `url("${selectedSkin.preview}")`,
    "--scale": scale,
  } as CSSProperties;
  const sharedPanel = (panel: Panel) => {
    if (panel === "equalizer")
      return (
        <Equalizer
          eq={eq}
          update={updateEq}
          spectrum={snapshot.spectrum}
          native={isNative}
        />
      );
    if (panel === "playlist")
      return (
        <Queue
          tracks={tracks}
          snapshot={snapshot}
          act={act}
          openFiles={() => void chooseFiles()}
          run={run}
          remove={removeAt}
          clear={clearQueue}
          showAlbum={showAlbum}
        />
      );
    if (panel === "visuals")
      return <VisualBrowser snapshot={snapshot} skin={selectedSkin.id} />;
    if (panel === "library")
      return (
        <Library
          tracks={tracks}
          current={current}
          queue={queueTracks}
          addFolder={() => void chooseFiles(true, false)}
          busy={busy}
          request={albumRequest}
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

  const duration = current?.duration || 0;
  const togglePlay = () =>
    snapshot.queue.length
      ? act(snapshot.playing ? "pause" : "play")
      : void chooseFiles();
  const cycleRepeat = () =>
    act(
      "repeat",
      snapshot.repeat === "off"
        ? "all"
        : snapshot.repeat === "all"
          ? "one"
          : "off",
    );
  const toggleRemaining = () => {
    localStorage.setItem("mikuamp-time", remaining ? "total" : "remaining");
    setRemaining(!remaining);
  };
  const endTime = remaining
    ? `−${time(Math.max(0, duration - snapshot.position))}`
    : time(duration);
  // Keyed by track, not queue slot, so reordering the queue does not replay
  // the track-change animations.
  const trackKey = current?.id ?? "none";
  const resampled =
    current?.sampleRate &&
    snapshot.outputRate &&
    current.sampleRate !== snapshot.outputRate
      ? `→ ${+(snapshot.outputRate / 1000).toFixed(1)} kHz`
      : "";
  const formatLine = current
    ? [
        current.format,
        current.bitDepth && current.quality !== "LQ"
          ? `${current.bitDepth}-bit`
          : `${current.bitrate || "—"} kbps`,
        current.sampleRate
          ? `${+(current.sampleRate / 1000).toFixed(1)} kHz`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "READY TO PLAY";
  const upNext = (() => {
    if (snapshot.index === null || !snapshot.queue.length) return null;
    if (snapshot.repeat === "one") return current;
    if (snapshot.shuffle) return "shuffle";
    const next = snapshot.index + 1;
    const id =
      next < snapshot.queue.length
        ? snapshot.queue[next]
        : snapshot.repeat === "all"
          ? snapshot.queue[0]
          : null;
    return id ? tracks.find((t) => t.id === id) : null;
  })();
  const VolumeIcon = !snapshot.volume
    ? VolumeX
    : snapshot.volume < 0.5
      ? Volume1
      : Volume2;
  const volumeText = Math.round(snapshot.volume * 100);
  const transportCore = (
    <>
      <IconButton
        label="Previous track"
        disabled={!snapshot.queue.length}
        onClick={() => act("previous")}
      >
        <SkipBack size={17} fill="currentColor" />
      </IconButton>
      <PlayButton playing={snapshot.playing} onClick={togglePlay} />
      <IconButton
        label="Next track"
        disabled={!snapshot.queue.length}
        onClick={() => act("next")}
      >
        <SkipForward size={17} fill="currentColor" />
      </IconButton>
    </>
  );
  const shuffleButton = (
    <IconButton
      label="Shuffle"
      active={snapshot.shuffle}
      className="mode-button"
      onClick={() => act("shuffle", !snapshot.shuffle)}
    >
      <Shuffle size={15} />
    </IconButton>
  );
  const repeatButton = (
    <IconButton
      label={`Repeat: ${snapshot.repeat}`}
      active={snapshot.repeat !== "off"}
      className="mode-button"
      onClick={cycleRepeat}
    >
      {snapshot.repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
    </IconButton>
  );
  const seekRow = (
    <div className="seek-row">
      <span>{time(snapshot.position)}</span>
      <SeekBar
        position={snapshot.position}
        playing={snapshot.playing}
        duration={duration}
        onSeek={(s) => act("seek", s)}
      />
      <button
        className="time-toggle"
        title={remaining ? "Show total time" : "Show time remaining"}
        onClick={toggleRemaining}
      >
        {endTime}
      </button>
    </div>
  );
  const windowButtons = isNative && (
    <>
      <IconButton
        label="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus size={13} />
      </IconButton>
      <IconButton label="Close" onClick={() => void getCurrentWindow().close()}>
        <X size={13} />
      </IconButton>
    </>
  );
  const volumeFlashView = volumeFlash && (
    <div className="volume-flash" aria-live="polite">
      VOL {String(volumeText).padStart(2, "0")}
    </div>
  );

  const player = (
    <section
      className={`player panel ${snapshot.playing ? "is-playing" : ""}`}
      aria-label="Player"
    >
      <header className="titlebar player-titlebar" data-tauri-drag-region>
        <span className="wordmark" data-tauri-drag-region>
          miku<span data-tauri-drag-region>amp</span>
        </span>
        <span className="title-fill" data-tauri-drag-region />
        <div className="title-actions">
          <IconButton
            label="Open music files"
            onClick={() => void chooseFiles()}
          >
            <FolderOpen size={14} />
          </IconButton>
          <IconButton
            label="Always on top"
            active={pinned}
            onClick={() => {
              setPinned(!pinned);
              if (isNative)
                void run(() => getCurrentWindow().setAlwaysOnTop(!pinned));
            }}
          >
            <Pin size={13} />
          </IconButton>
          <IconButton label="Mini player" onClick={() => void toggleMini()}>
            <Minimize2 size={13} />
          </IconButton>
          {windowButtons}
        </div>
      </header>
      <div
        className={`player-scene ${vizExpanded ? "viz-expanded" : ""}`}
        onWheel={onWheelVolume}
      >
        <div className="scene-shade" />
        <div className="display">
          <div className="clock-row">
            <Cover
              key={`cover-${trackKey}`}
              cover={current?.cover}
              title={current?.title || "MikuAmp"}
              className="display-cover"
            />
            <span className="digital-time" key={`time-${trackKey}`}>
              {time(snapshot.position).padStart(5, "0")}
            </span>
            <span className="viz-title" key={`title-${trackKey}`}>
              {current ? `${current.title} — ${current.artist}` : ""}
            </span>
            <div className="channel-label">
              {current?.channels === 1 ? "MONO" : "STEREO"}
              <span>{eq.enabled || eq.toneEnabled ? "DSP ON" : "DSP OFF"}</span>
            </div>
            {volumeFlashView}
          </div>
          <Visualizer
            snapshot={snapshot}
            trackId={current?.id}
            skin={selectedSkin.id}
            onExpandedChange={setVizExpanded}
            onBrowse={() => togglePanel("visuals", true)}
          />
          <div className="format-line">
            <Quality track={current} />
            <span>{formatLine}</span>
            <span title="Resampled to the Windows mix rate (shared mode)">
              {resampled}
            </span>
          </div>
        </div>
        <div className="track-caption" key={`caption-${trackKey}`}>
          <h1 title={current?.title}>{current?.title || "No track loaded"}</h1>
          <p
            title={current ? `${current.artist} — ${current.album}` : undefined}
          >
            {current
              ? `${current.artist} — ${current.album}`
              : "Press play to open music, or drop files here"}
          </p>
        </div>
      </div>
      {seekRow}
      <div className="transport">
        <div className="transport-buttons">
          {shuffleButton}
          {transportCore}
          {repeatButton}
        </div>
        <div className="volume-control">
          <IconButton
            label={snapshot.volume ? "Mute" : "Unmute"}
            onClick={() =>
              act("volume", snapshot.volume ? 0 : unmutedVolume.current)
            }
          >
            <VolumeIcon size={15} />
          </IconButton>
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={snapshot.volume}
            style={{ "--progress": `${volumeText}%` } as CSSProperties}
            onChange={(e) => act("volume", +e.target.value)}
          />
          <span>{volumeText}</span>
        </div>
      </div>
      <nav className="panel-switches" aria-label="Panels">
        <button
          className={showEq ? "selected" : ""}
          aria-pressed={showEq}
          title={showEq ? "Hide equalizer" : "Show equalizer"}
          onClick={() => togglePanel("equalizer", !showEq)}
        >
          <SlidersHorizontal size={13} />
          EQ
        </button>
        <button
          className={showPlaylist ? "selected" : ""}
          aria-pressed={showPlaylist}
          aria-label={
            snapshot.queue.length
              ? `Queue, ${snapshot.queue.length} tracks`
              : "Queue"
          }
          title={showPlaylist ? "Hide queue" : "Show queue"}
          onClick={() => togglePanel("playlist", !showPlaylist)}
        >
          <ListMusic size={13} />
          Queue
          {!!snapshot.queue.length && (
            <i key={snapshot.queue.length}>{snapshot.queue.length}</i>
          )}
        </button>
        <button
          className={isOpen("library") ? "selected" : ""}
          aria-pressed={isOpen("library")}
          title={isOpen("library") ? "Hide library" : "Show library"}
          onClick={() => togglePanel("library", !isOpen("library"))}
        >
          <LibraryBig size={13} />
          Library
        </button>
        <span />
        <button
          className={`skins-button ${isOpen("skins") ? "selected" : ""}`}
          aria-pressed={isOpen("skins")}
          aria-label={`Skins: ${selectedSkin.name}`}
          title={isOpen("skins") ? "Hide skins" : "Show skins"}
          onClick={() => togglePanel("skins", !isOpen("skins"))}
        >
          <i className="skin-dot" />
          {selectedSkin.name}
        </button>
      </nav>
    </section>
  );

  const miniPlayer = (
    <section
      className={`player mini-player panel ${snapshot.playing ? "is-playing" : ""}`}
      aria-label="Mini player"
    >
      <header className="titlebar player-titlebar" data-tauri-drag-region>
        <span className="wordmark" data-tauri-drag-region>
          miku<span data-tauri-drag-region>amp</span>
        </span>
        <span className="title-fill" data-tauri-drag-region />
        <div className="title-actions">
          <IconButton label="Full player" onClick={() => void toggleMini()}>
            <Maximize2 size={13} />
          </IconButton>
          {windowButtons}
        </div>
      </header>
      <div className="player-scene" onWheel={onWheelVolume}>
        <div className="scene-shade" />
        <div className="display mini-display">
          <Cover
            key={`cover-${trackKey}`}
            cover={current?.cover}
            title={current?.title || "MikuAmp"}
            className="display-cover"
          />
          <span className="digital-time" key={`time-${trackKey}`}>
            {time(snapshot.position).padStart(5, "0")}
          </span>
          <Spectrum bars={snapshot.spectrum} count={8} />
          {volumeFlashView}
        </div>
      </div>
      <div className="mini-caption" key={`caption-${trackKey}`}>
        <strong title={current?.title}>
          {current?.title || "No track loaded"}
        </strong>
        <span title={current?.artist}>
          {current ? current.artist : "Press play to open music"}
        </span>
      </div>
      {seekRow}
      <div className="mini-transport">
        {shuffleButton}
        {transportCore}
        {repeatButton}
      </div>
      <footer className="mini-next">
        {upNext === "shuffle" ? (
          <span>Shuffle is on</span>
        ) : upNext ? (
          <span title={`${upNext.title} — ${upNext.artist}`}>
            <b>UP NEXT</b> {upNext.title}
            <small> · {upNext.artist}</small>
          </span>
        ) : (
          <span>
            {snapshot.queue.length ? "End of queue" : "Queue is empty"}
          </span>
        )}
      </footer>
    </section>
  );

  const shownToast = toast || lastToast.current;
  return (
    <div
      ref={shellRef}
      className={`app-shell ${isNative ? `native-shell native-${panelName}` : "preview-shell"} ${selectedSkin.dotMatrix ? "dot-matrix" : ""} ${panelName === "main" ? "main-shell" : "detached-shell"} ${mini ? "is-mini" : ""} ${isLightSkin(selectedSkin) ? "light-skin" : ""} ${isLightScreen(selectedSkin) ? "paper-screen" : ""} ${selectedSkin.sketch ? "sketch" : ""}`}
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
              notify(`${added.length} tracks added`);
            });
          }
          e.target.value = "";
        }}
      />
      {panelName === "main" ? (
        <>
          {mini ? miniPlayer : player}
          {!isNative && !mini && showEq && (
            <section className="panel equalizer-panel">
              <Titlebar title="EQUALIZER" onClose={() => setShowEq(false)} />
              {sharedPanel("equalizer")}
            </section>
          )}
          {!isNative && !mini && showPlaylist && (
            <section className="panel playlist-panel">
              <Titlebar title="QUEUE" onClose={() => setShowPlaylist(false)} />
              {sharedPanel("playlist")}
            </section>
          )}
        </>
      ) : (
        <section className={`panel detached-panel detached-${panelName}`}>
          <Titlebar title={labels[panelName as Panel] || "MIKUAMP"} />
          {sharedPanel(panelName as Panel)}
        </section>
      )}
      {busy && (
        <div className="toast">
          <Activity size={14} className="spin" />
          Reading your music…
        </div>
      )}
      {toastView.mounted && shownToast && !busy && (
        <div
          key={shownToast.text}
          className={`toast ${toastView.leaving ? "leaving" : ""}`}
          role="status"
        >
          <Check size={14} />
          <span>{shownToast.text}</span>
          {shownToast.undo && (
            <button
              className="toast-action"
              onClick={() => {
                const undo = shownToast.undo!;
                setToast(null);
                void run(undo);
              }}
            >
              <Undo2 size={13} />
              Undo
            </button>
          )}
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
            {sharedPanel(modal)}
          </section>
        </div>
      )}
    </div>
  );
}
