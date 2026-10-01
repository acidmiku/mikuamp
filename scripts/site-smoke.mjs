import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.SITE_URL || "http://127.0.0.1:4173/";
const dir = "output/site-review";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const errors = [],
  failures = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400)
      failures.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#iridescence")).toHaveAttribute(
    "data-renderer",
    /webgl|fallback/,
  );
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable motion", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `${dir}/desktop-hero.png` });
  await page.locator("#skins").scrollIntoViewIfNeeded();
  await expect(page.locator(".skin-theater")).toHaveClass(/visible/);
  for (const [name, id] of [
    ["Sakura", "sakura"],
    ["Midnight", "midnight"],
    ["Snow", "snow"],
    ["39.exe", "terminal"],
    ["Classic Teal", "classic"],
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".skin-theater")).toHaveAttribute(
      "data-skin",
      id,
    );
    await expect(page.locator(".skin-main")).toHaveAttribute(
      "src",
      `./assets/${id}-main.webp`,
    );
  }
  await page.screenshot({ path: `${dir}/desktop-skins.png` });
  await page.locator("#player").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/desktop-features.png` });
  await page.locator("#download").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/desktop-download.png` });
  expect(await page.locator(".download-link").count()).toBe(2);
  for (const link of await page.locator(".download-link").all())
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/acidmiku/mikuamp/releases/latest/download/MikuAmp-Setup.exe",
    );
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(2);
  await expect(page.locator(".other-platforms a")).toHaveCount(0);
  await page.evaluate(() =>
    document
      .querySelectorAll(".reveal")
      .forEach((n) => n.classList.add("visible")),
  );
  await page.screenshot({ path: `${dir}/desktop-full.png`, fullPage: true });
  const metrics = [];
  for (const width of [1920, 1280, 960, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(
      1,
    );
    const clipped = await page
      .locator(".skin-choice")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.scrollWidth > n.clientWidth + 1)
          .map((n) => n.textContent),
      );
    expect(clipped).toEqual([]);
    metrics.push({ width, overflow });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${dir}/mobile-hero.png` });
  await page.screenshot({ path: `${dir}/mobile-full.png`, fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Enable motion", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/motion-paused/);
  const brokenImages = await page
    .locator("img")
    .evaluateAll((images) =>
      images
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => i.src),
    );
  expect(brokenImages).toEqual([]);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  const renderer = await page
    .locator("#iridescence")
    .getAttribute("data-renderer");
  await writeFile(
    `${dir}/results.json`,
    JSON.stringify({ base, renderer, metrics, errors, failures }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      renderer,
      viewports: metrics.length,
      errors,
      failures,
    }),
  );
} finally {
  await browser.close();
}
