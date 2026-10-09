import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("output/screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 500, height: 850 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:1420");
await page.waitForLoadState("networkidle");
await page.screenshot({
  path: "output/screenshots/player-empty.png",
  fullPage: true,
});
await page.getByRole("button", { name: /^Skins:/ }).click();
await page.screenshot({ path: "output/screenshots/skins.png", fullPage: true });
for (const skin of ["Sakura", "Midnight", "Snow", "39.exe"]) {
  await page
    .getByRole("button")
    .filter({ has: page.locator("strong", { hasText: skin }) })
    .click();
  await page.waitForTimeout(100);
}
await page.getByRole("button", { name: "Close skins" }).click();
await page.screenshot({
  path: "output/screenshots/dot-matrix.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Tone", exact: true }).click();
await page.getByRole("slider", { name: "Temperature", exact: true }).fill("35");
await page.screenshot({ path: "output/screenshots/tone.png", fullPage: true });
await page.getByRole("button", { name: "Library", exact: true }).click();
await page.screenshot({
  path: "output/screenshots/library-empty.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Close library" }).click();
await page.getByRole("button", { name: "Parametric", exact: true }).click();
await page.getByRole("button", { name: /^Band 5:/ }).click();
await page.getByRole("spinbutton", { name: "Band frequency" }).fill("1234");
await page.getByRole("spinbutton", { name: "Band frequency" }).press("Enter");
await page.getByRole("spinbutton", { name: "Band Q" }).fill("0.7");
await page.getByRole("spinbutton", { name: "Band Q" }).press("Enter");
if (
  (await page
    .getByRole("spinbutton", { name: "Band frequency" })
    .inputValue()) !== "1234"
)
  throw new Error("Frequency editing failed");
if (
  (await page.getByRole("spinbutton", { name: "Band Q" }).inputValue()) !==
  "0.7"
)
  throw new Error("Q editing failed");
await page.getByRole("button", { name: "Close equalizer" }).click();
if (await page.getByRole("button", { name: /^Band 1:/ }).count())
  throw new Error("EQ panel did not close");
await page.getByRole("button", { name: "EQ", exact: true }).click();
if (!(await page.getByRole("button", { name: /^Band 1:/ }).count()))
  throw new Error("EQ panel did not reopen");
await page.setViewportSize({ width: 1200, height: 960 });
await page.getByRole("button", { name: /^Skins:/ }).click();
await page.screenshot({
  path: "output/screenshots/skin-collection-wide.png",
  fullPage: true,
});
await page
  .locator('.skin-gallery input[type="file"]')
  .setInputFiles("output/skin-packs/classic.mikuamp.json");
await page.waitForTimeout(150);
if ((await page.locator(".skin-card").count()) !== 7)
  throw new Error("Portable skin import failed");
await page.reload();
await page.getByRole("button", { name: /^Skins:/ }).click();
if (
  (await page.locator(".skin-card.chosen strong").textContent()) !==
  "Classic Teal"
)
  throw new Error("Imported skin selection was not restored");
if (errors.length) throw new Error(errors.join("\n"));
console.log("UI smoke passed: skins, Tone, EQ toggles, library, screenshots.");
await browser.close();
