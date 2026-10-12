import * as THREE from "three";
import { buildFacadeArray, asphaltTexture, sidewalkTexture, grassTexture, paversTexture, gravelTexture, lotTexture } from "../core/textures";

/** Uniformes partagés par tous les matériaux sensibles à l'heure du jour. */
export const worldUniforms = {
  uNight: { value: 0 }, // 0 = jour, 1 = nuit noire
  uTime: { value: 0 },
  uWet: { value: 0 }, // chaussée mouillée (averses)
};

/**
 * Matériau unique de toutes les façades : un tableau de textures (une couche
 * par style) indexé par l'attribut aLayer ; l'alpha de la texture est le
 * masque du vitrage, qui s'illumine la nuit selon un hachage par fenêtre.
 */
export function createFacadeMaterial(): THREE.MeshStandardMaterial {
  const arr = buildFacadeArray();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.0,
    envMapIntensity: 0.7,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFacades = { value: arr };
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aLayer;
        attribute vec2 fuv;
        varying float vLayer;
        varying vec2 vFuv;`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        vLayer = aLayer;
        vFuv = fuv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uFacades;
        uniform float uNight;
        varying float vLayer;
        varying vec2 vFuv;
        float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        "#include <color_fragment>",
        `vec4 fTex = texture(uFacades, vec3(vFuv, floor(vLayer + 0.5)));
        float glass = fTex.a;
        vec2 cell = floor(vFuv);
        float h = fHash(cell);
        // le verre n'est pas teinté par la couleur du bâtiment
        vec3 tint = mix(vColor.rgb, vec3(1.0), glass);
        // stores et rideaux : variation par fenêtre
        float blind = step(0.72, h) * glass;
        vec3 glassVar = mix(vec3(1.0), vec3(1.35, 1.28, 1.15), blind);
        diffuseColor.rgb *= fTex.rgb * tint * mix(vec3(1.0), glassVar, glass);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = mix(roughness, 0.12, glass * (1.0 - blind));`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float isShop = step(11.5, vLayer) * step(vLayer, 14.5);
        float isBanq = step(8.5, vLayer) * step(vLayer, 9.5);
        float litProb = mix(0.42, 0.95, isShop);
        float lit = step(1.0 - litProb, fHash(cell + 17.31));
        vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(0.85, 0.9, 1.0), step(0.85, fHash(cell + 3.7)));
        warm = mix(warm, vec3(0.45, 1.0, 0.7), isBanq);
        float flick = 0.85 + 0.15 * fHash(cell + 9.1);
        vec3 shopLight = fTex.rgb * vec3(1.7, 1.45, 1.1) + vec3(0.12, 0.09, 0.05);
        totalEmissiveRadiance += glass * lit * uNight * flick * mix(warm * 0.9, shopLight, isShop);`,
      );
  };
  mat.customProgramCacheKey = () => "facade-v1";
  return mat;
}

export interface GroundMaterials {
  asphalt: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  pavers: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  lot: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  paintYellow: THREE.MeshStandardMaterial;
}

/** Chaussée : devient plus lisse et réfléchissante quand il pleut. */
function wettable(mat: THREE.MeshStandardMaterial, key: string): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = worldUniforms.uWet;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uWet;")
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.18, uWet);`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, 0.62, uWet);");
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export function createGroundMaterials(): GroundMaterials {
  const asphalt = asphaltTexture();
  const sidewalk = sidewalkTexture();
  const grass = grassTexture(true);
  const pavers = paversTexture();
  const gravel = gravelTexture();
  const lot = lotTexture();
  return {
    asphalt: wettable(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, envMapIntensity: 0.9 }), "wet-asphalt"),
    sidewalk: wettable(new THREE.MeshStandardMaterial({ map: sidewalk, roughness: 0.9 }), "wet-sidewalk"),
    grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
    pavers: wettable(new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.85 }), "wet-pavers"),
    gravel: new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 }),
    lot: wettable(new THREE.MeshStandardMaterial({ map: lot, roughness: 0.95 }), "wet-lot"),
    curb: new THREE.MeshStandardMaterial({ color: 0x9d9a93, roughness: 0.85 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    paintYellow: new THREE.MeshStandardMaterial({ color: 0xe8b923, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
}
