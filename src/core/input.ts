/** Clavier, souris (verrouillage du pointeur) et manette tactile simple. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Faux = l'interface (dialogue, menu) capte les entrées. */
  enabled = true;
  private dragging = false;
  /** Joystick tactile : vecteur (-1..1). */
  touchMove = { x: 0, y: 0 };
  touchLook = { x: 0, y: 0 };
  readonly isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  /** Touches simulées (tests automatisés). */
  private virtual = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0 || e.button === 2) this.dragging = true;
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    window.addEventListener("mousemove", (e) => {
      if (this.locked || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  requestLock() {
    if (this.isTouch || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* navigateur sans verrouillage */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) {
    return this.enabled && (this.down.has(code) || this.virtual.has(code));
  }

  /** Vrai une seule fois par appui. */
  wasPressed(code: string) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return this.enabled || code === "Escape";
    }
    return false;
  }

  /** Appui « hors jeu » (fonctionne même quand l'interface capte). */
  consume(code: string) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pressed.clear();
  }

  // ---- tests automatisés
  hold(code: string) {
    this.virtual.add(code);
  }
  release(code: string) {
    this.virtual.delete(code);
  }
  tap(code: string) {
    this.pressed.add(code);
  }

  /** Axes de déplacement (x = droite, y = avant). */
  moveAxes(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown("KeyW") || this.isDown("ArrowUp")) y += 1;
    if (this.isDown("KeyS") || this.isDown("ArrowDown")) y -= 1;
    if (this.isDown("KeyD") || this.isDown("ArrowRight")) x += 1;
    if (this.isDown("KeyA") || this.isDown("ArrowLeft")) x -= 1;
    if (this.enabled) {
      x += this.touchMove.x;
      y += this.touchMove.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }
}
