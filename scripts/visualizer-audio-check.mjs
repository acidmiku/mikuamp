// Browser-only playback integration: no native player or system windows are opened.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("output/visualizer-review", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 500, height: 850 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:1420");
  // A generated fixture makes the check reproducible without anyone's music library.
  const rate = 48000,
    frames = rate * 4;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 330) / rate) * 10000),
      44 + i * 2,
    );
  const fixture = resolve("output/visualizer-review/analysis-test.wav");
  await writeFile(fixture, wav);
  await page
    .locator('input[type="file"][accept="audio/*,.flac"]')
    .setInputFiles(fixture);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const bridge = (call, ...args) =>
    page.evaluate(
      async ([call, args]) => {
        // Reuse Vite's actual module URL, including any HMR version. A bare re-import
        // can instantiate a second audio element after a development source edit.
        const loaded = performance
          .getEntriesByType("resource")
          .find((entry) => new URL(entry.name).pathname === "/src/bridge.ts");
        return (await import(loaded?.name ?? "/src/bridge.ts"))[call](...args);
      },
      [call, args],
    );
  const snapshot = () => bridge("getSnapshot");
  await expect
    .poll(async () => Math.max(...(await snapshot()).spectrum))
    .toBeGreaterThan(0.2);
  const live = await snapshot();
  const playbackRevision = live.visualizationRevision;
  expect(live.waveform).toHaveLength(256);
  expect(live.waveform.every(Number.isFinite)).toBe(true);
  expect(Math.max(...live.waveform)).toBeGreaterThan(0.05);
  expect(Math.min(...live.waveform)).toBeLessThan(-0.05);
  expect(live.waveformDuration).toBeGreaterThan(0.025);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(async () => Math.max(...(await snapshot()).spectrum))
    .toBe(0);
  expect((await snapshot()).waveform.every((n) => n === 0)).toBe(true);
  expect((await snapshot()).visualizationRevision).toBe(playbackRevision);

  // Pick an archive visual through the display menu and the Visuals browser.
  await page.locator(".visualizer").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Browse visuals/ }).click();
  await page
    .getByRole("textbox", { name: "Search visuals" })
    .fill("Vector Scope");
  await page
    .getByRole("button", { name: "Show Vector Scope", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close visuals", exact: true })
    .click();
  await expect(page.locator(".visualizer")).toHaveAttribute(
    "data-visualizer",
    "iwrzwr:geek-soundwaves:1",
  );
  await expect(page.locator(".visualizer canvas")).toBeVisible();
  await page.locator(".visualizer canvas").dblclick();
  await expect(page.locator(".player-scene")).toHaveClass(/viz-expanded/);
  const still = () =>
    page.locator(".visualizer canvas").evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(120);
  const pausedA = await still();
  await page.waitForTimeout(180);
  expect(await still()).toBe(pausedA);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(140);
  const movingA = await still();
  await page.waitForTimeout(180);
  expect(await still()).not.toBe(movingA);
  expect((await snapshot()).visualizationRevision).toBe(playbackRevision);
  const smallSeek = Math.min(3, (await snapshot()).position + 0.1).toFixed(1);
  await page.getByRole("slider", { name: "Seek", exact: true }).fill(smallSeek);
  await expect
    .poll(async () => (await snapshot()).visualizationRevision)
    .toBeGreaterThan(playbackRevision);
  // The redesigned player has no Stop button; stop through the same bridge call.
  await bridge("command", "stop");
  await expect.poll(async () => (await snapshot()).position).toBe(0);
  expect((await snapshot()).waveform.every((n) => n === 0)).toBe(true);
  await page.screenshot({
    path: "output/visualizer-review/browser-expanded.png",
  });

  // End-of-track must clear analysis as well, including media-element ended state.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("slider", { name: "Seek", exact: true }).fill("3.8");
  await expect.poll(async () => (await snapshot()).playing).toBe(false);
  expect((await snapshot()).waveform.every((n) => n === 0)).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "Real browser audio passed: signed PCM, spectrum, pause/resume, visual motion, stop and end-of-track silence.",
  );
} finally {
  await browser.close();
}
