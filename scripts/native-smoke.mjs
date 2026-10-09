import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("output/screenshots", { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const context = browser.contexts()[0];
const page =
  context.pages().find((p) => !p.url().includes("panel=")) ||
  context.pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.waitForLoadState("domcontentloaded");
const invoke = (command, args = {}) =>
  page.evaluate(
    ([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args),
    [command, args],
  );
await invoke("transport", { action: "clear" });
const result = await invoke("import_paths", {
  paths: [resolve("output/fixtures")],
});
if (result.tracks.length !== 4)
  throw new Error(
    `Expected 4 imported tracks, got ${result.tracks.length}: ${JSON.stringify(result.warnings)}`,
  );
if (result.warnings.length !== 1)
  throw new Error("Corrupt file should produce one warning");
const flac = result.tracks.find((t) => t.title.startsWith("星"));
const mp3 = result.tracks.find((t) => t.format === "MP3");
const hr = result.tracks.find((t) => t.sampleRate === 96000);
const alac = result.tracks.find((t) => t.path.endsWith(".m4a"));
if (
  !flac ||
  flac.quality !== "SQ" ||
  flac.bitDepth !== 16 ||
  mp3.quality !== "LQ" ||
  hr.quality !== "HR" ||
  hr.bitDepth !== 24 ||
  alac.format !== "ALAC"
)
  throw new Error(
    `Unexpected metadata ${JSON.stringify(result.tracks.map(({ cover, ...t }) => t))}`,
  );
if (result.tracks.some((t) => !t.cover))
  throw new Error("Folder or embedded cover extraction failed");
await invoke("enqueue", {
  ids: [flac.id, mp3.id, hr.id, alac.id],
  replace: true,
});
await invoke("transport", { action: "volume", value: 0.04 });
await invoke("transport", { action: "play", value: 0 });
await page.waitForTimeout(800);
let s = await invoke("get_snapshot");
if (
  !s.playing ||
  s.position < 0.1 ||
  !s.outputRate ||
  Math.max(...s.spectrum) < 0.1
)
  throw new Error(`Native playback/spectrum failed: ${JSON.stringify(s)}`);
await invoke("transport", { action: "seek", value: 7 });
await page.waitForTimeout(350);
s = await invoke("get_snapshot");
if (s.position < 6.7) throw new Error(`Seek failed: ${s.position}`);
await invoke("transport", { action: "pause" });
await page.waitForTimeout(150);
const p1 = (await invoke("get_snapshot")).position;
await page.waitForTimeout(300);
const p2 = (await invoke("get_snapshot")).position;
if (Math.abs(p1 - p2) > 0.2) throw new Error("Pause did not hold position");
const eq = await invoke("get_eq");
eq.enabled = true;
eq.bands[5].gain = 6;
eq.toneEnabled = true;
eq.tone[0] = 20;
await invoke("set_eq", { settings: eq });
for (const index of [1, 2, 3]) {
  await invoke("transport", { action: "play", value: index });
  await page.waitForTimeout(450);
  s = await invoke("get_snapshot");
  if (!s.playing || s.position < 0.1)
    throw new Error(`Playback failed for index ${index}`);
}
await invoke("transport", { action: "play", value: 0 });
await page.waitForTimeout(250);
const layout = await page.evaluate(() => ({
  playerBottom: document.querySelector(".player").getBoundingClientRect()
    .bottom,
  height: innerHeight,
}));
if (layout.playerBottom > layout.height + 2)
  throw new Error(
    `Player controls overflow the window: ${JSON.stringify(layout)}`,
  );
await page.screenshot({ path: "output/screenshots/native-player.png" });
await page.getByRole("button", { name: "Library", exact: true }).click();
await expect
  .poll(() => context.pages().find((p) => p.url().includes("panel=library")), {
    timeout: 10000,
  })
  .toBeTruthy();
const library = context.pages().find((p) => p.url().includes("panel=library"));
await library.waitForLoadState("domcontentloaded");
await expect(
  library.getByRole("button", { name: "Open 星のかけら", exact: true }),
).toBeVisible();
await library.screenshot({ path: "output/screenshots/native-library.png" });
await library
  .getByRole("button", { name: "Open 星のかけら", exact: true })
  .click();
await library.screenshot({ path: "output/screenshots/native-album.png" });
await library.getByRole("button", { name: "Close library" }).click();
await invoke("set_panel_visible", { label: "equalizer", visible: true });
await expect
  .poll(
    () => context.pages().find((p) => p.url().includes("panel=equalizer")),
    { timeout: 10000 },
  )
  .toBeTruthy();
const equalizer = context
  .pages()
  .find((p) => p.url().includes("panel=equalizer"));
await equalizer.waitForLoadState("domcontentloaded");
await equalizer.getByRole("button", { name: "Tone", exact: true }).click();
await equalizer.screenshot({ path: "output/screenshots/native-tone.png" });
await equalizer.getByRole("button", { name: "Close equalizer" }).click();
await page.getByRole("button", { name: "EQ", exact: true }).click();
await page.getByRole("button", { name: /^Skins:/ }).click();
await expect
  .poll(() => context.pages().find((p) => p.url().includes("panel=skins")), {
    timeout: 10000,
  })
  .toBeTruthy();
const skinPage = context.pages().find((p) => p.url().includes("panel=skins"));
await skinPage.waitForLoadState("domcontentloaded");
await skinPage.screenshot({ path: "output/screenshots/native-skins.png" });
for (const [name, bg] of [
  ["Sakura", "#302128"],
  ["Midnight", "#111221"],
  ["Snow", "#e2e9f0"],
  ["39.exe", "#071410"],
  ["Classic Teal", "#111b1e"],
]) {
  await skinPage
    .getByRole("button")
    .filter({ has: skinPage.locator("strong", { hasText: name }) })
    .click();
  await page.waitForTimeout(120);
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((e) => getComputedStyle(e).getPropertyValue("--bg").trim()),
    )
    .toBe(bg);
}
await skinPage.getByRole("button", { name: "Close skins" }).click();
await invoke("transport", { action: "stop" });
s = await invoke("get_snapshot");
if (s.playing || s.position !== 0) throw new Error("Stop failed");
await invoke("transport", { action: "remove", value: 1 });
if ((await invoke("get_snapshot")).queue.length !== 3)
  throw new Error("Remove failed");
await invoke("transport", { action: "shuffle", value: true });
await invoke("transport", { action: "repeat", value: "all" });
await invoke("export_playlist", { path: resolve("output/test-playlist.m3u8") });
eq.enabled = false;
eq.toneEnabled = false;
eq.tone.fill(0);
eq.bands.forEach((b) => (b.gain = 0));
await invoke("set_eq", { settings: eq });
if (errors.length) throw new Error(errors.join("\n"));
await writeFile(
  "output/native-test-results.json",
  JSON.stringify(
    {
      passed: true,
      metadata: result.tracks.map(({ cover, ...t }) => ({
        ...t,
        coverExtracted: !!cover,
      })),
      outputRate: s.outputRate,
      checks: [
        "Unicode files and tags",
        "FLAC 16/44.1",
        "FLAC 24/96 HR",
        "MP3 LQ",
        "ALAC",
        "embedded and folder covers",
        "bad-file warning",
        "WASAPI output",
        "FFT spectrum",
        "seek",
        "pause",
        "all decoders playback",
        "PEQ/Tone update",
        "library window",
        "EQ window",
        "skin window",
        "cross-window skin sync",
        "queue remove",
        "shuffle/repeat",
        "UTF-8 M3U8 export",
        "stop",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Native smoke passed: metadata, all decoders, actual WASAPI output, DSP, spectrum, seeking, windows, skins, playlist.",
);
await browser.close();
