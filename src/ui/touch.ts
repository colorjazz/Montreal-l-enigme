import type { Game } from "../game";

/** Commandes tactiles : joystick à gauche, zone de regard à droite, boutons. */
export function installTouch(game: Game, ui: HTMLElement) {
  if (!game.input.isTouch) return;
  const root = document.createElement("div");
  root.className = "touch on";
  root.innerHTML = `<div class="lookpad"></div><div class="stick"><div class="knob"></div></div>
    <button class="tbtn" style="right:24px;bottom:110px" data-k="KeyE">E</button>
    <button class="tbtn" style="right:100px;bottom:40px" data-k="Space">⤒</button>
    <button class="tbtn" style="right:24px;bottom:30px" data-k="ShiftLeft">⇧</button>
    <button class="tbtn" style="left:24px;top:110px;width:52px;height:52px" data-k="KeyJ">J</button>`;
  ui.appendChild(root);
  const stick = root.querySelector(".stick") as HTMLElement;
  const knob = root.querySelector(".knob") as HTMLElement;
  let sid: number | null = null;
  stick.addEventListener("pointerdown", (e) => {
    sid = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    game.audio.start();
  });
  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId !== sid) return;
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
    game.input.touchMove.x = x;
    game.input.touchMove.y = -y;
  });
  const end = () => {
    sid = null;
    knob.style.transform = "";
    game.input.touchMove.x = 0;
    game.input.touchMove.y = 0;
  };
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);
  const pad = root.querySelector(".lookpad") as HTMLElement;
  let last: { x: number; y: number } | null = null;
  pad.addEventListener("pointerdown", (e) => {
    last = { x: e.clientX, y: e.clientY };
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener("pointermove", (e) => {
    if (!last) return;
    game.input.mouseDX += (e.clientX - last.x) * 1.4;
    game.input.mouseDY += (e.clientY - last.y) * 1.4;
    last = { x: e.clientX, y: e.clientY };
  });
  pad.addEventListener("pointerup", () => (last = null));
  root.querySelectorAll<HTMLButtonElement>(".tbtn").forEach((b) => {
    const k = b.dataset.k!;
    b.addEventListener("pointerdown", () => {
      if (k === "ShiftLeft") game.input.hold(k);
      else if (k === "KeyJ") window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));
      else game.input.tap(k);
    });
    b.addEventListener("pointerup", () => game.input.release(k));
  });
}
