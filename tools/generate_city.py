"""Génère src/data/city.json à partir de la carte Google Maps fournie
(tools/carte-berri-uqam.webp).

Étapes :
  1. Les axes des rues ont été relevés sur la carte par transformée de Hough
     (angle de la normale + distance rho, en pixels de l'image).
  2. Les empreintes des bâtiments sont vectorisées à partir des couleurs de
     la carte (beige / gris), puis converties en mètres.
  3. Les façades manquantes le long des rues commerçantes sont complétées
     par des lots en rangée (bâtiments mitoyens typiques du Quartier latin),
     et une ceinture de ville « de remplissage » prolonge la grille au-delà
     de la zone jouable.

Repère du monde : X = « est » montréalais (le long de Sainte-Catherine),
Z = « sud » montréalais (le long de Berri), origine au coin Berri /
De Maisonneuve (station Berri-UQAM). Unités : mètres.

Usage : python tools/generate_city.py   (requiert numpy, opencv-python-headless,
shapely, pillow)
"""
import json
import math
import os
import random

import cv2
import numpy as np
from PIL import Image
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "data", "city.json")
IMG = os.path.join(HERE, "carte-berri-uqam.webp")

SCALE = 0.95  # mètres par pixel de la carte
rng = random.Random(514)


# ---------------------------------------------------------------- repère
def line_from_normal(theta_deg, rho):
    t = math.radians(theta_deg)
    return math.cos(t), math.sin(t), rho


def intersect_lines(l1, l2):
    a1, b1, c1 = l1
    a2, b2, c2 = l2
    det = a1 * b2 - a2 * b1
    return np.array([(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det])


ORIGIN = intersect_lines(line_from_normal(123, -241), line_from_normal(32.5, 709))
EAST_ANG = math.radians(-57.25)
EAST = np.array([math.cos(EAST_ANG), math.sin(EAST_ANG)])
SOUTH = np.array([-EAST[1], EAST[0]])  # +90°


def to_world(p):
    d = np.asarray(p, float) - ORIGIN
    return (float(d @ EAST) * SCALE, float(d @ SOUTH) * SCALE)


def to_world_poly(pts):
    return [to_world(p) for p in pts]


IMG_W, IMG_H = 1265, 525
DATA_REGION = Polygon(to_world_poly([(0, 0), (IMG_W, 0), (IMG_W, IMG_H), (0, IMG_H)]))
WALKABLE = DATA_REGION.buffer(-6, join_style=2)
minx, minz, maxx, maxz = DATA_REGION.bounds
OUTER = box(minx - 170, minz - 170, maxx + 170, maxz + 170)

# ---------------------------------------------------------------- rues
# (id, nom affiché, angle normale, rho, extrémité A, extrémité B, largeur
#  chaussée, trottoir, sens, catégorie)
# sens : 2 = double sens, 1 = sens unique dans la direction A→B, -1 = B→A
# extrémités : 'edge' (bord du monde) ou id de la rue transversale.
STREETS = [
    # --- rues « nord-sud » (normale 123°) ; A = côté nord
    ("bullion", "Rue De Bullion", 123, 277, "edge", "edge", 9, 3.0, -1, "minor"),
    ("hdv", "Avenue de l'Hôtel-de-Ville", 123, 197, "edge", "edge", 9, 3.0, 1, "minor"),
    ("sanguinet", "Rue Sanguinet", 123, 37, "edge", "edge", 10, 3.5, -1, "medium"),
    ("stdenis", "Rue Saint-Denis", 123, -107, "edge", "edge", 15, 4.5, 2, "major"),
    ("savoie", "Avenue Savoie", 123, -167, "ontario", "maisonneuve", 7.5, 3.0, 1, "minor"),
    ("berri", "Rue Berri", 123, -241, "edge", "edge", 15, 4.5, 2, "major"),
    ("labelle", "Rue Labelle", 123, -296, "stecath", "edge", 9, 3.0, 1, "minor"),
    ("sthubert", "Rue Saint-Hubert", 123, -365, "edge", "edge", 11, 4.0, -1, "medium"),
    ("stchristophe_n", "Rue Saint-Christophe", 123, -436, "edge", "maisonneuve", 8, 3.0, 1, "minor"),
    ("stchristophe_s", "Rue Saint-Christophe", 123, -436, "stecath", "rene", 8, 3.0, 1, "minor"),
    ("standre", "Rue Saint-André", 123, -503, "edge", "rene", 9, 3.0, -1, "minor"),
    ("sttimothee", "Rue Saint-Timothée", 123, -600, "edge", "edge", 9, 3.0, 1, "minor"),
    ("bernadette", "Rue Bernadette", 123, -207, "rene", "edge", 7, 2.5, 1, "minor"),
    ("joly", "Avenue Joly", 123, -34, "edge", "ontario_s", 6, 2.5, 2, "minor"),
    # --- rues « est-ouest » ; A = côté ouest
    ("nord", "", 17, 137, "edge", "edge", 13, 4.0, 2, "medium"),
    ("ontario", "Rue Ontario Est", 13, 368, "edge", "edge", 13, 4.0, 2, "major"),
    ("emery", "Rue Émery", 32.5, 564, "hdv", "stdenis", 8, 3.0, 1, "minor"),
    ("maisonneuve", "Boulevard De Maisonneuve Est", 32.5, 709, "edge", "edge", 15, 4.5, 2, "major"),
    ("stecath", "Rue Sainte-Catherine Est", 32.5, 862, "edge", "edge", 12, 5.0, 1, "major"),
    ("christin", "Rue Christin", 32.5, 1030, "edge", "stdenis", 7, 2.5, 1, "minor"),
    ("rene", "Boulevard René-Lévesque Est", 32.5, 1104, "edge", "edge", 30, 4.5, 2, "major"),
    ("gauchetiere", "Rue De La Gauchetière Est", 32.5, 1235, "edge", "edge", 9, 3.0, -1, "minor"),
]
SPEC = {s[0]: s for s in STREETS}
# Avenue Joly s'arrête juste après Ontario.
LINES = {s[0]: line_from_normal(s[2], s[3]) for s in STREETS}
LINES["ontario_s"] = (LINES["ontario"][0], LINES["ontario"][1], LINES["ontario"][2] + 40)


def img_dir(theta):
    t = math.radians(theta)
    return np.array([-math.sin(t), math.cos(t)])


def street_world_segment(s):
    sid, name, theta, rho, ea, eb, w, sw, oneway, cat = s
    a, b, c = LINES[sid]
    p0 = np.array([a * c, b * c])  # point du pied de la normale
    d = img_dir(theta)
    # oriente A vers le nord (rues N-S) ou l'ouest (rues E-O)
    wd = np.array(to_world(p0 + d)) - np.array(to_world(p0))
    if theta > 90:  # N-S : A doit avoir le plus petit Z
        if wd[1] < 0:
            d = -d
    else:  # E-O : A doit avoir le plus petit X
        if wd[0] < 0:
            d = -d

    def end(spec, sign):
        if spec == "edge":
            return p0 + d * sign * 4000
        q = intersect_lines(LINES[sid], LINES[spec])
        cross_w = SPEC[spec][6] if spec in SPEC else 0
        return q + d * sign * (cross_w / 2 + 0.5) / SCALE

    A = to_world(end(ea, -1))
    B = to_world(end(eb, +1))
    seg = LineString([A, B]).intersection(OUTER)
    (x0, z0), (x1, z1) = seg.coords[0], seg.coords[-1]
    return [x0, z0], [x1, z1]


streets_out = []
road_polys = []
for s in STREETS:
    A, B = street_world_segment(s)
    sid, name, theta, rho, ea, eb, w, sw, oneway, cat = s
    line = LineString([A, B])
    poly = line.buffer(w / 2, cap_style=2, join_style=2)
    road_polys.append(poly)
    streets_out.append(
        dict(id=sid, name=name, a=A, b=B, w=w, sw=sw, oneway=oneway, cat=cat)
    )

ROADS = unary_union(road_polys)

# Terre-plein central de René-Lévesque (interrompu aux carrefours)
rene = next(s for s in streets_out if s["id"] == "rene")
median = LineString([rene["a"], rene["b"]]).buffer(2.0, cap_style=2)
cuts = []
for s in streets_out:
    if s["id"] == "rene":
        continue
    l2 = LineString([s["a"], s["b"]])
    if l2.intersects(LineString([rene["a"], rene["b"]])):
        cuts.append(l2.buffer(s["w"] / 2 + 7, cap_style=2))
MEDIAN = median.difference(unary_union(cuts)) if cuts else median
ROADS = ROADS.difference(MEDIAN)

LAND = OUTER.difference(ROADS)
# Trémie de l'escalier de l'édicule Berri-UQAM (coordonnées du monde, en mètres)
METRO_OPENING = box(-26.0, 26.0, -16.0, 30.0)
LAND = LAND.difference(METRO_OPENING)

# Trottoirs : bande le long des chaussées, largeur propre à chaque rue
sw_bands = []
for s, poly in zip(streets_out, road_polys):
    sw_bands.append(poly.buffer(s["sw"], cap_style=2, join_style=2))
SIDEWALK_ZONE = unary_union(sw_bands)
SIDEWALKS = LAND.intersection(SIDEWALK_ZONE).difference(MEDIAN)
INTERIOR = LAND.difference(SIDEWALK_ZONE).difference(MEDIAN)


def polys_of(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


# ---------------------------------------------------------------- parcs
PARKS_IMG = {
    "emilie": ("Place Émilie-Gamelin", [(794, 85), (737, 179), (848, 255), (909, 161)]),
    "pasteur": ("Place Pasteur", [(685, 328), (670, 351), (718, 383), (736, 360)]),
    "savoie": ("", [(385, -40), (375, 38), (436, 78), (469, 22), (470, -40)]),
    "sud1": ("", [(298, 509), (312, 540), (388, 540), (319, 480)]),
    "sud2": ("", [(394, 540), (462, 540), (417, 495)]),
}
parks_out = []
park_geoms = []
for pid, (pname, pts) in PARKS_IMG.items():
    g = Polygon(to_world_poly(pts)).buffer(0).intersection(INTERIOR.union(SIDEWALKS))
    # le parc s'étend jusqu'au trottoir (pas au-delà)
    g = g.difference(SIDEWALK_ZONE).buffer(0)
    for p in polys_of(g):
        if p.area < 60:
            continue
        p = p.simplify(0.5)
        parks_out.append(dict(id=pid, name=pname, poly=p))
        park_geoms.append(p)
PARKS = unary_union(park_geoms) if park_geoms else Polygon()

# ---------------------------------------------------------------- bâtiments
img = np.array(Image.open(IMG).convert("RGB")).astype(int)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
road_m = (abs(r - 198) < 16) & (abs(g - 212) < 14) & (abs(b - 226) < 14)
park_m = (g - r > 25) & (g > 220)
beige = (r >= 246) & (g >= 243) & (b <= 243) & (r - b >= 6)
gray = (abs(r - g) < 8) & (abs(g - b) < 8) & (r >= 200) & (r <= 238)
bm = (beige | gray).astype(np.uint8)
bm[road_m | park_m] = 0
bm = cv2.morphologyEx(bm, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
cnts, _ = cv2.findContours(bm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

# Emprises réservées (pas de bâtiment extrait ni de remplissage)
RESERVED_IMG = {
    # parvis de l'édicule Berri-UQAM (coin Berri / De Maisonneuve)
    "parvis_metro": [(712, 190), (742, 172), (775, 196), (760, 222), (735, 230)],
    # parvis du clocher Saint-Jacques (Saint-Denis / Sainte-Catherine)
    "parvis_clocher": [(790, 380), (800, 360), (830, 372), (818, 395)],
}
reserved = unary_union([Polygon(to_world_poly(p)) for p in RESERVED_IMG.values()])
BUILDABLE = INTERIOR.intersection(DATA_REGION).difference(PARKS.buffer(1.5)).difference(reserved)

LANDMARKS_IMG = {
    # id : (point de la carte, nom, étages, style, nom affiché sur la façade)
    "banq": ((605, 160), "Grande Bibliothèque (BAnQ)", 6, "banq", "GRANDE BIBLIOTHÈQUE"),
    "gare": ((700, 112), "Gare d'autocars de Montréal", 3, "concrete", "GARE D'AUTOCARS DE MONTRÉAL"),
    "judith": ((760, 268), "Pavillon Judith-Jasmin (UQAM)", 5, "uqam", "UQAM · PAVILLON JUDITH-JASMIN"),
    "hubert": ((930, 400), "Pavillon Hubert-Aquin (UQAM)", 7, "uqam", "UQAM · PAVILLON HUBERT-AQUIN"),
    "berri1259": ((935, 282), "1259, rue Berri", 6, "brick_brown", "1259 BERRI"),
    "dupuis": ((870, 60), "Place Dupuis", 6, "dupuis", "PLACE DUPUIS"),
    "theatre": ((548, 262), "Espace St-Denis (Théâtre St-Denis)", 4, "theatre", "THÉÂTRE ST-DENIS"),
    "cegep": ((222, 285), "Cégep du Vieux Montréal", 7, "concrete", "CÉGEP DU VIEUX MONTRÉAL"),
    "mhotel": ((1100, 85), "M Montréal", 9, "modern", "M MONTRÉAL"),
    "stereo": ((1000, 95), "Stereo", 3, "painted", "STEREO"),
    "mcdo": ((1060, 515), "McDonald's", 2, "modern", ""),
    "boxotel": ((250, 412), "Boxotel", 5, "modern", "BOXOTEL"),
    "ideal": ((185, 470), "L'idéal bar & contenus", 3, "brick_red", "L'IDÉAL"),
}
landmark_pts = {k: Point(to_world(v[0])) for k, v in LANDMARKS_IMG.items()}

buildings = []


def round2(v):
    return round(float(v), 2)


def poly_out(p):
    p = p.simplify(0.4, preserve_topology=True)
    p = Polygon(p.exterior)  # pas de cours intérieures (simplification)
    if not p.exterior.is_ccw:
        p = Polygon(list(p.exterior.coords)[::-1])
    return [[round2(x), round2(z)] for x, z in p.exterior.coords[:-1]]


extracted = []
for c in cnts:
    if cv2.contourArea(c) < 40:
        continue
    ap = cv2.approxPolyDP(c, 1.6, True).reshape(-1, 2)
    if len(ap) < 3:
        continue
    pw = Polygon(to_world_poly(ap)).buffer(0)
    pw = pw.intersection(BUILDABLE)
    for p in polys_of(pw):
        if p.area < 28:
            continue
        # élimine les lanières trop minces (artefacts de libellés)
        if p.buffer(-1.6).is_empty:
            continue
        extracted.append(p)

STYLES_SMALL = ["brick_red", "brick_red", "greystone", "greystone", "painted", "brick_brown", "brick_cream"]
STYLES_LARGE = ["concrete", "brick_brown", "modern", "brick_red", "greystone", "glass"]


def classify(p, filler=False):
    a = p.area
    if a < 160:
        fl = rng.choice([2, 2, 3, 3, 3])
        st = rng.choice(STYLES_SMALL)
    elif a < 600:
        fl = rng.choice([3, 3, 4, 4, 5])
        st = rng.choice(STYLES_SMALL + ["brick_brown"])
    elif a < 2000:
        fl = rng.choice([4, 5, 6, 7])
        st = rng.choice(STYLES_LARGE)
    else:
        fl = rng.choice([5, 6, 8, 10])
        st = rng.choice(STYLES_LARGE)
    if filler:
        fl = min(fl, rng.choice([2, 3, 3, 4, 4, 5, 6]))
    return fl, st


used = []
for p in extracted:
    lm = None
    for k, pt in landmark_pts.items():
        if p.buffer(4).contains(pt):
            lm = k
            break
    if lm:
        _, lname, fl, st, sign = LANDMARKS_IMG[lm]
        # une partie seulement si plusieurs polygones touchent le repère
        if any(b.get("landmark") == lm for b in buildings):
            fl2, st2 = max(2, fl - 2), st
            buildings.append(dict(poly=poly_out(p), floors=fl2, style=st2, landmark=lm + "_annexe"))
        else:
            buildings.append(dict(poly=poly_out(p), floors=fl, style=st, landmark=lm, name=lname, sign=sign))
    else:
        fl, st = classify(p)
        buildings.append(dict(poly=poly_out(p), floors=fl, style=st))
    used.append(p)

USED = unary_union(used) if used else Polygon()

# ---------------------------------------------------------------- remplissage des façades
COMMERCIAL = {"stdenis": 0.95, "stecath": 0.95, "ontario": 0.85, "berri": 0.55, "sthubert": 0.8,
              "maisonneuve": 0.5, "sanguinet": 0.6, "emery": 0.7, "labelle": 0.7, "christin": 0.6,
              "savoie": 0.7, "hdv": 0.6, "bullion": 0.6, "standre": 0.7, "stchristophe_n": 0.7,
              "stchristophe_s": 0.7, "sttimothee": 0.7, "bernadette": 0.7, "rene": 0.4,
              "gauchetiere": 0.7, "nord": 0.6, "joly": 0.5}


def frontage(region_free, streets, prob_map, depth_rng, width_rng, tag, in_data):
    """Lots en rangée le long des rues, découpés dans region_free."""
    out = []
    parts = [q for q in polys_of(region_free) if q.area > 20]
    tree = STRtree(parts)
    placed, placed_cells = [], {}

    def cells(g):
        x0, y0, x1, y1 = g.bounds
        for i in range(int(x0 // 25), int(x1 // 25) + 1):
            for j in range(int(y0 // 25), int(y1 // 25) + 1):
                yield (i, j)

    for s in streets:
        A, B = np.array(s["a"]), np.array(s["b"])
        L = np.linalg.norm(B - A)
        d = (B - A) / L
        n = np.array([-d[1], d[0]])
        off = s["w"] / 2 + s["sw"] + 0.05
        prob = prob_map.get(s["id"], 0.6) if in_data else 1.0
        for side in (1, -1):
            t = 0.0
            while t < L:
                lw = rng.uniform(*width_rng)
                depth = rng.uniform(*depth_rng)
                # alterne des séquences de lots et des trouées (stationnements)
                if in_data and rng.random() > prob:
                    t += lw
                    continue
                p0 = A + d * t + n * side * off
                p1 = A + d * (t + lw) + n * side * off
                p2 = p1 + n * side * depth
                p3 = p0 + n * side * depth
                rect = Polygon([p0, p1, p2, p3]).buffer(0)
                t += lw
                idx = tree.query(rect)
                if len(idx) == 0:
                    continue
                lot = unary_union([rect.intersection(parts[i]) for i in idx])
                near = {k for c in cells(rect) for k in placed_cells.get(c, [])}
                if near:
                    lot = lot.difference(unary_union([placed[k] for k in near]).buffer(0.02))
                best = max(polys_of(lot), key=lambda q: q.area, default=None)
                if best is not None and best.area > 0.62 * rect.area and best.area > 30:
                    k = len(placed)
                    placed.append(best)
                    for c in cells(best):
                        placed_cells.setdefault(c, []).append(k)
                    out.append(best)
    return out, None


# Pas de rangées ajoutées dans les îlots des grands repères (UQAM, BAnQ, gare...)
NOFILL = []
for lm in ("judith", "hubert", "banq", "gare", "dupuis", "cegep"):
    pt = landmark_pts[lm]
    for part in polys_of(INTERIOR):
        if part.buffer(6).contains(pt):
            NOFILL.append(part.buffer(1))
NOFILL = unary_union(NOFILL) if NOFILL else Polygon()
FREE_DATA = BUILDABLE.difference(USED.buffer(0.8)).difference(NOFILL)
data_streets = [s for s in streets_out]
row_lots, FREE_DATA = frontage(FREE_DATA, data_streets, COMMERCIAL, (11, 17), (6.5, 12.5), "row", True)
for p in row_lots:
    fl, st = classify(p)
    fl = min(fl, rng.choice([2, 3, 3, 4]))
    buildings.append(dict(poly=poly_out(p), floors=fl, style=st, row=True))

# Ville de remplissage hors de la zone jouable
FILLER_REGION = INTERIOR.difference(DATA_REGION.buffer(2)).difference(PARKS)
filler_lots, _ = frontage(FILLER_REGION, streets_out, {}, (14, 24), (9, 20), "filler", False)
for p in filler_lots:
    fl, st = classify(p, filler=True)
    buildings.append(dict(poly=poly_out(p), floors=fl, style=st, filler=True))

# ---------------------------------------------------------------- carrefours
inters = []
for i in range(len(streets_out)):
    for j in range(i + 1, len(streets_out)):
        s1, s2 = streets_out[i], streets_out[j]
        l1, l2 = LineString([s1["a"], s1["b"]]), LineString([s2["a"], s2["b"]])
        x = l1.intersection(l2)
        if x.is_empty or x.geom_type != "Point":
            continue
        if not OUTER.buffer(-20).contains(x):
            continue
        cats = {s1["cat"], s2["cat"]}
        major_count = [s1["cat"], s2["cat"]].count("major")
        if major_count >= 1 and "minor" not in cats:
            kind = "light"
        elif major_count == 2:
            kind = "light"
        else:
            kind = "stop"
        inters.append(dict(p=[round2(x.x), round2(x.y)], s=[s1["id"], s2["id"]], kind=kind,
                           inData=bool(WALKABLE.buffer(30).contains(x))))

# passages piétons
crosswalks = []
sdict = {s["id"]: s for s in streets_out}
for it in inters:
    if not it["inData"]:
        continue
    P = np.array(it["p"])
    for k in (0, 1):
        sa, sb = sdict[it["s"][k]], sdict[it["s"][1 - k]]
        da = np.array(sa["b"]) - np.array(sa["a"])
        da /= np.linalg.norm(da)
        for sign in (1, -1):
            c = P + da * sign * (sb["w"] / 2 + sb["sw"] * 0.5 + 1.2)
            if not ROADS.contains(Point(c)):
                continue
            n = np.array([-da[1], da[0]])
            e0 = c - n * (sa["w"] / 2 + 1.4)
            e1 = c + n * (sa["w"] / 2 + 1.4)
            crosswalks.append(dict(a=[round2(e0[0]), round2(e0[1])], b=[round2(e1[0]), round2(e1[1])],
                                   c=[round2(c[0]), round2(c[1])], street=sa["id"], w=3.2,
                                   width=sa["w"], dir=[round2(da[0]), round2(da[1])]))

# ---------------------------------------------------------------- arbres, lampadaires
trees, lamps = [], []
BLD_ALL = unary_union([Polygon(b["poly"]) for b in buildings]).buffer(0.6)
inter_pts = [Point(it["p"]) for it in inters]


def near_intersection(pt, margin):
    for it, ip in zip(inters, inter_pts):
        ws = max(sdict[it["s"][0]]["w"], sdict[it["s"][1]]["w"])
        if pt.distance(ip) < ws / 2 + margin:
            return True
    return False


for s in streets_out:
    A, B = np.array(s["a"]), np.array(s["b"])
    L = np.linalg.norm(B - A)
    d = (B - A) / L
    n = np.array([-d[1], d[0]])
    for side in (1, -1):
        t = rng.uniform(2, 8)
        while t < L:
            p = A + d * t + n * side * (s["w"] / 2 + 1.1)
            pt = Point(p)
            if (SIDEWALKS.buffer(-0.2).contains(pt) and not near_intersection(pt, 9)
                    and not BLD_ALL.contains(pt) and OUTER.buffer(-5).contains(pt)
                    and rng.random() < (0.78 if s["cat"] != "major" or s["id"] != "stecath" else 0.45)):
                trees.append([round2(p[0]), round2(p[1]), round2(rng.uniform(0.75, 1.25))])
            t += rng.uniform(9, 14)
        t = rng.uniform(4, 12) + (13 if side < 0 else 0)
        while t < L:
            p = A + d * t + n * side * (s["w"] / 2 + 0.45)
            pt = Point(p)
            if SIDEWALKS.contains(pt) and not near_intersection(pt, 3) and WALKABLE.buffer(60).contains(pt):
                ang = math.atan2(-n[1] * side, -n[0] * side)
                lamps.append([round2(p[0]), round2(p[1]), round2(ang)])
            t += 27
# arbres du terre-plein
for p in polys_of(MEDIAN):
    ls = LineString([rene["a"], rene["b"]])
    L = ls.length
    t = 5
    while t < L:
        q = ls.interpolate(t)
        if p.buffer(-0.5).contains(q):
            trees.append([round2(q.x), round2(q.y), round2(rng.uniform(0.8, 1.1))])
        t += 11
# arbres des parcs
for pg in park_geoms:
    area = pg.area
    k = int(area / 140)
    minx_, miny_, maxx_, maxy_ = pg.bounds
    tries = 0
    placed = []
    while len(placed) < k and tries < k * 30:
        tries += 1
        q = Point(rng.uniform(minx_, maxx_), rng.uniform(miny_, maxy_))
        if pg.buffer(-2.5).contains(q) and all(q.distance(o) > 6 for o in placed):
            placed.append(q)
    for q in placed:
        trees.append([round2(q.x), round2(q.y), round2(rng.uniform(0.9, 1.4))])

# ---------------------------------------------------------------- réseau piéton
nav_nodes, nav_edges = [], []
node_index = {}


def add_node(x, z):
    key = (round(x, 1), round(z, 1))
    if key in node_index:
        return node_index[key]
    node_index[key] = len(nav_nodes)
    nav_nodes.append([round2(x), round2(z)])
    return node_index[key]


walk_land = LAND.intersection(WALKABLE).difference(MEDIAN)
for blk in polys_of(walk_land):
    if blk.area < 150:
        continue
    ring_poly = blk.buffer(-2.2, join_style=2)
    for rp in polys_of(ring_poly):
        ring = rp.exterior
        L = ring.length
        nseg = max(4, int(L / 6))
        ids = []
        for k in range(nseg):
            q = ring.interpolate(L * k / nseg)
            if BLD_ALL.contains(q):
                ids.append(None)
            else:
                ids.append(add_node(q.x, q.y))
        for k in range(nseg):
            a_, b_ = ids[k], ids[(k + 1) % nseg]
            if a_ is not None and b_ is not None:
                pa, pb = nav_nodes[a_], nav_nodes[b_]
                if not LineString([pa, pb]).intersects(BLD_ALL):
                    nav_edges.append([a_, b_])
nodes_np = np.array(nav_nodes)
for cw in crosswalks:
    ends = []
    for e in (cw["a"], cw["b"]):
        dd = np.linalg.norm(nodes_np - np.array(e), axis=1)
        k = int(np.argmin(dd))
        ends.append(k if dd[k] < 6 else None)
    if ends[0] is not None and ends[1] is not None and ends[0] != ends[1]:
        ia = add_node(*cw["a"])
        ib = add_node(*cw["b"])
        nav_edges.append([ends[0], ia])
        nav_edges.append([ia, ib])
        nav_edges.append([ib, ends[1]])

# ---------------------------------------------------------------- sortie
def poly_list(g, simplify=0.05):
    out = []
    for p in polys_of(g):
        p = p.simplify(simplify, preserve_topology=True)
        if p.area < 1:
            continue
        ext = list(p.exterior.coords)[:-1]
        if not Polygon(ext).exterior.is_ccw:
            ext = ext[::-1]
        holes = []
        for h in p.interiors:
            hc = list(h.coords)[:-1]
            if Polygon(hc).exterior.is_ccw:
                hc = hc[::-1]
            holes.append([[round2(x), round2(z)] for x, z in hc])
        out.append(dict(outer=[[round2(x), round2(z)] for x, z in ext], holes=holes))
    return out


def lm_pos(img_pt):
    x, z = to_world(img_pt)
    return [round2(x), round2(z)]


city = dict(
    meta=dict(scale=SCALE, origin="Berri / De Maisonneuve", source="carte-berri-uqam.webp"),
    dataRegion=poly_list(DATA_REGION)[0]["outer"],
    walkable=poly_list(WALKABLE)[0]["outer"],
    outer=poly_list(OUTER)[0]["outer"],
    streets=[dict(s, a=[round2(v) for v in s["a"]], b=[round2(v) for v in s["b"]]) for s in streets_out],
    roads=poly_list(ROADS),
    land=poly_list(LAND.difference(MEDIAN)),
    median=poly_list(MEDIAN),
    sidewalks=poly_list(SIDEWALKS),
    lots=poly_list(INTERIOR.difference(PARKS).difference(reserved)),
    plazas=poly_list(INTERIOR.intersection(reserved)),
    parks=[dict(id=p["id"], name=p["name"], poly=poly_list(p["poly"])[0]["outer"]) for p in parks_out],
    buildings=buildings,
    intersections=inters,
    crosswalks=crosswalks,
    trees=trees,
    lamps=lamps,
    nav=dict(nodes=nav_nodes, edges=nav_edges),
    poi=dict(
        metroEntrance=[-16.0, 28.0],
        metroPavilion=lm_pos((838, 224)),
        clocher=lm_pos((805, 372)),
        theatreMarquee=lm_pos((540, 238)),
        banqEntrance=lm_pos((672, 176)),
        gareEntrance=lm_pos((728, 140)),
        dupuisEntrance=lm_pos((838, 92)),
        berri1259=lm_pos((900, 270)),
        hubertAquin=lm_pos((905, 360)),
        cegepEntrance=lm_pos((300, 250)),
        spawn=[-14.5, 41.0],
    ),
)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(city, f, ensure_ascii=False, separators=(",", ":"))

print("rues", len(streets_out), "bâtiments", len(buildings),
      "(extraits", len(extracted), ", rangée", len(row_lots), ", remplissage", len(filler_lots), ")")
print("carrefours", len(inters), "passages", len(crosswalks), "arbres", len(trees), "lampadaires", len(lamps))
print("nav", len(nav_nodes), "noeuds", len(nav_edges), "arêtes")
print("zone de données", [round(v) for v in DATA_REGION.bounds], "taille fichier", os.path.getsize(OUT))
