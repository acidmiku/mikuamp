import { createHarness } from "./visual-harness.mjs";
import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const h = await createHarness();
const dir = "output/visual-review/scale-check";
await mkdir(dir, { recursive: true });
try {
  h.tracks.splice(0);
  Object.assign(h.snapshot, {
    queue: [],
    index: null,
    playing: false,
    position: 0,
    spectrum: Array(32).fill(0),
  });
  const main = await h.panel("main"),
    skins = await h.panel("skins");
  await h.skin("snow");
  const dimensions = [];
  for (const [i, scale] of ["1", "1.15", "1.3", "1", "1.3", "1"].entries()) {
    await skins
      .getByRole("combobox", { name: "Interface scale" })
      .selectOption(scale);
    await expect
      .poll(() => main.viewportSize().width)
      .toBe(Math.round(455 * +scale));
    await main.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await main.waitForTimeout(200);
    const metrics = await main.evaluate(() => {
      const shell = document
        .querySelector(".app-shell")
        .getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        shell: [shell.width, shell.height],
        players: document.querySelectorAll(".player").length,
        ratio: devicePixelRatio,
      };
    });
    expect(metrics.players).toBe(1);
    expect(Math.abs(metrics.viewport[0] - metrics.shell[0])).toBeLessThan(1);
    expect(Math.abs(metrics.viewport[1] - metrics.shell[1])).toBeLessThan(2);
    dimensions.push({ scale, ...metrics });
    await h.shot("main", `${dir}/${i}-empty-${scale}.png`);
  }
  expect(h.errors).toEqual([]);
  await writeFile(`${dir}/metrics.json`, JSON.stringify(dimensions, null, 2));
  console.log(
    "PASS fresh empty main and repeated scale changes; one player, viewport matches shell at every size",
  );
} finally {
  await h.browser.close();
}
