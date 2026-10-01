import { createHarness } from "./visual-harness.mjs";
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
  for (const theme of ["classic", "sakura", "midnight", "snow", "terminal"]) {
    await h.skin(theme);
    for (const label of h.pages.keys()) {
      const p = h.pages.get(label);
      await h.shot(label, `${dir}/${theme}-${label}.png`);
      report.push({
        theme,
        label,
        ...(await p.evaluate(() => {
          const shell = document.querySelector(".app-shell"),
            title = document
              .querySelector(".window-title")
              .getBoundingClientRect();
          return {
            size: [innerWidth, innerHeight],
            horizontalOverflow: shell.scrollWidth - shell.clientWidth,
            verticalOverflow: shell.scrollHeight - shell.clientHeight,
            titleOffset: Math.abs(title.x + title.width / 2 - innerWidth / 2),
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
  const eq = await h.panel("equalizer");
  await eq.getByRole("button", { name: /BAND 05/ }).click();
  await eq.waitForTimeout(180);
  await h.shot("equalizer", `${dir}/equalizer-details.png`);
  await eq.getByRole("button", { name: "TONE", exact: true }).click();
  await eq.waitForTimeout(180);
  await h.shot("equalizer", `${dir}/tone.png`);
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
        uncentered: report.filter((r) => r.titleOffset > 1),
      },
      null,
      2,
    ),
  );
  if (h.errors.length) throw Error(h.errors.join("\n"));
} finally {
  await h.browser.close();
}
