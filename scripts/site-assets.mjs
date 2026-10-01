import sharp from "sharp";
import { mkdir } from "node:fs/promises";
const output = "site/public/assets";
await mkdir(output, { recursive: true });
for (const skin of ["classic", "sakura", "midnight", "snow", "terminal"]) {
  for (const panel of ["main", "equalizer", "playlist"]) {
    await sharp(`output/visual-review/final/${skin}-${panel}.png`)
      .webp({ quality: 93 })
      .toFile(`${output}/${skin}-${panel}.webp`);
  }
  const source = `assets/skin-atlases/${skin}.png`;
  const { width, height } = await sharp(source).metadata();
  await sharp(source)
    .extract({
      left: Math.round(width * 0.5),
      top: 0,
      width: Math.floor(width * 0.5),
      height: Math.round(height * 0.735),
    })
    .resize(650, 740, { fit: "cover", position: "right top" })
    .webp({ quality: 89 })
    .toFile(`${output}/${skin}-portrait.webp`);
}
console.log("Prepared five sets of real player screenshots and skin artwork.");
