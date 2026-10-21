"""Дорисовка дополнительных шкафов на лист ME800-R (out_r/<база>.svg + <база>.dims.json → out_r/<база>_<код>.svg).
   python3 compose_r.py <база> <код> [--bypass-drawn]
   Код: B — шкаф байпаса, S — пусковой шкаф, R — шкаф реактора (любые сочетания, напр. BSR).
   Шкафы пристыковываются к ПЧ слева, по порядку от края листа: реактор — пусковой — байпас — ПЧ.
   Габариты всех доп. шкафов: ширина 800 мм, глубина и высота — как у ПЧ (высота корпуса ПЧ без вентиляторов)."""
import sys, json, re, statistics

def load(base):
    lines = open(f'out_r/{base}.svg').read().split('\n')
    meta = json.load(open(f'out_r/{base}.dims.json'))
    return lines, meta

def item_box(it):
    if it.startswith('<path'):
        n = [float(v) for v in re.findall(r'-?\d+\.?\d*', it.split('"')[1])]
        xs, ys = n[0::2], [-v for v in n[1::2]]
    elif it.startswith('<text'):
        m = re.search(r'x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)"', it)
        x, y, fs = float(m.group(1)), -float(m.group(2)), float(m.group(3))
        w = len(re.sub(r'<[^>]+>', '', it.split('>', 1)[1])) * fs * 0.52
        xs, ys = [x - w, x + w], [y, y + fs]
    else:
        return None
    return min(xs), min(ys), max(xs), max(ys)

def shift(it, dx):
    if it.startswith('<path'):
        d = it.split('"')[1]
        nd = re.sub(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', lambda m: f'{float(m.group(1)) + dx:.2f},{m.group(2)}', d)
        return it.replace(d, nd, 1)
    return re.sub(r'(x="|rotate\([-\d.]+ )([-\d.]+)', lambda m: m.group(1) + f'{float(m.group(2)) + dx:.2f}', it)

# Внешний вид доп. шкафа — шкаф байпаса компактной модели (лист RV1000S с ручным байпасом): фасад и вид сзади
TPL_SRC = 'R_F_10_280-1000_M'
TPL_FRONT = (3315, 3468, 3965, 5467)          # x0, низ, x1, крыша — фасад шкафа байпаса (650 × 1999)
TPL_REAR_X = (10112, 10762)                   # вид сзади: шкаф байпаса справа от ПЧ
def template():
    body = [l for l in open(f'out_r/{TPL_SRC}.svg').read().split('\n') if l.startswith('<path')]
    inbox = lambda b, x0, y0, x1, y1: b[0] >= x0 - 2 and b[2] <= x1 + 2 and b[1] >= y0 - 2 and b[3] <= y1 + 2
    fx0, fy0, fx1, fy1 = TPL_FRONT
    front = [it for it in body if inbox(item_box(it), fx0, fy0, fx1, fy1)]
    rx0, rx1 = TPL_REAR_X
    rear = [it for it in body if (b := item_box(it)) and b[0] >= rx0 - 2 and b[2] <= rx1 + 2 and fy0 - 200 <= b[1] and b[3] <= fy1 + 2]
    ry0 = min(item_box(it)[1] for it in rear); ry1 = max(item_box(it)[3] for it in rear)
    return (front, (fx0, fy0, fx1, fy1)), (rear, (rx0, ry0, rx1, ry1))
def place(items, src, dst):
    """Перенос путей из прямоугольника src в dst (масштаб по ширине и высоте)."""
    sx0, sy0, sx1, sy1 = src; dx0, dy0, dx1, dy1 = dst
    kx, ky = (dx1 - dx0) / (sx1 - sx0), (dy1 - dy0) / (sy1 - sy0)
    out = []
    for it in items:
        d = it.split('"')[1]
        nd = re.sub(r'(-?\d+\.?\d*),(-?\d+\.?\d*)', lambda m: f'{dx0 + (float(m.group(1)) - sx0) * kx:.2f},{-(dy0 + (-float(m.group(2)) - sy0) * ky):.2f}', d)
        out.append(it.replace(d, nd, 1))
    return out

BODY_H = None                                                    # --body-h: высота корпуса ПЧ, если на листе есть более низкий шкаф (G1: байпас 1999, ПЧ 2099)
def main(base, code, bypass_drawn=False):
    lines, meta = load(base)
    head = [l for l in lines if l.startswith('<svg') or l.startswith('<style')]
    body = [l for l in lines if l.startswith('<path') or l.startswith('<text')]
    dims = meta['dims']
    H = [d for d in dims if d['rot'] is not None and abs(d['rot'] % 3.14159) < 0.05]          # горизонтальные
    V = [d for d in dims if (d['rot'] is not None and abs(abs(d['rot']) - 1.5708) < 0.05) or (d['rot'] is None and abs(d['x1'][0] - d['x2'][0]) < 30)]
    # фасад: самый длинный горизонтальный размер, при равенстве — нижний
    fw = sorted(H, key=lambda d: (-round(d['m']), d['dp'][1]))[0]
    x1, x2 = sorted([fw['x1'][0], fw['x2'][0]]); base_y = min(fw['x1'][1], fw['x2'][1])
    ydim = fw['dp'][1]
    fs = statistics.median([float(re.search(r'font-size="([\d.]+)"', t).group(1)) for t in body if t.startswith('<text') and re.search(r'>\d', t)] or [80])
    # высота корпуса ПЧ (без вентиляторов) — наименьший вертикальный размер от низа фасада, больше 1800
    hs = [d['m'] for d in V if min(d['x1'][1], d['x2'][1]) < base_y + 60 and max(d['x1'][1], d['x2'][1]) > base_y + 1500 and d['m'] > 1800]
    body_h = BODY_H or (min(hs) if hs else 2100)
    # виды в плане: вертикальные размеры ниже фасада и выше него
    below = [d for d in V if max(d['x1'][1], d['x2'][1]) < base_y - 100]
    above = [d for d in V if min(d['x1'][1], d['x2'][1]) > base_y + body_h + 100]
    bands = []
    if below: bands.append(('below', min(min(d['x1'][1], d['x2'][1]) for d in below), max(max(d['x1'][1], d['x2'][1]) for d in below)))
    if above: bands.append(('above', min(min(d['x1'][1], d['x2'][1]) for d in above), max(max(d['x1'][1], d['x2'][1]) for d in above)))

    order = [c for c in 'RSB' if c in code and not (c == 'B' and bypass_drawn)]   # слева направо: реактор, пусковой, байпас
    if not order: raise SystemExit('нечего добавлять')
    pch_depth = max((b[2] - b[1]) for b in bands) if bands else 1325
    spec = {'R': (800, pch_depth, body_h, 'Шкаф реактора', 'ШР'), 'S': (800, pch_depth, body_h, 'Пусковой шкаф', 'ПШ'),
            'B': (800, pch_depth, body_h, 'Шкаф байпаса', 'ШБ')}
    total_add = sum(spec[c][0] for c in order)
    new_left = x1 - total_add

    # всё, что целиком левее фасада в полосе фасада (боковой вид слева и его размеры), — сдвигаем влево
    top_f = max([max(d['x1'][1], d['x2'][1]) for d in V if min(d['x1'][1], d['x2'][1]) < base_y + 60] + [base_y + 2600])
    band_f = (base_y - 150, top_f + 30)
    out = []
    for it in body:
        b = item_box(it)
        if b and b[2] < x1 - 1 and b[1] >= band_f[0] and b[3] <= band_f[1]: it = shift(it, -total_add - 250)
        out.append(it)

    P = lambda pts, w=None, fill='none': '<path d="M' + ' L'.join(f'{x:.2f},{-y:.2f}' for x, y in pts) + f'" fill="{fill}" stroke="#000" stroke-width="0.25"/>'
    rect = lambda a, b, c, d: P([(a, b), (c, b), (c, d), (a, d), (a, b)])
    T = lambda x, y, s, size=fs, anchor='middle', rot=0: (f'<text x="{x:.2f}" y="{-y:.2f}" font-size="{size:.2f}" font-family="Arial, Helvetica, sans-serif" '
                                                         f'text-anchor="{anchor}" transform="rotate({-rot:.2f} {x:.2f} {-y:.2f})">{s}</text>')
    def arrow(tip, ux, uy):
        L, w = fs, fs / 6
        return P([tip, (tip[0] - ux * L - uy * w, tip[1] - uy * L + ux * w), (tip[0] - ux * L + uy * w, tip[1] - uy * L - ux * w), tip], fill='#000')
    def hdim(xa, xb, y_obj, y_line, txt):
        r = [P([(xa, y_obj - fs * 0.3), (xa, y_line - fs * 0.6)]), P([(xb, y_obj - fs * 0.3), (xb, y_line - fs * 0.6)]), P([(xa, y_line), (xb, y_line)]),
             arrow((xa, y_line), -1, 0), arrow((xb, y_line), 1, 0), T((xa + xb) / 2, y_line + fs * 0.35, txt)]
        return r
    def vdim(x_obj, x_line, ya, yb, txt):
        return [P([(x_obj - fs * 0.3, ya), (x_line - fs * 0.6, ya)]), P([(x_obj - fs * 0.3, yb), (x_line - fs * 0.6, yb)]), P([(x_line, ya), (x_line, yb)]),
                arrow((x_line, ya), 0, -1), arrow((x_line, yb), 0, 1), T(x_line - fs * 0.35, (ya + yb) / 2, txt, rot=90)]

    add = []; plan_drawn = False
    (TF, TFB), (TR, TRB) = template()
    plinth = min(100, body_h * 0.05)
    x = new_left
    for c in order:
        w, dpt, h, name, short = spec[c]
        a, b = x, x + w
        add += place(TF, TFB, (a, base_y, b, base_y + h))                                         # вид — как у шкафа байпаса компактной модели
        add += [T((a + b) / 2, base_y + h + fs * 0.5, name, fs * 0.8)]                              # подпись над шкафом
        add += hdim(a, b, base_y, ydim, str(w))
        for kind, lo, hi in bands:                                                                  # виды в плане
            # место слева от вида свободно, если там нет объектов целиком левее ПЧ (выступы самого ПЧ не считаются)
            region_free = not any((bb := item_box(it)) and bb[2] < x1 - 120 and bb[2] > new_left - 50 and bb[3] > lo - 50 and bb[1] < hi + 50 for it in body)
            if not region_free: continue
            if kind == 'below': fy0, fy1 = hi - dpt, hi                                               # передняя кромка — ближе к фасаду
            else: fy0, fy1 = lo, lo + dpt
            add += [rect(a, fy0, b, fy1), T((a + b) / 2, (fy0 + fy1) / 2 - fs * 0.35, short, fs * 0.9)]; plan_drawn = True
        x = b
    # вид сзади: справа от ПЧ, в зеркальном порядке (ближе к ПЧ — байпас, затем пусковой, реактор)
    mt0 = re.match(r'\s*(\d+)', fw.get('text') or ''); wn = int(mt0.group(1)) if mt0 else fw['m']
    longs = []
    for it in body:
        bb = item_box(it)
        if bb and it.startswith('<path') and bb[3] - bb[1] < 2 and bb[2] - bb[0] > 1000 and bb[0] > x2 + 300 and base_y - 300 < bb[1] < base_y + body_h + 300:
            longs.append(bb)
    if longs:                                                                       # вид сзади — самый правый вид на листе
        rl = max(b[0] for b in longs); grp = [b for b in longs if abs(b[0] - rl) < 120]
        inband = [item_box(it) for it in body if it.startswith('<path')]
        rlow = min(b[1] for b in grp)
        # фактический низ вида сзади (с цоколем) и правый край (с уже нарисованным шкафом байпаса)
        rw = max(b[2] - b[0] for b in grp)
        rbase = min(b[1] for b in inband if b and b[0] >= rl - 5 and b[2] <= rl + rw + 5 and b[1] > rlow - 300)
        rr = max(b[2] for b in inband if b and b[0] >= rl - 5 and b[1] >= rbase - 5 and b[3] <= rbase + body_h * 0.95)
        rshift = total_add + 200
        out = [shift(it, rshift) if (bb := item_box(it)) and bb[0] > rr + 1 and bb[1] >= rbase - 150 and bb[3] <= rbase + body_h + 30 else it for it in out]
        xr = rr
        for c in reversed(order):                                                   # B ближе к ПЧ, R — дальше
            w, dpt, h, name, short = spec[c]
            add += place(TR, TRB, (xr, rbase, xr + w, rbase + h))
            add += [T(xr + w / 2, rbase + h + fs * 0.5, name, fs * 0.8)]
            xr += w
        rear_done = True
    if plan_drawn:                                                                  # расшифровка сокращений в плане
        ylow = min(b[1] for b in (item_box(it) for it in out + add) if b)
        names = {'R': 'ШР — шкаф реактора', 'S': 'ПШ — пусковой шкаф', 'B': 'ШБ — шкаф байпаса'}
        add.append(T(new_left, ylow - fs * 1.8, '; '.join(names[c] for c in order), fs * 0.9, 'start'))
    elif bands:
        pass
    # высота добавленных шкафов и общая длина ряда
    hmax = max(spec[c][2] for c in order)
    add += vdim(new_left, new_left - fs * 3.2, base_y, base_y + hmax, str(round(hmax)))
    mt = re.match(r'\s*(\d+)', fw.get('text') or '')                               # номинальная длина ПЧ — из подписи размера
    tot = (int(mt.group(1)) if mt else round(fw['m'])) + total_add
    # общая длина — ниже цепочки размеров; если там уже размеры вида в плане — ближе к цепочке
    def busy(yl):
        return any((bb := item_box(it)) and bb[2] > new_left and bb[0] < x2 and bb[3] > yl - fs * 1.3 and bb[1] < yl + fs * 1.6 for it in body)
    yt = next((ydim - fs * k for k in (3.2, 2.6, 2.2) if not busy(ydim - fs * k)), ydim - fs * 2.2)
    add += hdim(new_left, x2, base_y, yt, f'{tot} (общая длина)')

    allb = [item_box(it) for it in out + add if item_box(it)]
    bx0, by0 = min(b[0] for b in allb), min(b[1] for b in allb); bx1, by1 = max(b[2] for b in allb), max(b[3] for b in allb)
    pad = 0.03 * max(bx1 - bx0, by1 - by0); bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad
    w, h = bx1 - bx0, by1 - by0
    svg = re.sub(r'viewBox="[^"]+" width="\d+" height="\d+"', f'viewBox="{bx0:.1f} {-by1:.1f} {w:.1f} {h:.1f}" width="{w / h * 800:.0f}" height="800"', head[0])
    res = [svg, head[1], f'<rect x="{bx0:.1f}" y="{-by1:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#fff" stroke="#000" stroke-width="{w / 1500:.2f}"/>'] + out + add + ['</svg>']
    name = f'{base}_{code}'
    open(f'out_r/{name}.svg', 'w').write('\n'.join(res))
    print(name, 'добавлено', order, 'общая длина', tot, 'вид(ы) в плане:', [b[0] for b in bands])

if __name__ == '__main__':
    if '--body-h' in sys.argv: BODY_H = float(sys.argv[sys.argv.index('--body-h') + 1])
    main(sys.argv[1], sys.argv[2], '--bypass-drawn' in sys.argv)
