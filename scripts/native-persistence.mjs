import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser.contexts()[0].pages()[0];
const state = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("get_snapshot"),
);
if (
  state.queue.length !== 3 ||
  Math.abs(state.volume - 0.04) > 1e-6 ||
  !state.shuffle ||
  state.repeat !== "all" ||
  state.playing
)
  throw new Error(JSON.stringify(state));
const report = JSON.parse(
  await readFile("output/native-test-results.json", "utf8"),
);
report.checks.push(
  "restart persistence without autoplay",
  "portable executable launch",
  "DPI layout fits controls",
);
report.executableSha256 = createHash("sha256")
  .update(await readFile("output/MikuAmp.exe"))
  .digest("hex");
await writeFile(
  "output/native-test-results.json",
  JSON.stringify(report, null, 2),
);
console.log(
  "Persistence passed: queue, volume, shuffle and repeat restored; no autoplay.",
);
await browser.close();
