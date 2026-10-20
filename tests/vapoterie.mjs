// Vapoterie de la rue Saint-Denis : on entre par la porte, on parle au vendeur, il refuse de vendre aux moins de 18 ans.
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(BASE + "?test");
await page.waitForFunction(() => window.__villeReady, null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const v = window.__ville;
  const g = v.game;
  const L = g.landmarks.vapoterie;
  const inRoom = () => {
    const p = g.player.position;
    const poly = L.room;
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  };
  v.setHour(14);
  v.teleport(L.outside[0], 0.4, L.outside[1]);
  v.simulate(0.5);
  const avant = inRoom();
  v.face(L.inside[0], L.inside[1]);
  v.simulate(3, ["KeyW"]);
  const p = g.player.position;
  const res = { dehorsAvant: !avant, dedansApres: inRoom(), position: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], toast: document.querySelector(".hud-toasts")?.textContent?.includes("Daron") ?? null };
  // mur de côté : on ne traverse pas
  return res;
});
await page.evaluate(() => {
  const v = window.__ville;
  const g = v.game;
  const L = g.landmarks.vapoterie;
  const P = g.player.position;
  // caméra dans la salle, vers le comptoir
  v.setCamera(L.inside[0] + (L.inside[0] - L.vendor.x) * 1.4, 1.9, L.inside[1] + (L.inside[1] - L.vendor.z) * 1.4, L.vendor.x, 1.3, L.vendor.z);
  v.render();
  void P;
});
await page.screenshot({ path: "tests/artefacts/13-vapoterie-interieur.png" });
await page.evaluate(() => {
  const v = window.__ville;
  const L = v.game.landmarks.vapoterie;
  const dx = L.outside[0] - L.inside[0], dz = L.outside[1] - L.inside[1];
  const k = 6 / Math.hypot(dx, dz);
  v.setCamera(L.outside[0] + dx * k - dz * 0.5, 2.2, L.outside[1] + dz * k + dx * 0.5, L.outside[0], 2.2, L.outside[1]);
  v.render();
});
await page.screenshot({ path: "tests/artefacts/14-vapoterie-facade.png" });
out.dialogue = await page.evaluate(() => {
  const v = window.__ville;
  v.play();
  const steps = [];
  let d = v.talk("vendeur");
  steps.push(d.text);
  d = v.choose(0); // « J'ai 18 ans. »
  steps.push(d.text);
  d = v.choose(0); // carte oubliée
  steps.push(d.text);
  d = v.choose(0); // insiste
  steps.push(d.text);
  v.closeDialogue();
  const again = v.talk("vendeur").text;
  v.closeDialogue();
  return { steps, again };
});
out.refus = /pas de vente/i.test(out.dialogue.steps[2]) && /18 ans/.test(out.dialogue.steps[2]);
out.erreurs = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
