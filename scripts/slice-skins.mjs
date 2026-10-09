import sharp from "sharp";
import { mkdir, readFile, copyFile, writeFile, access } from "node:fs/promises";
const sources = JSON.parse(
  await readFile(new URL("./skin-sources.json", import.meta.url), "utf8"),
);
await mkdir("assets/skin-atlases", { recursive: true });
for (const { id, source: original } of sources) {
  let source = original;
  try {
    await access(source);
  } catch {
    source = `assets/skin-atlases/${id}.png`;
  }
  const out = `public/skins/${id}`;
  await mkdir(out, { recursive: true });
  if (source !== `assets/skin-atlases/${id}.png`)
    await copyFile(source, `assets/skin-atlases/${id}.png`);
  const { width, height } = await sharp(source).metadata();
  const split = Math.round(height * 0.735);
  await sharp(source)
    .extract({ left: 0, top: 0, width, height: split })
    .webp({ quality: 90 })
    .toFile(`${out}/scene.webp`);
  await sharp(source)
    .extract({ left: 0, top: split + 8, width, height: height - split - 8 })
    .webp({ quality: 88 })
    .toFile(`${out}/chrome.webp`);
  await sharp(source)
    .extract({
      left: Math.round(width * 0.5),
      top: 0,
      width: Math.floor(width * 0.5),
      height: split,
    })
    .resize(320, 320, { fit: "cover", position: "right top" })
    .webp({ quality: 88 })
    .toFile(`${out}/preview.webp`);
  await writeFile(
    `${out}/slices.json`,
    JSON.stringify(
      {
        atlas: `${id}.png`,
        width,
        height,
        scene: [0, 0, width, split],
        chrome: [0, split + 8, width, height - split - 8],
        scale: "CSS logical pixels; raster atlas retained at full resolution",
      },
      null,
      2,
    ),
  );
}
await mkdir("src-tauri/icons", { recursive: true });
const icon = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="4" y="4" width="248" height="248" rx="52" fill="#14292d"/><path d="M48 188V68h32l48 68 48-68h32v120h-34v-68l-46 62-46-62v68Z" fill="#72f2d6"/><path d="M188 40h24v14h-24Z" fill="#fa72ad"/></svg>`,
);
const png = await sharp(icon).png().toBuffer();
await writeFile("src-tauri/icons/icon.png", png);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("src-tauri/icons/icon.ico", Buffer.concat([header, png]));
console.log("Skin atlases sliced; app icons built.");
