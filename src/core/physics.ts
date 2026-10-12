import RAPIER from "@dimforge/rapier3d-compat";

/** Monde physique Rapier (pas fixe de 1/60 s, accumulateur). */
export class Physics {
  readonly RAPIER = RAPIER;
  world!: RAPIER.World;
  fixedBody!: RAPIER.RigidBody;
  readonly step = 1 / 60;
  private acc = 0;
  stepsTaken = 0;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.step;
    this.fixedBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  /** Avance la simulation ; retourne le nombre de sous-pas effectués. */
  update(dt: number, beforeStep?: (h: number) => void, afterStep?: () => void): number {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= this.step && n < 4) {
      beforeStep?.(this.step);
      this.world.step();
      afterStep?.();
      this.acc -= this.step;
      n++;
    }
    if (n === 4) this.acc = 0;
    this.stepsTaken += n;
    return n;
  }

  /** Fraction restante pour l'interpolation visuelle. */
  get alpha() {
    return this.acc / this.step;
  }

  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, exclude?: RAPIER.Collider, predicate?: (c: RAPIER.Collider) => boolean): { toi: number; collider: RAPIER.Collider } | null {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, exclude, undefined, predicate);
    return hit ? { toi: hit.timeOfImpact, collider: hit.collider } : null;
  }
}
