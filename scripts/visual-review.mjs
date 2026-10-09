import { createHarness } from "./visual-harness.mjs";
import { expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const round = process.argv[2] || "baseline";
const dir = `output/visual-review/${round}`;
await mkdir(dir, { recursive: true });
const h = await createHarness();
const report = [];
try {
  for (const label of ["main", "equalizer", "playlist", "library", "skins"])
    await h.panel(label);
  for (const theme of [
    "classic",
    "sakura",
    "midnight",
    "snow",
    "terminal",
    "pencil",
  ]) {
    await h.skin(theme);
    for (const label of h.pages.keys()) {
      const p = h.pages.get(label);
      await h.shot(label, `${dir}/${theme}-${label}.png`);
      report.push({
        theme,
        label,
        ...(await p.evaluate(() => {
          const shell = document.querySelector(".app-shell");
          return {
            size: [innerWidth, innerHeight],
            horizontalOverflow: shell.scrollWidth - shell.clientWidth,
            verticalOverflow: shell.scrollHeight - shell.clientHeight,
          };
        })),
      });
    }
    const sources = await Promise.all(
      ["main", "equalizer", "playlist"].map(async (label) => ({
        input: `${dir}/${theme}-${label}.png`,
        meta: await sharp(`${dir}/${theme}-${label}.png`).metadata(),
      })),
    );
    let top = 0;
    const composite = sources.map((s) => {
      const item = { input: s.input, left: 0, top };
      top += s.meta.height + 6;
      return item;
    });
    await sharp({
      create: {
        width: Math.max(...sources.map((s) => s.meta.width)),
        height: top - 6,
        channels: 3,
        background: "#24272b",
      },
    })
      .composite(composite)
      .png()
      .toFile(`${dir}/${theme}-stack.png`);
  }
  await h.skin("classic");
  const lib = await h.panel("library");
  await lib
    .getByRole("button", {
      name: "Open Очень длинное название альбома — 初音ミクと夜の音楽",
      exact: true,
    })
    .click();
  await lib.setViewportSize({ width: 510, height: 440 });
  await lib.screenshot({ path: `${dir}/library-long.png` });
  await lib.setViewportSize({ width: 710, height: 591 });
  await lib.getByRole("button", { name: "All albums" }).click();
  await lib.waitForTimeout(500);
  await lib.bringToFront();
  await lib.locator(".album-card").nth(1).hover();
  await lib.waitForTimeout(400);
  await lib.screenshot({ path: `${dir}/library-hover.png` });
  const eq = await h.panel("equalizer");
  const node = eq.getByRole("button", { name: /^Band 5:/ });
  await node.hover();
  await eq.waitForTimeout(180);
  await h.shot("equalizer", `${dir}/equalizer-hover.png`);
  await eq.getByRole("button", { name: "Tone", exact: true }).click();
  await eq.waitForTimeout(180);
  await h.shot("equalizer", `${dir}/tone.png`);
  await eq.getByRole("button", { name: "Parametric", exact: true }).click();
  const pl = await h.panel("playlist");
  await pl.bringToFront();
  await pl.getByRole("option").nth(3).click({ button: "right" });
  await pl.waitForTimeout(250);
  await pl.screenshot({ path: `${dir}/queue-menu.png` });
  await pl.keyboard.press("Escape");
  const main = await h.panel("main");
  await main.bringToFront();
  await main.getByRole("button", { name: "Mini player", exact: true }).click();
  await expect.poll(() => main.viewportSize().width).toBe(255);
  await main.waitForTimeout(700);
  await h.shot("main", `${dir}/mini.png`);
  await main.getByRole("button", { name: "Full player", exact: true }).click();
  await main.waitForTimeout(600);
  const skins = await h.panel("skins");
  await skins
    .getByRole("combobox", { name: "Interface scale" })
    .selectOption("1.3");
  await skins.waitForTimeout(220);
  for (const label of h.pages.keys())
    await h.shot(label, `${dir}/scale130-${label}.png`);
  await writeFile(
    `${dir}/metrics.json`,
    JSON.stringify({ report, errors: h.errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        dir,
        errors: h.errors,
        overflow: report.filter(
          (r) => r.horizontalOverflow > 1 || r.verticalOverflow > 1,
        ),
      },
      null,
      2,
    ),
  );
  if (h.errors.length) throw Error(h.errors.join("\n"));
} finally {
  await h.browser.close();
}
