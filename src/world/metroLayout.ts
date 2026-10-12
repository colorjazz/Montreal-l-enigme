import { SIDEWALK_Y } from "./city";

/**
 * Plan de la station Berri-UQAM (souterraine), en mètres dans le repère du
 * monde. L'escalier part de l'édicule de la rue Berri (trémie découpée dans
 * le parvis par tools/generate_city.py), mène à la mezzanine (guichet,
 * distributeur, tourniquets), puis au quai de la ligne verte.
 */
export const METRO = {
  stairs1: { xTop: -16, xBottom: -26, z0: 26, z1: 30, yTop: SIDEWALK_Y, yBottom: -6 },
  mezz: { x0: -58, x1: -26, z0: 20, z1: 40, y: -6, h: 4.2 },
  booth: [-37, 37] as [number, number],
  machine: [-29.2, 38.9] as [number, number],
  turnstileX: -44,
  stairs2: { x0: -54, x1: -49.5, zTop: 20, zBottom: 6, yTop: -6, yBottom: -12 },
  platform: { x0: -130, x1: -22, z0: -2, z1: 6, y: -12, h: 5.5 },
  track: { z: -5.6, y: -13.3, x0: -260, x1: 110 },
} as const;
