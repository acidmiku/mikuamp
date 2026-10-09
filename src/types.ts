export type Track = {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  duration: number;
  format: string;
  bitrate: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  trackNumber: number;
  discNumber: number;
  cover: string | null;
  quality: "LQ" | "SQ" | "HR";
};
export type Band = {
  frequency: number;
  gain: number;
  q: number;
  kind: "peak" | "lowShelf" | "highShelf";
};
export type Eq = {
  enabled: boolean;
  preamp: number;
  bands: Band[];
  toneEnabled: boolean;
  tone: number[];
};
export type Snapshot = {
  queue: string[];
  index: number | null;
  playing: boolean;
  position: number;
  volume: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  spectrum: number[];
  waveform?: number[];
  waveformDuration?: number;
  visualizationRevision?: number;
  outputRate: number;
  error: string | null;
};
export const defaultEq = (): Eq => ({
  enabled: false,
  preamp: -3,
  bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(
    (frequency) => ({ frequency, gain: 0, q: 1, kind: "peak" }),
  ),
  toneEnabled: false,
  tone: Array(10).fill(0),
});
export const emptySnapshot = (): Snapshot => ({
  queue: [],
  index: null,
  playing: false,
  position: 0,
  volume: 0.65,
  shuffle: false,
  repeat: "off",
  spectrum: Array(32).fill(0),
  waveform: Array(256).fill(0),
  waveformDuration: 0.032,
  visualizationRevision: 0,
  outputRate: 0,
  error: null,
});
export function time(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function hz(n: number) {
  return n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`;
}
export function albumsFrom(tracks: Track[]) {
  const albums = new Map<
    string,
    {
      id: string;
      title: string;
      artist: string;
      cover: string | null;
      tracks: Track[];
    }
  >();
  for (const t of tracks) {
    const id = `${t.albumArtist}\0${t.album}`;
    let album = albums.get(id);
    if (!album) {
      album = {
        id,
        title: t.album,
        artist: t.albumArtist,
        cover: t.cover,
        tracks: [],
      };
      albums.set(id, album);
    }
    album.tracks.push(t);
    if (!album.cover && t.cover) album.cover = t.cover;
  }
  return [...albums.values()]
    .map((a) => ({
      ...a,
      tracks: a.tracks.sort(
        (a, b) =>
          a.discNumber - b.discNumber ||
          a.trackNumber - b.trackNumber ||
          a.title.localeCompare(b.title),
      ),
    }))
    .sort(
      (a, b) =>
        a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    );
}
