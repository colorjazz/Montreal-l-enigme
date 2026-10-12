// Capture d'écran de contrôle : node tests/shot.mjs <url> <sortie.png> [script JS à évaluer]
import { chromium } from "playwright-core";
const [url, out, js] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__villeReady || window.__villeError, null, { timeout: 240000 });
console.log("chargé en", ((Date.now() - t0) / 1000).toFixed(1), "s");
if (js) {
  const r = await page.evaluate(js);
  if (r !== undefined) console.log("résultat:", JSON.stringify(r));
}
await page.waitForTimeout(500);
await page.screenshot({ path: out });
console.log(logs.slice(0, 40).join("\n"));
await browser.close();
