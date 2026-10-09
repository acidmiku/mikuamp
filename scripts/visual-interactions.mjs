// Browser regression checks for desktop layout and IPC wiring; no native app control.
import { expect } from "@playwright/test";
import { createHarness } from "./visual-harness.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const h = await createHarness();
const dir = "output/visual-review/interactions";
await mkdir(dir, { recursive: true });
const results = [];
const checked = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
try {
  const main = await h.panel("main");
  const pl = await h.panel("playlist");
  const lib = await h.panel("library");
  const skins = await h.panel("skins");
  const eq = await h.panel("equalizer");

  for (const [name, label] of [
    ["EQ", "equalizer"],
    [/^Queue/, "playlist"],
    ["Library", "library"],
    [/^Skins:/, "skins"],
  ]) {
    const button = main.getByRole("button", {
      name,
      exact: typeof name === "string",
    });
    await button.focus();
    const before = h.panels.find((p) => p.label === label).visible;
    const playing = h.snapshot.playing;
    await button.press("Space");
    await expect(button).toHaveAttribute("aria-pressed", String(!before));
    expect(h.snapshot.playing).toBe(playing);
    await button.press("Space");
    await expect(button).toHaveAttribute("aria-pressed", String(before));
  }
  await main.getByRole("button", { name: "Library", exact: true }).click();
  await lib.getByRole("button", { name: "Close library", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  checked(
    "All panel buttons toggle by keyboard; closing Library synchronizes its button without toggling playback",
  );

  await main.getByRole("slider", { name: "Volume", exact: true }).fill("0.27");
  await expect.poll(() => h.snapshot.volume).toBe(0.27);
  await expect(main.locator(".volume-control > span")).toHaveText("27");
  await main.getByRole("button", { name: "Mute", exact: true }).click();
  await main.getByRole("button", { name: "Unmute", exact: true }).click();
  await expect.poll(() => h.snapshot.volume).toBe(0.27);
  checked("Mute restores the previous volume");

  const rows = pl.getByRole("option");
  await expect(rows).toHaveCount(24);
  await expect(pl.locator('.track-row[tabindex="0"]')).toHaveCount(1);
  await rows.first().focus();
  await pl.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await pl.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await pl.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await pl.keyboard.press("ArrowDown");
  await pl.keyboard.press("Enter");
  await expect.poll(() => h.snapshot.index).toBe(1);
  await pl.keyboard.press("Delete");
  await expect(rows).toHaveCount(23);
  await expect(rows.nth(1)).toBeFocused();
  await pl.keyboard.press("Tab");
  await expect(
    pl.getByRole("button", { name: "Add", exact: true }),
  ).toBeFocused();
  await pl.getByRole("textbox", { name: "Search queue" }).fill("Afterglow");
  await expect(
    pl.getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled();
  await expect(pl.locator('.track-row[tabindex="0"]')).toHaveCount(1);
  await pl.getByRole("textbox", { name: "Search queue" }).fill("");
  checked(
    "Playlist arrows/Home/End, Enter, Delete and single Tab stop; hidden selections cannot be removed",
  );

  const alignment = await pl
    .locator(".track-info")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x));
  expect(Math.max(...alignment) - Math.min(...alignment)).toBeLessThan(1);
  for (const theme of [
    "classic",
    "sakura",
    "midnight",
    "snow",
    "terminal",
    "pencil",
  ]) {
    await h.skin(theme);
    const contrast = await pl
      .locator(".track-row:not(.current-track) .track-info strong")
      .first()
      .evaluate((node) => {
        const ctx = document.createElement("canvas").getContext("2d");
        const rgb = (color) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        const luminance = (color) =>
          rgb(color)
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(getComputedStyle(node).color),
          b = luminance(
            getComputedStyle(node.closest(".track-list")).backgroundColor,
          );
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    expect(contrast).toBeGreaterThan(4.5);
  }
  checked(
    "All five playlists meet 4.5:1 title contrast and playing rows keep aligned columns",
  );

  await h.skin("classic");
  const long = "ОченьДлинноеНазваниеБезПробелов初音ミク".repeat(5);
  h.tracks.push({
    ...h.tracks[0],
    id: "long",
    title: long,
    artist: long,
    albumArtist: long,
    album: long,
    cover: null,
  });
  await h.emit("library-changed", null);
  await lib.setViewportSize({ width: 510, height: 364 });
  await lib.getByRole("button", { name: `Open ${long}`, exact: true }).click();
  await expect(lib.locator(".album-song")).toHaveCount(1);
  const longLayout = await lib.evaluate(() => {
    const detail = document.querySelector(".album-detail"),
      heading = document.querySelector(".album-detail-heading h2"),
      row = document.querySelector(".album-song");
    return {
      overflow: detail.scrollWidth - detail.clientWidth,
      titleHeight: heading.getBoundingClientRect().height,
      rowBottom: row.getBoundingClientRect().bottom,
      bottom: innerHeight,
    };
  });
  expect(longLayout.overflow).toBeLessThanOrEqual(1);
  expect(longLayout.titleHeight).toBeLessThanOrEqual(41);
  expect(longLayout.rowBottom).toBeLessThan(longLayout.bottom);
  await h.shot("library", `${dir}/library-unbroken.png`);
  await lib
    .getByRole("textbox", { name: "Search library" })
    .fill("After hours");
  await expect(lib.locator(".album-card")).toHaveCount(1);
  await expect(lib.locator(".album-detail")).toHaveCount(0);
  checked(
    "Long unbroken Unicode metadata stays contained at minimum Library size; search exits album detail",
  );

  for (const scale of ["1", "1.15", "1.3"]) {
    await skins
      .getByRole("combobox", { name: "Interface scale" })
      .selectOption(scale);
    await skins.waitForTimeout(150);
    await expect(
      skins.getByRole("button", { name: "Import skin", exact: true }),
    ).toBeInViewport();
    for (const card of await skins.locator(".skin-card").all())
      await expect(card).toBeInViewport({ ratio: 1 });
    for (const p of [main, pl, lib, skins, eq]) {
      const overflow = await p
        .locator(".app-shell")
        .evaluate((n) => [
          n.scrollWidth - n.clientWidth,
          n.scrollHeight - n.clientHeight,
        ]);
      expect(Math.max(...overflow)).toBeLessThanOrEqual(1);
    }
  }
  await h.shot("skins", `${dir}/skins130.png`);
  await skins
    .getByRole("combobox", { name: "Interface scale" })
    .selectOption("1");
  await skins
    .locator('.skin-gallery input[type="file"]')
    .setInputFiles("output/skin-packs/snow.mikuamp.json");
  await expect(skins.locator(".skin-card")).toHaveCount(7);
  await skins.reload();
  await expect(skins.locator(".skin-card.chosen")).toHaveAttribute(
    "aria-label",
    "Snow",
  );
  await expect(pl.locator(".app-shell")).toHaveClass(/light-skin/);
  checked(
    "Skins and Import fit at every scale; custom skin import survives reload",
  );

  await eq.getByRole("button", { name: /^Band 5:/ }).click();
  await eq
    .getByRole("spinbutton", { name: "Band frequency", exact: true })
    .fill("1234");
  await eq
    .getByRole("spinbutton", { name: "Band frequency", exact: true })
    .press("Enter");
  await expect.poll(() => h.eq.bands[4].frequency).toBe(1234);
  await eq.getByRole("button", { name: "Tone", exact: true }).click();
  await eq.getByRole("slider", { name: "Temperature", exact: true }).fill("35");
  await expect.poll(() => h.eq.tone[0]).toBe(35);
  checked("PEQ and Tone controls send their edited values");

  await eq.getByRole("button", { name: "Parametric", exact: true }).click();
  const node = eq.getByRole("button", { name: /^Band 3:/ });
  const gain = h.eq.bands[2].gain;
  await node.focus();
  await node.press("ArrowUp");
  await expect.poll(() => h.eq.bands[2].gain).toBe(gain + 0.5);
  await node.press("PageUp");
  await expect.poll(() => h.eq.bands[2].q).toBe(1.25);
  await eq.bringToFront();
  const box = await node.boundingBox();
  await eq.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await eq.mouse.down();
  await eq.mouse.move(box.x + box.width / 2 + 40, box.y - 30, { steps: 6 });
  await eq.mouse.up();
  await expect.poll(() => h.eq.bands[2].frequency).toBeGreaterThan(125);
  await expect.poll(() => h.eq.bands[2].gain).toBeGreaterThan(gain + 0.5);
  checked("EQ nodes nudge by keyboard and reshape the curve by dragging");

  await pl.bringToFront();
  const order = () => h.snapshot.queue.slice(0, 4);
  const [a, b, c] = order();
  const third = pl.getByRole("option").nth(2);
  const rowBox = await third.boundingBox();
  await pl.mouse.move(rowBox.x + 60, rowBox.y + rowBox.height / 2);
  await pl.mouse.down();
  // Carry the row up by one slot.
  await pl.mouse.move(rowBox.x + 60, rowBox.y - rowBox.height * 0.6, {
    steps: 8,
  });
  await pl.mouse.up();
  await expect.poll(() => order().slice(0, 3)).toEqual([a, c, b]);
  await pl.getByRole("option").nth(1).focus();
  await pl.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order().slice(0, 3)).toEqual([a, b, c]);
  await expect(pl.getByRole("option").nth(2)).toBeFocused();
  h.snapshot.index = 0;
  await expect(pl.locator(".current-track")).toHaveAttribute("data-index", "0");
  const last = h.snapshot.queue.at(-1);
  await pl.getByRole("option").last().click({ button: "right" });
  await pl.getByRole("menuitem", { name: /Play next/ }).click();
  await expect.poll(() => h.snapshot.queue[1]).toBe(last);
  checked(
    "Queue rows reorder by drag and Alt+arrows; context menu queues Play next",
  );

  await lib.bringToFront();
  // Let the Library window's 100 ms snapshot catch up with the queue edits.
  await lib.waitForTimeout(250);
  const before = [...h.snapshot.queue];
  await lib
    .getByRole("button", { name: "Play album After hours", exact: true })
    .click();
  await expect.poll(() => h.snapshot.queue.length).toBe(4);
  await lib.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => h.snapshot.queue).toEqual(before);
  await lib
    .getByRole("button", { name: "Play After hours next", exact: true })
    .click();
  await expect.poll(() => h.snapshot.queue.length).toBe(before.length + 4);
  checked(
    "Playing an album replaces the queue with Undo; Play next inserts after the current track",
  );

  await main.bringToFront();
  h.panels.find((p) => p.label === "equalizer").visible = true;
  h.panels.find((p) => p.label === "playlist").visible = true;
  await h.emit("panels-changed", h.panels);
  await main.getByRole("button", { name: "Mini player", exact: true }).click();
  await expect.poll(() => main.viewportSize().width).toBe(255);
  expect(h.panels.filter((p) => p.visible && p.label !== "main")).toEqual([]);
  await expect(main.getByRole("region", { name: "Mini player" })).toBeVisible();
  await main.keyboard.press("Control+m");
  await expect.poll(() => main.viewportSize().width).toBe(455);
  await expect
    .poll(() =>
      h.panels
        .filter((p) => p.visible)
        .map((p) => p.label)
        .sort(),
    )
    .toEqual(["equalizer", "main", "playlist"]);
  checked(
    "Mini player narrows the window, hides panels and restores them on expand",
  );

  h.tracks.splice(0);
  Object.assign(h.snapshot, {
    queue: [],
    index: null,
    playing: false,
    position: 0,
    spectrum: Array(32).fill(0),
  });
  await h.emit("library-changed", null);
  await lib.getByRole("textbox", { name: "Search library" }).fill("");
  await pl.setViewportSize({ width: 455, height: 119 });
  await expect(
    main.getByRole("button", { name: "Previous track", exact: true }),
  ).toBeDisabled();
  await expect(
    main.getByRole("button", { name: "Next track", exact: true }),
  ).toBeDisabled();
  await expect(
    pl.getByRole("button", { name: "Save list", exact: true }),
  ).toBeDisabled();
  await h.shot("main", `${dir}/main-empty.png`);
  await h.shot("playlist", `${dir}/playlist-empty-minimum.png`);
  expect(
    await pl
      .locator(".track-list")
      .evaluate((n) => n.scrollHeight - n.clientHeight),
  ).toBeLessThanOrEqual(1);
  await skins
    .getByRole("combobox", { name: "Interface scale" })
    .selectOption("1.3");
  await expect
    .poll(() =>
      pl.locator(".app-shell").evaluate((n) => getComputedStyle(n).zoom),
    )
    .toBe("1.3");
  expect(
    await pl
      .locator(".track-list")
      .evaluate((n) => n.scrollHeight - n.clientHeight),
  ).toBeLessThanOrEqual(1);
  await h.shot("playlist", `${dir}/playlist-empty-minimum130.png`);
  await skins
    .getByRole("combobox", { name: "Interface scale" })
    .selectOption("1");
  await h.shot("library", `${dir}/library-empty.png`);
  checked(
    "Empty main, playlist and library states; unavailable transport and save controls disabled",
  );
  expect(h.errors).toEqual([]);
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify({ results, errors: h.errors }, null, 2),
  );
} finally {
  await h.browser.close();
}
