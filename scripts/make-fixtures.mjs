import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = "output/fixtures";
for (const folder of [
  "01 - 星のかけら",
  "02 - Звёздная пыль",
  "03 - Studio sessions",
])
  await mkdir(`${root}/${folder}`, { recursive: true });
const ff = (args) => {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { encoding: "utf8" },
  );
  if (r.status) throw new Error(r.stderr);
};
const common = [
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=0.035*sin(2*PI*261.63*t)+0.025*sin(2*PI*329.63*t)+0.02*sin(2*PI*392*t):s=44100:d=18",
  "-ac",
  "2",
  "-metadata",
  "artist=MikuAmp Test Signals",
  "-metadata",
  "album=星のかけら",
  "-metadata",
  "album_artist=初音ミク · Test fixtures",
];
ff([
  ...common,
  "-metadata",
  "title=星のかけら · Звёздная пыль",
  "-metadata",
  "track=1",
  "-c:a",
  "flac",
  "-sample_fmt",
  "s16",
  `${root}/01 - 星のかけら/01 - 星のかけら.flac`,
]);
ff([
  ...common,
  "-metadata",
  "title=Afterglow · Test chord",
  "-metadata",
  "track=2",
  "-c:a",
  "libmp3lame",
  "-b:a",
  "192k",
  `${root}/01 - 星のかけら/02 - Afterglow.mp3`,
]);
ff([
  "-f",
  "lavfi",
  "-i",
  "anoisesrc=color=pink:amplitude=0.025:sample_rate=96000:duration=12",
  "-ac",
  "2",
  "-sample_fmt",
  "s32",
  "-c:a",
  "flac",
  "-metadata",
  "title=Тихий космос · 24-bit test",
  "-metadata",
  "artist=MikuAmp Test Signals",
  "-metadata",
  "album=Звёздная пыль",
  "-metadata",
  "album_artist=Лаборатория звука",
  `${root}/02 - Звёздная пыль/01 - Тихий космос.flac`,
]);
ff([
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=48000:duration=10",
  "-i",
  "public/skins/midnight/preview.webp",
  "-map",
  "0:a",
  "-map",
  "1:v",
  "-c:a",
  "alac",
  "-c:v",
  "mjpeg",
  "-disposition:v",
  "attached_pic",
  "-metadata",
  "title=Nightfall · ALAC test",
  "-metadata",
  "artist=MikuAmp Test Signals",
  "-metadata",
  "album=Studio sessions",
  `${root}/03 - Studio sessions/01 - Nightfall.m4a`,
]);
await copyFile(
  "public/skins/classic/preview.webp",
  `${root}/01 - 星のかけら/cover.webp`,
);
await copyFile(
  "public/skins/snow/preview.webp",
  `${root}/02 - Звёздная пыль/folder.webp`,
);
await writeFile(`${root}/broken.flac`, "not a valid audio file");
console.log(
  "Created low-volume original test signals, Unicode metadata, covers, FLAC, MP3, ALAC, and corrupt input.",
);
