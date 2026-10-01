import { chromium } from "@playwright/test";
import sharp from "sharp";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:4173/");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await page.addStyleTag({
    content:
      ".hero{height:630px;min-height:630px}.hero-copy{top:128px;left:50px}.hero h1{font-size:122px}.hero-copy>p{font-size:18px;margin:8px 0 22px}.hero-player{top:108px;left:638px;transform:scale(.74);transform-origin:top left}.hero-bottom{display:none}.site-header{height:82px}.site-header nav{display:none}.hero-copy .button{min-height:50px;font-size:12px}",
  });
  await page.waitForTimeout(300);
  await sharp(await page.screenshot())
    .jpeg({ quality: 92 })
    .toFile("site/public/assets/social.jpg");
  console.log("Created1200x630 social preview from the rendered landing page.");
} finally {
  await browser.close();
}
