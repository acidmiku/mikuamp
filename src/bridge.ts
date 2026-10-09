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
let previewAudioContext: AudioContext | undefined;
let previewAnalyser: AnalyserNode | undefined;
let previewAnalysisUnavailable = false;
let previewFrequency = new Float32Array(1024);
let previewWaveform = new Float32Array(2048);
let previewWaveformStep = 6;
let previewStopped = true;
let previewAnalysisReadyAt = 0;

function waitForFreshPreviewAnalysis() {
  previewAnalysisReadyAt =
    (previewAudioContext?.currentTime ?? 0) +
    (previewAnalyser?.fftSize ?? 2048) /
      (previewAudioContext?.sampleRate ?? 48000);
}

function resetPreviewVisualization() {
  const revision = previewState.visualizationRevision ?? 0;
  previewState.visualizationRevision =
    revision >= Number.MAX_SAFE_INTEGER ? 0 : revision + 1;
  previewState.spectrum.fill(0);
  previewState.waveform?.fill(0);
  waitForFreshPreviewAnalysis();
}

function preparePreviewAnalysis() {
  if (previewAnalysisUnavailable || previewAudioContext) return;
  if (typeof AudioContext === "undefined") {
    previewAnalysisUnavailable = true;
    return;
  }
  let source: MediaElementAudioSourceNode | undefined;
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const analyser = context.createAnalyser();
    previewWaveformStep = Math.max(
      1,
      Math.round((context.sampleRate * 0.032) / 256),
    );
    analyser.fftSize = Math.max(
      2048,
      2 ** Math.ceil(Math.log2(previewWaveformStep * 256)),
    );
    previewFrequency = new Float32Array(analyser.frequencyBinCount);
    previewWaveform = new Float32Array(analyser.fftSize);
    previewState.waveformDuration =
      (previewWaveformStep * 256) / context.sampleRate;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -65;
    analyser.maxDecibels = 0;
    source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    previewAudioContext = context;
    previewAnalyser = analyser;
  } catch {
    previewAnalysisUnavailable = true;
    // A media element can be attached to only one source. Keep that source
    // audible even if this browser cannot finish creating its analyser.
    if (source && context) {
      source.disconnect();
      source.connect(context.destination);
      previewAudioContext = context;
    } else if (context) {
      void context.close();
    }
  }
}

function updatePreviewAnalysis() {
  const waveform = (previewState.waveform ??= Array(256).fill(0));
  if (
    !previewState.playing ||
    audio.seeking ||
    !previewAnalyser ||
    previewAudioContext?.state !== "running" ||
    previewAudioContext.currentTime < previewAnalysisReadyAt
  ) {
    previewState.spectrum.fill(0);
    waveform.fill(0);
    return;
  }
  previewAnalyser.getFloatFrequencyData(previewFrequency);
  previewAnalyser.getFloatTimeDomainData(previewWaveform);
  const rate = previewAudioContext.sampleRate;
  const fftSize = previewAnalyser.fftSize;
  const bins = previewFrequency.length;
  for (let i = 0; i < 32; i++) {
    const low = 32 * (18000 / 32) ** (i / 32);
    const high = 32 * (18000 / 32) ** ((i + 1) / 32);
    const a = Math.max(
      1,
      Math.min(bins - 1, Math.floor((low * fftSize) / rate)),
    );
    const b = Math.max(
      a + 1,
      Math.min(bins, Math.ceil((high * fftSize) / rate)),
    );
    let peak = -Infinity;
    for (let bin = a; bin < b; bin++)
      peak = Math.max(peak, previewFrequency[bin]);
    const value = Number.isFinite(peak)
      ? Math.max(0, Math.min(1, (peak + 65) / 65))
      : 0;
    previewState.spectrum[i] = Math.max(value, previewState.spectrum[i] * 0.78);
  }
  const start = previewWaveform.length - 256 * previewWaveformStep;
  for (let i = 0; i < 256; i++) {
    let total = 0;
    for (let n = 0; n < previewWaveformStep; n++) {
      const sample = previewWaveform[start + i * previewWaveformStep + n];
      total += Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    }
    const value = total / previewWaveformStep;
    waveform[i] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }
}
audio.addEventListener("seeked", waitForFreshPreviewAnalysis);
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
  previewState.playing = !audio.paused && !audio.ended;
  updatePreviewAnalysis();
  return { ...previewState };
}
export async function getEq() {
  return native ? invoke<Eq>("get_eq") : previewEq;
}
export async function setEq(settings: Eq) {
  if (native) await invoke("set_eq", { settings });
  else previewEq = settings;
}
/** Appends tracks, replaces the queue, or inserts them at `at` (used by Play next). */
export async function enqueue(ids: string[], replace = false, at?: number) {
  if (native) return invoke("enqueue", { ids, replace, at: at ?? null });
  if (replace) {
    audio.pause();
    previewStopped = true;
    resetPreviewVisualization();
    previewState.index = null;
    previewState.queue = [];
  }
  if (at === undefined || replace) {
    previewState.queue.push(...ids);
    return;
  }
  const position = Math.min(at, previewState.queue.length);
  previewState.queue.splice(position, 0, ...ids);
  if (previewState.index !== null && previewState.index >= position)
    previewState.index += ids.length;
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
      const newSource = !!url && audio.src !== url;
      const restarting =
        newSource || typeof value === "number" || audio.ended || previewStopped;
      if (newSource) audio.src = url!;
      else if (restarting) audio.currentTime = 0;
      audio.volume = previewState.volume;
      preparePreviewAnalysis();
      // Start both calls in the user gesture so autoplay policies allow playback.
      await Promise.all([previewAudioContext?.resume(), audio.play()]);
      if (restarting) resetPreviewVisualization();
      previewStopped = false;
      break;
    }
    case "pause":
      audio.pause();
      break;
    case "stop":
      audio.pause();
      audio.currentTime = 0;
      previewStopped = true;
      resetPreviewVisualization();
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
    case "seek": {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0)
        throw new Error("Invalid seek position");
      audio.currentTime = seconds;
      resetPreviewVisualization();
      break;
    }
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
        previewStopped = true;
        resetPreviewVisualization();
        previewState.index = null;
      } else if (previewState.index !== null && previewState.index > i)
        previewState.index--;
      break;
    }
    case "move": {
      const { from, to } = value as { from: number; to: number };
      const [id] = previewState.queue.splice(from, 1);
      previewState.queue.splice(to, 0, id);
      const i = previewState.index;
      if (i === from) previewState.index = to;
      else if (i !== null && from < i && i <= to) previewState.index = i - 1;
      else if (i !== null && to <= i && i < from) previewState.index = i + 1;
      break;
    }
    case "clear":
      audio.pause();
      previewStopped = true;
      resetPreviewVisualization();
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
