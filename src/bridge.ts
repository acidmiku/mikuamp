import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  defaultEq,
  emptySnapshot,
  type Eq,
  type Snapshot,
  type Track,
} from "./types";
export const native = isTauri();
// Browser mode is a UI preview with real local-file playback; the desktop app uses Rust exclusively.
let previewTracks: Track[] = [];
let previewState = emptySnapshot();
let previewEq = defaultEq();
const audio = new Audio();
const urls = new Map<string, string>();
audio.addEventListener("ended", () => {
  if (previewState.repeat === "one") void command("play", previewState.index);
  else if (
    previewState.index !== null &&
    (previewState.index + 1 < previewState.queue.length ||
      previewState.repeat === "all")
  )
    void command("next");
  else previewState.playing = false;
});
export async function getLibrary() {
  return native ? invoke<Track[]>("get_library") : previewTracks;
}
export async function getSnapshot() {
  if (native) return invoke<Snapshot>("get_snapshot");
  previewState.position = audio.currentTime;
  previewState.playing = !audio.paused;
  return { ...previewState };
}
export async function getEq() {
  return native ? invoke<Eq>("get_eq") : previewEq;
}
export async function setEq(settings: Eq) {
  if (native) await invoke("set_eq", { settings });
  else previewEq = settings;
}
export async function enqueue(ids: string[], replace = false) {
  if (native) return invoke("enqueue", { ids, replace });
  if (replace) {
    audio.pause();
    previewState.index = null;
    previewState.queue = [];
  }
  previewState.queue.push(...ids);
}
export async function command(action: string, value?: unknown): Promise<void> {
  if (native) {
    await invoke("transport", { action, value: value ?? null });
    return;
  }
  switch (action) {
    case "play": {
      if (typeof value === "number") previewState.index = value;
      if (previewState.index === null) previewState.index = 0;
      const id = previewState.queue[previewState.index];
      if (!id) throw new Error("Open a music file to start listening.");
      const url = urls.get(id);
      if (url && audio.src !== url) audio.src = url;
      audio.volume = previewState.volume;
      await audio.play();
      break;
    }
    case "pause":
      audio.pause();
      break;
    case "stop":
      audio.pause();
      audio.currentTime = 0;
      break;
    case "next":
      if (previewState.queue.length)
        await command(
          "play",
          ((previewState.index ?? 0) + 1) % previewState.queue.length,
        );
      break;
    case "previous":
      await command("play", Math.max(0, (previewState.index ?? 0) - 1));
      break;
    case "seek":
      audio.currentTime = Number(value);
      break;
    case "volume":
      audio.volume = previewState.volume = Number(value);
      break;
    case "shuffle":
      previewState.shuffle = Boolean(value);
      break;
    case "repeat":
      previewState.repeat = value as Snapshot["repeat"];
      break;
    case "remove": {
      const i = Number(value);
      previewState.queue.splice(i, 1);
      if (previewState.index === i) {
        audio.pause();
        previewState.index = null;
      } else if (previewState.index !== null && previewState.index > i)
        previewState.index--;
      break;
    }
    case "clear":
      audio.pause();
      previewState.queue = [];
      previewState.index = null;
      break;
  }
}
export async function importPaths(paths: string[]) {
  return invoke<{ tracks: Track[]; warnings: string[] }>("import_paths", {
    paths,
  });
}
export async function importBrowser(files: FileList) {
  const added: Track[] = [];
  for (const file of Array.from(files)) {
    const url = URL.createObjectURL(file);
    const probe = new Audio(url);
    const duration = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => resolve(0), 4000);
      probe.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(probe.duration);
      };
      probe.onerror = () => {
        clearTimeout(timer);
        resolve(0);
      };
    });
    const format = file.name.split(".").pop()?.toUpperCase() || "AUDIO";
    const bitrate = duration
      ? Math.round((file.size * 8) / duration / 1000)
      : 0;
    const track: Track = {
      id: `browser-${file.name}-${file.lastModified}`,
      path: file.name,
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "Local file",
      album: "Your music",
      albumArtist: "Local file",
      duration,
      format,
      bitrate,
      sampleRate: 0,
      bitDepth: 0,
      channels: 2,
      trackNumber: 0,
      discNumber: 1,
      cover: null,
      quality: ["MP3", "AAC", "M4A", "OGG", "OPUS"].includes(format)
        ? "LQ"
        : bitrate > 1500
          ? "HR"
          : "SQ",
    };
    urls.set(track.id, url);
    if (!previewTracks.some((t) => t.id === track.id))
      previewTracks.push(track);
    added.push(track);
  }
  return added;
}
