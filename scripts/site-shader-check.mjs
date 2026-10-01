import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
const dir = "output/site-review/shader";
await mkdir(dir, { recursive: true });
try {
  const metrics = [];
  for (const ratio of [1, 1.375, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: ratio,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(process.env.SITE_URL || "http://127.0.0.1:4174/");
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByRole("button", { name: "Pause motion", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      await page
        .locator(".shot-main")
        .evaluate((n) => getComputedStyle(n).animationName),
    ).toBe("float-main");
    await expect(page.locator("#iridescence")).toHaveAttribute(
      "data-renderer",
      "webgl",
    );
    const before = await page.locator("#iridescence").screenshot();
    await page.waitForTimeout(250);
    const after = await page.locator("#iridescence").screenshot();
    expect(before.equals(after)).toBe(false);
    await page
      .getByRole("button", { name: "Pause motion", exact: true })
      .click();
    // The pointer parallax settles for400ms after the toggle is clicked.
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${dir}/hero-${ratio}.png` });
    await page.screenshot({
      path: `${dir}/edge-${ratio}.png`,
      clip: { x: 575, y: 0, width: 650, height: 230 },
    });
    const paused = await page.locator("#iridescence").screenshot();
    await page.waitForTimeout(150);
    expect(paused.equals(await page.locator("#iridescence").screenshot())).toBe(
      true,
    );
    metrics.push(
      await page.evaluate(() => {
        const canvas = document.querySelector("#iridescence"),
          rect = canvas.getBoundingClientRect();
        return {
          devicePixelRatio,
          css: [rect.width, rect.height],
          buffer: [canvas.width, canvas.height],
        };
      }),
    );
    await context.close();
  }
  await writeFile(`${dir}/metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      motionDefault: "on",
      pauseVerified: true,
      metrics,
    }),
  );
} finally {
  await browser.close();
}
