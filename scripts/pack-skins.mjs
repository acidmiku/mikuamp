import { skins } from "../src/skins.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("output/skin-packs", { recursive: true });
for (const skin of skins) {
  const pack = { ...skin };
  for (const field of ["scene", "chrome", "preview"])
    pack[field] =
      `data:image/webp;base64,${(await readFile(`public${skin[field]}`)).toString("base64")}`;
  await writeFile(
    `output/skin-packs/${skin.id}.mikuamp.json`,
    JSON.stringify(pack),
  );
}
console.log("Wrote portable MikuAmp skin packs for every built-in skin.");
