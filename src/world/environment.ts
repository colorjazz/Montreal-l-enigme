import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { worldUniforms } from "./materials";

/**
 * Ciel physique, soleil (ombres qui suivent le joueur), lune, étoiles,
 * brouillard et horloge du jeu. L'axe nord-sud de la grille montréalaise
 * est tourné d'environ 55° par rapport au nord vrai : le soleil de midi
 * vient donc du « sud-ouest » de la grille.
 */
export class Environment {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  readonly hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5a5048, 1.1);
  readonly moonLight = new THREE.DirectionalLight(0x8fa8ff, 0.0);
  readonly stars: THREE.Points;
  readonly nightDome: THREE.Mesh;
  readonly moon: THREE.Mesh;
  readonly sunDir = new THREE.Vector3();
  /** Heure du jeu en heures décimales (0–24). */
  hours = 10.5;
  /** Minutes de jeu par seconde réelle. */
  timeScale = 1;
  day = 0;
  readonly fog: THREE.Fog;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private lastEnvHours = -10;
  night = 0;
  overcast = 0; // 0 = dégagé, 1 = couvert (pluie)

  constructor(
    private scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    this.sky.scale.setScalar(4000);
    this.sky.name = "ciel";
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi, this.moonLight, this.moonLight.target);

    this.fog = new THREE.Fog(0xc9d6e2, 160, 1500);
    scene.fog = this.fog;

    // étoiles
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 1600; i++) {
      const u1 = Math.random();
      const v1 = Math.random() * 0.9 + 0.1;
      const th = u1 * Math.PI * 2;
      const ph = Math.acos(1 - v1);
      pts.push(Math.sin(ph) * Math.cos(th) * 1800, Math.cos(ph) * 1800, Math.sin(ph) * Math.sin(th) * 1800);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.name = "étoiles";
    scene.add(this.stars);

    // voûte nocturne : ciel urbain teinté par la pollution lumineuse
    this.nightDome = new THREE.Mesh(
      new THREE.SphereGeometry(1900, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uOvercast: { value: 0 } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uOpacity; uniform float uOvercast; varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y, 0.0, 1.0);
            vec3 zenith = vec3(0.025, 0.035, 0.08);
            vec3 horizon = mix(vec3(0.20, 0.15, 0.17), vec3(0.24, 0.2, 0.2), uOvercast);
            vec3 c = mix(horizon, zenith, pow(h, 0.45));
            gl_FragColor = vec4(c, uOpacity);
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.nightDome.renderOrder = -1;
    this.nightDome.name = "voûte nocturne";
    scene.add(this.nightDome);
    this.stars.renderOrder = 0;
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(28, 32), new THREE.MeshBasicMaterial({ color: 0xf3f0e2, fog: false, transparent: true, opacity: 0 }));
    this.moon.name = "lune";
    scene.add(this.moon);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
  }

  /** Avance l'horloge et met à jour soleil, ciel, brouillard. */
  update(dt: number, focus: THREE.Vector3) {
    this.hours += (dt * this.timeScale) / 60;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
    this.apply(focus);
  }

  apply(focus: THREE.Vector3) {
    // course du soleil à 45,5° N, mi-octobre : lever ~6 h 54 (azimut ~105°),
    // coucher ~18 h 18 (~255°), hauteur max ~36°.
    const t = (this.hours - 6.9) / (18.3 - 6.9);
    const elev = Math.sin(Math.PI * t) * THREE.MathUtils.degToRad(36.5);
    const bearing = 105 + 150 * THREE.MathUtils.clamp(t, -0.2, 1.2);
    // Le « nord » de la grille montréalaise (-Z) pointe vers le relèvement vrai 303°.
    const a = THREE.MathUtils.degToRad(bearing - 303);
    const elevC = Math.max(elev, -0.35);
    this.sunDir.set(Math.sin(a) * Math.cos(elevC), Math.sin(elevC), -Math.cos(a) * Math.cos(elevC)).normalize();
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);

    const dayF = THREE.MathUtils.smoothstep(this.sunDir.y, -0.12, 0.12);
    this.night = 1 - dayF;
    worldUniforms.uNight.value = THREE.MathUtils.smoothstep(this.night, 0.35, 0.95);

    const sunElev = Math.max(0, this.sunDir.y);
    const warm = 1 - THREE.MathUtils.smoothstep(sunElev, 0.02, 0.35);
    this.sun.color.setRGB(1, 0.94 - warm * 0.35, 0.86 - warm * 0.55);
    this.sun.intensity = 2.7 * dayF * (1 - this.overcast * 0.75);
    this.hemi.intensity = 0.35 + 0.75 * dayF * (1 - this.overcast * 0.2);
    this.hemi.color.setRGB(0.75 + 0.1 * dayF, 0.82 + 0.05 * dayF, 1.0);
    this.hemi.groundColor.setRGB(0.35, 0.31, 0.28);
    if (this.night > 0.5) {
      this.hemi.color.setRGB(0.32, 0.38, 0.6);
      this.hemi.groundColor.setRGB(0.12, 0.1, 0.1);
      this.hemi.intensity = 0.55;
    }
    this.moonLight.intensity = 0.35 * this.night;
    this.moonLight.position.set(focus.x - 80, focus.y + 120, focus.z + 60);
    this.moonLight.target.position.copy(focus);

    // ombres centrées sur le joueur
    const d = 160;
    this.sun.position.set(focus.x + this.sunDir.x * d, focus.y + Math.max(this.sunDir.y, 0.15) * d, focus.z + this.sunDir.z * d);
    this.sun.target.position.copy(focus);
    // alignement sur la grille des texels pour éviter le scintillement
    this.sun.target.updateMatrixWorld();

    // brouillard assorti au ciel
    const day = new THREE.Color(0xb7c8da);
    const dusk = new THREE.Color(0xd9a77f);
    const nightC = new THREE.Color(0x0d1424);
    const fogC = day.clone().lerp(dusk, warm * dayF).lerp(nightC, this.night);
    fogC.lerp(new THREE.Color(0x8e959c), this.overcast * dayF * 0.7);
    this.fog.color.copy(fogC);
    this.fog.near = 160 - this.overcast * 110;
    this.fog.far = 1500 - this.overcast * 1000;
    u.turbidity.value = 6 + this.overcast * 14;
    u.rayleigh.value = 1.6 - this.overcast * 1.2;

    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(this.night, 0.6, 1) * (1 - this.overcast);
    this.stars.position.copy(focus);
    const domeMat = this.nightDome.material as THREE.ShaderMaterial;
    domeMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(this.night, 0.15, 0.85);
    domeMat.uniforms.uOvercast.value = this.overcast;
    this.nightDome.position.copy(focus);
    // lune à l'opposé du soleil, haute dans le ciel la nuit
    const md = new THREE.Vector3(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.8 + 0.25, -this.sunDir.z).normalize();
    this.moon.position.copy(focus).addScaledVector(md, 1700);
    this.moon.lookAt(focus);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.smoothstep(this.night, 0.5, 0.9) * (1 - this.overcast);
    this.sky.position.copy(focus);

    // carte d'environnement (reflets des vitres) régénérée par paliers
    if (Math.abs(this.hours - this.lastEnvHours) > 0.5) this.refreshEnv();
  }

  refreshEnv() {
    this.lastEnvHours = this.hours;
    const u = this.envSky.material.uniforms;
    const src = this.sky.material.uniforms;
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) u[k].value = src[k].value;
    u.sunPosition.value.copy(this.sunDir);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.012 + 0.05 * (1 - this.night);
    old?.dispose();
  }

  /** « 14 h 05 » */
  clockText(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${h} h ${String(m).padStart(2, "0")}`;
  }

  get isNight() {
    return this.night > 0.6;
  }
}
