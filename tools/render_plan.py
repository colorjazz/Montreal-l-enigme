"""Rendu 2D de contrôle de src/data/city.json (vue de dessus)."""
import json, os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
city = json.load(open(os.path.join(HERE, "..", "src", "data", "city.json"), encoding="utf-8"))
out = sys.argv[1] if len(sys.argv) > 1 else "plan.png"
zoom = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
xs = [p[0] for p in city["outer"]]; zs = [p[1] for p in city["outer"]]
minx, minz = min(xs), min(zs)
W = int((max(xs) - minx) * zoom); H = int((max(zs) - minz) * zoom)
im = Image.new("RGB", (W, H), (235, 232, 225))
d = ImageDraw.Draw(im)
T = lambda p: ((p[0] - minx) * zoom, (p[1] - minz) * zoom)
for r in city["roads"]:
    d.polygon([T(p) for p in r["outer"]], fill=(70, 70, 80))
    for h in r["holes"]:
        d.polygon([T(p) for p in h], fill=(235, 232, 225))
for r in city["sidewalks"]:
    d.polygon([T(p) for p in r["outer"]], fill=(190, 190, 185))
for m in city["median"]:
    d.polygon([T(p) for p in m["outer"]], fill=(120, 170, 100))
for p in city["parks"]:
    d.polygon([T(q) for q in p["poly"]], fill=(110, 190, 110))
cols = {"brick_red": (170, 80, 60), "greystone": (150, 150, 140), "painted": (200, 160, 90), "brick_brown": (120, 80, 60),
        "brick_cream": (210, 190, 150), "concrete": (160, 160, 160), "modern": (90, 110, 140), "glass": (100, 150, 180),
        "uqam": (140, 70, 50), "banq": (90, 160, 120), "dupuis": (130, 100, 80), "theatre": (180, 50, 50)}
for b in city["buildings"]:
    c = cols.get(b["style"], (200, 0, 200))
    if b.get("filler"): c = tuple(int(v * 0.7 + 60) for v in c)
    d.polygon([T(p) for p in b["poly"]], fill=c, outline=(30, 30, 30))
for cw in city["crosswalks"]:
    d.line([T(cw["a"]), T(cw["b"])], fill=(255, 255, 255), width=max(1, int(3 * zoom)))
for t in city["trees"]:
    x, y = T(t); r = 2 * zoom
    d.ellipse([x - r, y - r, x + r, y + r], fill=(40, 120, 40))
for l in city["lamps"]:
    x, y = T(l); d.point((x, y), fill=(255, 220, 0))
for e in city["nav"]["edges"]:
    a, b = city["nav"]["nodes"][e[0]], city["nav"]["nodes"][e[1]]
    d.line([T(a), T(b)], fill=(255, 0, 255), width=1)
d.polygon([T(p) for p in city["walkable"]], outline=(255, 0, 0))
for it in city["intersections"]:
    x, y = T(it["p"]); r = 3
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 0, 0) if it["kind"] == "light" else (255, 140, 0))
for k, v in city["poi"].items():
    x, y = T(v); d.text((x + 3, y), k, fill=(0, 0, 255))
for b in city["buildings"]:
    if b.get("name"):
        p = b["poly"][0]; x, y = T(p); d.text((x, y), b["landmark"], fill=(0, 0, 0))
im.save(out)
print(W, H)
