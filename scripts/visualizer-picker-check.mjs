// Exercises visual switching and the Visuals browser in the headless desktop IPC harness; no native app.
import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHarness } from "./visual-harness.mjs";

const output = "output/visualizer-review";
await mkdir(output, { recursive: true });
const h = await createHarness();
const results = [];
const checked = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
try {
  const main = await h.panel("main");
  const saved = (page = main) =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("mikuamp-visualizer") || "{}"),
    );
  const surface = main.locator(".visualizer");
  await main.bringToFront();
  await expect(surface).toHaveAttribute("data-visualizer", "classic-bars");
  await expect(main.locator(".viz-name")).toHaveText("Classic bars");

  await main.locator("body").press("v");
  await expect(surface).not.toHaveAttribute("data-visualizer", "classic-bars");
  const second = (await saved()).selected;
  await expect(main.locator(".viz-controls")).toHaveClass(/fresh/);
  await main.mouse.move(0, 0);
  await expect(main.locator(".viz-controls")).not.toHaveClass(/fresh/, {
    timeout: 4000,
  });
  await expect
    .poll(() =>
      main
        .locator(".viz-controls")
        .evaluate((n) => getComputedStyle(n).opacity),
    )
    .toBe("0");
  await expect(surface.locator("canvas")).toBeVisible();
  await main.waitForTimeout(500);
  await h.shot("main", `${output}/main-archive.png`);
  await main.locator("body").press("Shift+V");
  await expect(surface).toHaveAttribute("data-visualizer", "classic-bars");
  await surface.hover();
  await main.getByRole("button", { name: "Next visual", exact: true }).click();
  await expect(surface).toHaveAttribute("data-visualizer", second);
  checked(
    "V / Shift+V and the hover arrows flip visuals; the name shows, then fades after 3 s",
  );

  await surface.click({ button: "right" });
  await expect(main.getByRole("menu", { name: "Visual" })).toBeVisible();
  await main.waitForTimeout(200);
  await main.screenshot({ path: `${output}/main-menu.png` });
  await main.getByRole("menuitem", { name: "Add to favorites" }).click();
  expect((await saved()).favorites).toEqual([second]);
  await surface.focus();
  await surface.press("ArrowRight");
  const third = (await saved()).selected;
  await surface.press("f");
  expect((await saved()).favorites).toEqual([second, third]);
  // With two favorites, next/previous stays inside them.
  await surface.press("ArrowRight");
  expect((await saved()).selected).toBe(second);
  await surface.press("ArrowRight");
  expect((await saved()).selected).toBe(third);
  checked(
    "Right-click menu and F star visuals; two favorites become the flip rotation",
  );

  await main.getByRole("button", { name: /^Browse visuals/ }).click();
  await expect
    .poll(() => h.panels.find((p) => p.label === "visuals").visible)
    .toBe(true);
  const vb = await h.panel("visuals");
  await vb.bringToFront();
  await expect(vb.locator(".vb-card")).toHaveCount(156);
  await expect(vb.locator(".vb-card.current")).toHaveCount(1);
  // Visible previews really draw: sample the first archive card's pixels.
  await expect
    .poll(
      () =>
        vb
          .locator(".vb-card")
          .nth(1)
          .locator("canvas")
          .evaluate((c) => {
            const data = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            let lit = 0;
            for (let i = 0; i < data.length; i += 4)
              if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
            return lit;
          }),
      { timeout: 8000 },
    )
    .toBeGreaterThan(20);
  await vb.waitForTimeout(400);
  await h.shot("visuals", `${output}/browser.png`);
  checked("The Visuals browser lists all 156 visuals with live previews");

  const target = vb.getByRole("button", {
    name: "Show Mono Wave",
    exact: true,
  });
  await target.click();
  await expect(surface).toHaveAttribute(
    "data-visualizer",
    "iwrzwr:soundwave-directions:1",
  );
  await expect(vb.locator(".vb-card.current .vb-meta strong")).toHaveText(
    "Mono Wave",
  );
  await target.focus();
  await vb.keyboard.press("ArrowRight");
  await expect(
    vb.getByRole("button", { name: "Show Silk Layers", exact: true }),
  ).toBeFocused();
  await vb.keyboard.press("Enter");
  await expect(surface).toHaveAttribute(
    "data-visualizer",
    "iwrzwr:soundwave-directions:2",
  );
  checked(
    "One click (or Enter) in the browser switches the player instantly; arrows move through the grid",
  );

  await vb.getByRole("button", { name: /^Favorites/ }).click();
  await expect(vb.locator(".vb-card")).toHaveCount(2);
  await vb.getByRole("button", { name: /^Recent/ }).click();
  await expect(
    vb.locator(".vb-card").first().locator(".vb-meta strong"),
  ).toHaveText("Silk Layers");
  await vb.getByRole("button", { name: /^All visuals/ }).click();
  await vb.getByRole("textbox", { name: "Search visuals" }).fill("matrix");
  const names = await vb.locator(".vb-card .vb-meta").allTextContents();
  expect(names.length).toBeGreaterThan(5);
  expect(names.every((n) => /matrix/i.test(n))).toBe(true);
  await vb.getByRole("textbox", { name: "Search visuals" }).fill("");
  await vb.getByRole("button", { name: /^Compositions/ }).click();
  await expect(vb.locator(".vb-card")).toHaveCount(3);
  checked("Favorites, Recent, collections and search filter the browser");

  await vb
    .getByRole("button", { name: "Show Phase Mechanics", exact: true })
    .click();
  await expect(main.locator(".player-scene")).toHaveClass(/viz-expanded/);
  await main.bringToFront();
  await expect
    .poll(() =>
      main
        .locator(".player-scene")
        .evaluate((n) => n.getBoundingClientRect().height),
    )
    .toBeGreaterThan(300);
  await main.waitForTimeout(500);
  await main.waitForTimeout(1500);
  await h.shot("main", `${output}/main-square.png`);
  await vb.getByRole("button", { name: /^Soundwave Directions/ }).click();
  await vb
    .getByRole("button", { name: "Show Spectrum Ribbon", exact: true })
    .click();
  await main.bringToFront();
  await main.waitForTimeout(500);
  await main.waitForTimeout(1500);
  await h.shot("main", `${output}/main-expanded.png`);
  await surface.dblclick();
  await expect(main.locator(".player-scene")).not.toHaveClass(/viz-expanded/);
  checked(
    "Square compositions open the large display; double-click toggles it",
  );

  await vb
    .getByRole("combobox", { name: "Change visual with each new track" })
    .selectOption("all");
  const before = (await saved(main)).selected;
  h.snapshot.index = 3;
  await expect.poll(async () => (await saved(main)).selected).not.toBe(before);
  checked(
    "Optional per-track change picks a new visual when the track changes",
  );

  for (const skin of ["sakura", "snow", "terminal", "pencil"]) {
    await h.skin(skin);
    await h.shot("visuals", `${output}/browser-${skin}.png`);
    await h.shot("main", `${output}/main-${skin}.png`);
  }
  expect(h.errors).toEqual([]);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, errors: h.errors }, null, 2),
  );
} finally {
  await h.browser.close();
}
