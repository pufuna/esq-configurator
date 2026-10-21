"""Для каждого JSON: рамки листов → SVG каждого листа (render) + список текстов листа."""
import sys, json, math
from render import load, R
for k in sys.argv[1:]:
    d = load(f'json_{k}.json')
    r = R(d); r.block(r.blocks['*Model_Space'], [1, 0, 0, 0, 1, 0])
    # рамки — как в frames.py, но по уже собранным путям
    import re
    segs = []
    for p in r.out:
        m = re.match(r'<path d="M([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+)" fill="none"', p)
        if m:
            x0, y0, x1, y1 = map(float, m.groups()); y0, y1 = -y0, -y1
            if math.dist((x0, y0), (x1, y1)) > 2500: segs.append(((x0, y0), (x1, y1)))
    H = [s for s in segs if abs(s[0][1] - s[1][1]) < 1]
    rects = set()
    for h in H:
        x0, x1 = sorted([h[0][0], h[1][0]]); y = h[0][1]
        for h2 in H:
            a0, a1 = sorted([h2[0][0], h2[1][0]]); y2 = h2[0][1]
            if y2 < y - 1500 and abs(a0 - x0) < 30 and abs(a1 - x1) < 30: rects.add((round(x0), round(y2), round(x1), round(y)))
    rects = sorted(rects)
    outer = [a for a in rects if not any(b != a and b[0] <= a[0] + 1 and b[1] <= a[1] + 1 and b[2] >= a[2] - 1 and b[3] >= a[3] - 1 for b in rects)]
    if not outer: outer = [tuple(round(v) for v in r.ext)]
    for i, bb in enumerate(outer):
        open(f'out/{k}_s{i+1}.svg', 'w').write(r.svg(bbox=bb, pad=0.005))
        txt = [s for x, y, s in r.texts if bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3]]
        json.dump({'bbox': bb, 'texts': txt}, open(f'out/{k}_s{i+1}.json', 'w'), ensure_ascii=False)
    print(k, 'sheets', outer, flush=True)
