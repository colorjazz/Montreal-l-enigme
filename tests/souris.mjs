// Vérifie que la souris reprend le contrôle de la caméra après la pause (Échap) et après l'écran de fin.
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL || "http://localhost:4181/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForFunction(() => window.__villeReady, null, { timeout: 120000 });
const locked = () => page.evaluate(() => !!document.pointerLockElement);
const state = () =>
  page.evaluate(() => ({
    verrou: !!document.pointerLockElement,
    pause: !!document.querySelector('.screen[data-id="pause"].show'),
    fin: !!document.querySelector('.screen[data-id="fin"].show'),
    indice: !document.querySelector(".lock-hint").hidden,
  }));
const yaw = () => page.evaluate(() => window.__ville.game.player.camYaw);
const out = {};
await page.click("[data-go]");
await page.waitForTimeout(400);
out.apresIntro = await state();
// 1) Échap quand le pointeur est verrouillé : le navigateur libère le pointeur → pause
await page.evaluate(() => document.exitPointerLock()); // ce que fait Chrome sur Échap
await page.waitForTimeout(300);
out.apresEchap = await state();
await page.waitForTimeout(1200); // délai de Chrome avant un nouveau verrouillage
await page.click("[data-resume]");
await page.waitForTimeout(400);
out.apresReprendre = await state();
// la caméra suit la souris
const y0 = await yaw();
await page.mouse.move(640, 360);
for (let i = 0; i < 10; i++) await page.mouse.move(640 + i * 30, 360);
await page.waitForTimeout(300);
out.cameraTourne = Math.abs((await yaw()) - y0) > 0.01;
// 2) Échap transmis comme touche (pointeur déjà libre) : ouvre puis ferme la pause
await page.evaluate(() => document.exitPointerLock());
await page.waitForTimeout(300);
await page.waitForTimeout(1200);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
out.escFermePause = await state();
// 3) Écran de fin pendant un dialogue : il attend la fin de la conversation
await page.evaluate(() => {
  window.__ville.talk("gagnon");
});
await page.waitForTimeout(200);
await page.evaluate(() => window.__ville.game.onMainQuestDone());
await page.waitForTimeout(600);
out.finPendantDialogue = await state();
await page.evaluate(() => window.__ville.closeDialogue());
await page.waitForTimeout(900);
out.finApresDialogue = await state();
await page.waitForTimeout(1200);
await page.click('.screen[data-id="fin"] [data-close]');
await page.waitForTimeout(400);
out.apresContinuer = await state();
out.erreurs = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
