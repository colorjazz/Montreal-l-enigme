// Plusieurs captures dans une seule session : node tests/shots.mjs <url> <dossier> <json des vues>
// vue : { name, cam:[x,y,z], at:[x,y,z], hour, js }
import { chromium } from "playwright-core";
import fs from "node:fs";
const [url, dir, viewsJson] = process.argv.slice(2);
const views = JSON.parse(fs.readFileSync(viewsJson, "utf8"));
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", (m) => { if (!m.text().includes("[vite]")) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__villeReady || window.__villeError, null, { timeout: 240000 });
for (const v of views) {
  const r = await page.evaluate((v) => {
    const g = window.__ville;
    if (v.hour !== undefined) g.setHour(v.hour);
    if (v.cam) g.setCamera(...v.cam, ...v.at);
    if (v.js) eval(v.js);
    g.render();
    return g.stats();
  }, v);
  await page.screenshot({ path: `${dir}/${v.name}.png` });
  console.log(v.name, JSON.stringify(r));
}
console.log(logs.slice(0, 30).join("\n"));
await browser.close();
