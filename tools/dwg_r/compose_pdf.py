"""Дорисовка дополнительных шкафов на готовый лист ME800-R в PDF (без исходных DWG/SVG).
   python3 compose_pdf.py <базовый лист.pdf> <код> <результат.pdf>
   Код: R — шкаф реактора, S — пусковой шкаф, B — шкаф байпаса (любые сочетания, напр. BSR).

   То же, что compose_r.py, но работает по PDF из assets/drawings_r (PyMuPDF): находит на листе фасад
   (горизонтальный размер ширины ПЧ / ряда), пол и высоту корпуса (вертикальный размер 1800–2200),
   вид сзади (самый правый вид в полосе фасада) и виды в плане, затем:
     • фасад: шкафы пристыковываются к ряду слева, от края — реактор, пусковой, байпас; боковой вид слева сдвигается;
     • вид сзади: справа от ПЧ в зеркальном порядке;
     • виды в плане: прямоугольники ШР/ПШ/ШБ, если слева от вида свободно;
     • размеры: ширина каждого шкафа, высота, общая длина ряда; расшифровка и габариты шкафа реактора.
   Габариты: шкаф реактора 1000×1300×2100 мм (Ш×Г×В); пусковой и байпаса — ширина 800 мм, глубина и высота как у ПЧ.
   Внешний вид доп. шкафа — шкаф байпаса компактной модели (лист R_F_10_280-1000_M: фасад и вид сзади).
   Результат — лист шириной 420 мм, как у остальных чертежей. """
import os, re, sys
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DRAW = os.path.join(ROOT, 'assets', 'drawings_r')
FONT = os.path.join(ROOT, 'assets', 'fonts', 'LiberationSans-Regular.ttf')   # тем же шрифтом набраны листы
TPL = os.path.join(DRAW, 'R_F_10_280-1000_M.pdf')                             # шкаф байпаса 650 × 1999 слева от ПЧ
TPL_W, TPL_H = 650, 1999
REACTOR = (1000, 1300, 2100)
SHEET_W = 1191.12                                                             # 420 мм в pt
NAMES = {'R': ('Шкаф реактора', 'ШР', 'шкаф реактора'), 'S': ('Пусковой шкаф', 'ПШ', 'пусковой шкаф'), 'B': ('Шкаф байпаса', 'ШБ', 'шкаф байпаса')}
FNT = pymupdf.Font(fontfile=FONT)


# ---------- разбор листа ----------
def texts(page):
    out = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l['spans']).strip()
            if t:
                out.append({'t': t, 'r': pymupdf.Rect(l['bbox']), 'dir': tuple(round(v) for v in l['dir']), 'size': l['spans'][0]['size']})
    return out


def segments(drawings):
    S = []
    for d in drawings:
        for it in d['items']:
            if it[0] == 'l':
                S.append((it[1], it[2], d))
            elif it[0] == 're':
                r = it[1]
                S += [(r.tl, r.tr, d), (r.bl, r.br, d), (r.tl, r.bl, d), (r.tr, r.br, d)]
    H = [(min(a.x, b.x), max(a.x, b.x), a.y, d) for a, b, d in S if abs(a.y - b.y) < 0.05 and abs(a.x - b.x) > 2]
    V = [(min(a.y, b.y), max(a.y, b.y), a.x, d) for a, b, d in S if abs(a.x - b.x) < 0.05 and abs(a.y - b.y) > 0.5]
    return H, V


def vdims(T, V):
    """Вертикальные размеры: (значение, верх, низ, x линии, подпись)."""
    out = []
    for t in T:
        m = re.match(r'(\d+(?:\.\d+)?)', t['t'])
        if t['dir'] != (0, -1) or not m:
            continue
        cy = (t['r'].y0 + t['r'].y1) / 2
        c = [v for v in V if t['r'].x1 - 1 < v[2] < t['r'].x1 + 8 and v[0] < cy < v[1]]
        if c:
            v = max(c, key=lambda q: q[1] - q[0])
        else:                                                                     # малый размер: подпись вынесена за стрелку
            c = [v for v in V if t['r'].x1 - 1 < v[2] < t['r'].x1 + 8 and min(abs(v[0] - cy), abs(v[1] - cy)) < 5 * t['size'] and v[1] - v[0] > 0.5]
            if not c: continue
            v = min(c, key=lambda q: min(abs(q[0] - cy), abs(q[1] - cy)) - (q[1] - q[0]) * 0.01)
        out.append((float(m.group(1)), v[0], v[1], v[2], t))
    return out


def geometry(page):
    T, D = texts(page), page.get_drawings()
    H, V = segments(D)
    pr = page.rect
    frame = [d for d in D if d['rect'].width > pr.width - 6 and d['rect'].height > pr.height - 6]
    VD = vdims(T, V)
    body = [v for v in VD if 1800 <= v[0] <= 2200]
    if not body:
        raise SystemExit('не найден размер высоты корпуса')
    body_h, top, base_y, xb, _ = body[0]
    # ширина ряда: самый длинный горизонтальный размер под фасадом (при равенстве — нижний)
    cand = []
    for t in T:
        m = re.match(r'(\d+)', t['t'])
        if t['dir'] != (1, 0) or not m or not (base_y < t['r'].y0 < base_y + 120):
            continue
        cx = (t['r'].x0 + t['r'].x1) / 2
        ls = [h for h in H if t['r'].y0 - 8 < h[2] < t['r'].y1 + 8 and h[0] < cx < h[1]]
        if ls:
            h = max(ls, key=lambda q: q[1] - q[0])
            cand.append((round(h[1] - h[0]), h[2], h, int(m.group(1)), t))
    _, ydim, h, W, wt = max(cand, key=lambda c: (c[0], c[1]))
    x1, x2 = h[0], h[1]
    k = (x2 - x1) / W
    if abs((base_y - top) / body_h - k) > 0.02 * k:
        raise SystemExit(f'масштаб не сходится: {k:.4f} по ширине, {(base_y - top) / body_h:.4f} по высоте')
    lw = h[3]['width'] or 0.3
    # верх полосы фасада — самая высокая вертикальная линия, стоящая на полу у фасада (вентиляторы, размеры высоты)
    top_f = min([v[0] for v in V if abs(v[1] - base_y) < 3 and x1 - 5 < v[2] < x2 + 600 * k] + [top])
    return dict(T=T, D=D, H=H, V=V, VD=VD, frame=frame, k=k, x1=x1, x2=x2, ydim=ydim, W=W, wlabel=wt, body_h=body_h,
                base_y=base_y, top=top, top_f=top_f, fs=wt['size'], lw=lw)


def items(g):
    """Все объекты листа (рисунки и строки текста) с рамками, кроме рамки листа."""
    fr = {id(d) for d in g['frame']}
    out = [('d', d['rect'], d) for d in g['D'] if id(d) not in fr]
    out += [('t', t['r'], t) for t in g['T']]
    return out


def rear_view(g):
    k, base_y, bh = g['k'], g['base_y'], g['body_h']
    longs = [h for h in g['H'] if h[1] - h[0] > 1000 * k and h[0] > g['x2'] + 300 * k and base_y - (bh + 300) * k < h[2] < base_y + 300 * k]
    if not longs:
        return None
    rl = max(h[0] for h in longs)
    grp = [h for h in longs if abs(h[0] - rl) < 120 * k]
    rw = max(h[1] - h[0] for h in grp)
    rlow = max(h[2] for h in grp)
    fr = {id(d) for d in g['frame']}
    ds = [d['rect'] for d in g['D'] if id(d) not in fr]
    rbase = max(r.y1 for r in ds if r.x0 >= rl - 5 and r.x1 <= rl + rw + 5 and r.y1 < rlow + 300 * k)
    rr = max(r.x1 for r in ds if r.x0 >= rl - 5 and r.y1 <= rbase + 5 and r.y0 >= rbase - bh * 0.95 * k)
    return dict(rl=rl, rr=rr, rbase=rbase)


def grow(group, allit, ok):
    """Добавить к группе объекты, которые её касаются (и удовлетворяют ok) — до устойчивости."""
    group = list(group)
    if not group: return group
    ids = {id(it[2]) for it in group}
    pool = [it for it in allit if id(it[2]) not in ids and ok(it[1])]
    r = pymupdf.Rect(group[0][1])
    for it in group[1:]: r |= it[1]
    while True:
        rr = r + (-1, -1, 1, 1)
        add = [it for it in pool if it[1].intersects(rr)]
        if not add: return group
        group += add
        for it in add: r |= it[1]
        got = {id(it[2]) for it in add}
        pool = [it for it in pool if id(it[2]) not in got]


def fan_dims(g, rv, total_add):
    """Вертикальные размеры вентилятора справа от вида сзади (лист R_F_10_280-1000_0) мешают доп. шкафам:
       убираем их (с выносными линиями) и рисуем слева от вентилятора, как на листах с байпасом."""
    k, bh = g['k'], g['body_h']
    zone = pymupdf.Rect(rv['rr'] + 0.3, rv['rbase'] - (max(REACTOR[2], bh) + 300) * k, rv['rr'] + (total_add + 300) * k, rv['rbase'] - bh * k + 1)
    dims = [v for v in g['VD'] if zone.x0 < v[3] < zone.x1 and v[1] >= zone.y0 - 5 and v[2] <= zone.y1 + 1]
    if not dims: return None
    roof = rv['rbase'] - bh * k
    fan = [d['rect'] for d in g['D'] if d['rect'].width < 5000 and d['rect'].y1 < roof - 0.2 and d['rect'].y0 > roof - 700 * k
           and d['rect'].x0 >= rv['rl'] - 5 and d['rect'].x1 <= rv['rr']]
    fx0 = min(r.x0 for r in fan)
    gone, redact, out = set(), [], []
    ys = set()
    for val, ya, yb, xl, t in dims:
        ys |= {round(ya, 1), round(yb, 1)}
        out.append((('%g' % val), yb, ya, t['size']))
        redact.append(t['r'] + (-0.3, -0.3, 0.3, 0.3)); gone.add(id(t))
    for d in g['D']:
        r = d['rect']
        inside = r.x0 > rv['rr'] + 0.3 and any(abs((r.x0 + r.x1) / 2 - xl) < t['size'] * 0.6 and r.width < t['size']
                                                 and r.y0 >= ya - 1.6 * t['size'] and r.y1 <= yb + 1.6 * t['size'] for _, ya, yb, xl, t in dims)   # линия и стрелки размера
        ext = r.height < 0.2 and round(r.y0, 1) in ys and r.x1 > rv['rr'] + 1 and r.x0 > fx0 - 1                  # выносные линии от вентилятора
        if inside or ext:                                                           # запас — на острые углы стрелок (miter)
            gone.add(id(d)); redact.append(r + ((-1.5, -0.4, 1.5, 0.4) if ext else (-1.5, -1.5, 1.5, 1.5)))
    out.sort(key=lambda q: q[2] - q[1], reverse=True)                                  # больший размер — ближе к вентилятору
    return dict(gone=gone, redact=redact, dims=out, x=fx0)


def template():
    """Пути шкафа байпаса с листа R_F_10_280-1000_M: фасад и вид сзади, с их рамками."""
    p = pymupdf.open(TPL)[0]
    g = geometry(p)
    k, x1, base = g['k'], g['x1'], g['base_y']
    fr = pymupdf.Rect(x1, base - TPL_H * k, x1 + TPL_W * k, base)
    rv = rear_view(g)
    rrect = pymupdf.Rect(rv['rr'] - TPL_W * k, rv['rbase'] - TPL_H * k, rv['rr'], rv['rbase'])
    tol = 2 * k
    front = [d for d in g['D'] if d['rect'] in fr + (-tol, -tol, tol, tol)]
    # вид сзади — вместе с цоколем (ниже пола до 200 мм)
    rear = [d for d in g['D'] if d['rect'] in rrect + (-tol, -tol, tol, 200 * k)]
    return (front, fr), (rear, rrect), k


# ---------- рисование ----------
class Pen:
    def __init__(self, page, ox, oy, lw, fs):
        self.p, self.ox, self.oy, self.lw, self.fs = page, ox, oy, lw, fs
        self.boxes = []
        self.sh = page.new_shape()                                                   # все линии — одной фигурой (commit медленный)

    def done(self):
        self.sh.commit()

    def P(self, x, y):
        return pymupdf.Point(x + self.ox, y + self.oy)

    def line(self, pts, fill=None):
        sh = self.sh
        sh.draw_polyline([self.P(*a) for a in pts])
        sh.finish(color=(0, 0, 0), fill=fill, width=self.lw, closePath=bool(fill))
        self.boxes.append(pymupdf.Rect(min(a[0] for a in pts), min(a[1] for a in pts), max(a[0] for a in pts), max(a[1] for a in pts)))

    def rect(self, a, b, c, d):
        self.line([(a, b), (c, b), (c, d), (a, d), (a, b)])

    def text(self, x, y, s, size=None, anchor='middle', rot=0):
        size = size or self.fs
        w = FNT.text_length(s, fontsize=size)
        if rot == 0:
            x0 = x - w / 2 if anchor == 'middle' else x
            self.p.insert_text(self.P(x0, y), s, fontsize=size, fontname='lib', fontfile=FONT)
            self.boxes.append(pymupdf.Rect(x0, y - size, x0 + w, y + size * 0.25))
        else:                                                                         # снизу вверх
            y0 = y + w / 2
            self.p.insert_text(self.P(x, y0), s, fontsize=size, fontname='lib', fontfile=FONT, rotate=90)
            self.boxes.append(pymupdf.Rect(x - size, y0 - w, x + size * 0.25, y0))

    def arrow(self, tip, ux, uy):
        L, w = self.fs, self.fs / 6
        x, y = tip
        self.line([tip, (x - ux * L - uy * w, y - uy * L + ux * w), (x - ux * L + uy * w, y - uy * L - ux * w), tip], fill=(0, 0, 0))

    def hdim(self, xa, xb, y_obj, y_line, txt):
        f = self.fs
        self.line([(xa, y_obj + f * 0.3), (xa, y_line + f * 0.6)])
        self.line([(xb, y_obj + f * 0.3), (xb, y_line + f * 0.6)])
        self.line([(xa, y_line), (xb, y_line)])
        self.arrow((xa, y_line), -1, 0)
        self.arrow((xb, y_line), 1, 0)
        self.text((xa + xb) / 2, y_line - f * 0.35, txt)

    def vdim(self, x_obj, x_line, ya, yb, txt):                                       # ya — низ, yb — верх (y вниз)
        f = self.fs
        self.line([(x_obj - f * 0.3, ya), (x_line - f * 0.6, ya)])
        self.line([(x_obj - f * 0.3, yb), (x_line - f * 0.6, yb)])
        self.line([(x_line, ya), (x_line, yb)])
        self.arrow((x_line, ya), 0, 1)
        self.arrow((x_line, yb), 0, -1)
        self.text(x_line - f * 0.35, (ya + yb) / 2, txt, rot=90)

    def vdim_at(self, x_obj, ya, yb, txt, size):
        """Вертикальный размер слева от объекта (ya — низ, yb — верх); очередной — левее предыдущего."""
        f = size
        n = getattr(self, '_vn', 0); self._vn = n + 1
        xl = x_obj - f * (1.6 + 2.2 * n)
        self.line([(x_obj - f * 0.3, ya), (xl - f * 0.6, ya)])
        self.line([(x_obj - f * 0.3, yb), (xl - f * 0.6, yb)])
        save = self.fs; self.fs = f
        if ya - yb > 2.5 * f:
            self.line([(xl, ya), (xl, yb)]); self.arrow((xl, ya), 0, 1); self.arrow((xl, yb), 0, -1)
            self.text(xl - f * 0.35, (ya + yb) / 2, txt, size=f, rot=90)
        else:                                                                          # мал для стрелок внутри — стрелки снаружи
            self.line([(xl, yb - f * 1.4), (xl, ya + f * 1.4)])
            self.arrow((xl, yb), 0, 1); self.arrow((xl, ya), 0, -1)
            self.text(xl - f * 0.35, yb - f * 1.6 - FNT.text_length(txt, fontsize=f) / 2, txt, size=f, rot=90)
        self.fs = save

    def place(self, paths, src, dst):
        """Пути из прямоугольника src (лист шаблона) в dst (масштаб по ширине и высоте)."""
        kx, ky = dst.width / src.width, dst.height / src.height
        tr = lambda p: self.P(dst.x0 + (p.x - src.x0) * kx, dst.y0 + (p.y - src.y0) * ky)
        sh = self.sh
        for d in paths:
            for it in d['items']:
                if it[0] == 'l':
                    sh.draw_line(tr(it[1]), tr(it[2]))
                elif it[0] == 'c':
                    sh.draw_bezier(tr(it[1]), tr(it[2]), tr(it[3]), tr(it[4]))
                elif it[0] == 're':
                    sh.draw_rect(pymupdf.Rect(tr(it[1].tl), tr(it[1].br)))
                elif it[0] == 'qu':
                    q = it[1]
                    sh.draw_quad(pymupdf.Quad(tr(q.ul), tr(q.ur), tr(q.ll), tr(q.lr)))
            sh.finish(color=d.get('color'), fill=d.get('fill'), width=(d.get('width') or 0) * (kx * ky) ** 0.5,
                      closePath=d.get('closePath', False), even_odd=d.get('even_odd', False),
                      fill_opacity=d.get('fill_opacity') or 1, stroke_opacity=d.get('stroke_opacity') or 1)
        self.boxes.append(dst)


def only(base_pdf, R):
    """Копия листа, где оставлено только то, что заходит в R (чтобы не встраивать лист в PDF второй раз целиком)."""
    d = pymupdf.open(base_pdf)
    p = d[0]
    W, H = p.rect.width, p.rect.height
    for strip in (pymupdf.Rect(-5, -5, W + 5, R.y0), pymupdf.Rect(-5, R.y1, W + 5, H + 5),
                  pymupdf.Rect(-5, -5, R.x0, H + 5), pymupdf.Rect(R.x1, -5, W + 5, H + 5)):
        if strip.is_empty: continue
        p.add_redact_annot(strip, fill=False)
        p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    return d


def compose(base_pdf, code, out_pdf):
    src = pymupdf.open(base_pdf)
    sp = src[0]
    g = geometry(sp)
    k, x1, x2, base_y, fs, bh = g['k'], g['x1'], g['x2'], g['base_y'], g['fs'], g['body_h']
    order = [c for c in 'RSB' if c in code]
    # глубина ПЧ — по видам в плане (вертикальные размеры над и под фасадом в колонке ПЧ)
    col = [v for v in g['VD'] if x1 - 300 * k < v[3] < x2 + 700 * k]
    below = [v for v in col if v[1] > base_y + 100 * k and v[2] > g['ydim']]
    above = [v for v in col if v[2] < g['top_f'] - 100 * k]
    bands = []
    if below: bands.append(('below', min(v[1] for v in below), max(v[2] for v in below)))
    if above: bands.append(('above', min(v[1] for v in above), max(v[2] for v in above)))
    pch_depth = max([(hi - lo) / k for _, lo, hi in bands] or [1325])
    spec = {'R': REACTOR, 'S': (800, pch_depth, bh), 'B': (800, pch_depth, bh)}
    total_add = sum(spec[c][0] for c in order)
    new_left = x1 - total_add * k
    allit = items(g)

    # боковой вид слева от фасада (в полосе фасада) — сдвигается влево
    band_f = (g['top_f'] - 30 * k, base_y + 150 * k)
    left = grow([it for it in allit if it[1].x1 < x1 - 1 and it[1].y0 >= band_f[0] and it[1].y1 <= band_f[1]], allit, lambda r: r.x1 < x1 - 1)
    dl = -(total_add + 250) * k
    # вид сзади: справа от него — сдвиг вправо
    rv = rear_view(g)
    right, dr, fan = [], 0, None
    if rv:
        dr = (total_add + 200) * k
        right = [it for it in allit if it[1].x0 > rv['rr'] + 1 and it[1].y1 <= rv['rbase'] + 150 * k and it[1].y0 >= rv['rbase'] - (bh + 30) * k]
        fan = fan_dims(g, rv, total_add)                                         # размеры вентилятора там, где встанут шкафы, — к вентилятору слева
        if fan:
            gone = fan['gone']
            right = [it for it in right if id(it[2]) not in gone]
            allit = [it for it in allit if id(it[2]) not in gone]

    def bbox(lst):
        r = pymupdf.Rect(lst[0][1])
        for it in lst[1:]: r |= it[1]
        return r
    Lr = bbox(left) + (-0.5, -0.5, 0.5, 0.5) if left else None
    Rr = bbox(right) + (-0.5, -0.5, 0.5, 0.5) if right else None
    for name, R_, lst in (('слева', Lr, left), ('справа', Rr, right)):          # в переносимую область не должно попадать чужое
        if R_:
            mine = {id(it[2]) for it in lst}
            alien = [it for it in allit if id(it[2]) not in mine and it[1].intersects(R_) and not it[1] in R_]
            if alien:
                print(f'  внимание: область {name} задевает {len(alien)} объект(ов)', [a[2]['t'] if a[0] == 't' else tuple(round(v) for v in a[1]) for a in alien][:4])

    # рабочая копия листа без переносимых областей
    work = pymupdf.open(base_pdf)
    wp = work[0]
    for R_ in [Lr, Rr] + (fan['redact'] if fan else []):                          # по одной: пачкой MuPDF удаляет не всё
        if not R_: continue
        wp.add_redact_annot(R_, fill=False)
        wp.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=pymupdf.PDF_REDACT_TEXT_REMOVE)

    content = bbox([it for it in allit])
    # холст: лист с запасом слева и справа; координаты рисования — как на исходном листе (смещение ox)
    ox = total_add * k + 400 * k + 50
    canvas = pymupdf.open()
    cp = canvas.new_page(width=sp.rect.width + ox + dr + 50, height=sp.rect.height + 200)
    oy = 100
    clip = content + (-1, -1, 1, 1)
    cp.show_pdf_page(clip + (ox, oy, ox, oy), work, 0, clip=clip)
    if Lr: cp.show_pdf_page(Lr + (ox + dl, oy, ox + dl, oy), only(base_pdf, Lr), 0, clip=Lr)
    if Rr: cp.show_pdf_page(Rr + (ox + dr, oy, ox + dr, oy), only(base_pdf, Rr), 0, clip=Rr)
    pen = Pen(cp, ox, oy, g['lw'], fs)
    placed = [content]
    if Lr: placed.append(Lr + (dl, 0, dl, 0))
    if Rr: placed.append(Rr + (dr, 0, dr, 0))

    if fan:
        for val, ya, yb, size in fan['dims']:
            pen.vdim_at(fan['x'], ya, yb, val, size)
    # «NNNN (общая длина)» прежнего ряда (лист G1 с байпасом) — теперь это не общая длина: оставляем только число
    wt = g['wlabel']
    if 'общая длина' in wt['t']:
        r = wt['r']
        cp.draw_rect(r + (ox - 0.5, oy - 0.5, ox + 0.5, oy + 0.5), color=None, fill=(1, 1, 1))
        pen.text((r.x0 + r.x1) / 2, r.y1 - wt['size'] * 0.2, str(g['W']), size=wt['size'])

    (TF, TFB), (TR, TRB), _ = template()
    plan_drawn = False
    x = new_left
    for c in order:
        w, dpt, h = spec[c]
        name, short, _ = NAMES[c]
        a, b = x, x + w * k
        pen.place(TF, TFB, pymupdf.Rect(a, base_y - h * k, b, base_y))
        pen.text((a + b) / 2, base_y - h * k - fs * 0.5, name, fs * 0.8)
        pen.hdim(a, b, base_y, g['ydim'], str(w))
        for kind, lo, hi in bands:
            free = not any(it[1].x1 < x1 - 120 * k and it[1].x1 > new_left - 50 * k and it[1].y1 > lo - 50 * k and it[1].y0 < hi + 50 * k for it in allit)
            if not free: continue
            fy0, fy1 = (lo, lo + dpt * k) if kind == 'below' else (hi - dpt * k, hi)       # передняя кромка — ближе к фасаду
            pen.rect(a, fy0, b, fy1)
            pen.text((a + b) / 2, (fy0 + fy1) / 2 + fs * 0.3, short, fs * 0.9)
            plan_drawn = True
        x = b
    if rv:                                                                         # вид сзади: ближе к ПЧ — байпас, дальше реактор
        xr = rv['rr']
        for c in reversed(order):
            w, dpt, h = spec[c]
            pen.place(TR, TRB, pymupdf.Rect(xr, rv['rbase'] - h * k, xr + w * k, rv['rbase']))
            pen.text(xr + w * k / 2, rv['rbase'] - h * k - fs * 0.5, NAMES[c][0], fs * 0.8)
            xr += w * k
    hmax = max(spec[c][2] for c in order)
    pen.vdim(new_left, new_left - fs * 3.2, base_y, base_y - hmax * k, str(round(hmax)))
    tot = g['W'] + total_add

    def busy(yl):
        return any(it[1].x1 > new_left and it[1].x0 < x2 and it[1].y1 > yl - fs * 1.6 and it[1].y0 < yl + fs * 1.3 for it in allit)
    yt = next((g['ydim'] + fs * m for m in (3.2, 2.6, 2.2) if not busy(g['ydim'] + fs * m)), g['ydim'] + fs * 2.2)
    pen.hdim(new_left, x2, base_y, yt, f'{tot} (общая длина)')

    # расшифровка и габариты доп. шкафов — под чертежом слева
    every = pen.boxes + placed
    ylow = max(r.y1 for r in every)
    notes = []
    if plan_drawn:
        notes.append('; '.join(f'{NAMES[c][1]} — {NAMES[c][2]}' for c in order))
    if 'R' in order:
        other = ' и '.join(NAMES[c][2] for c in order if c != 'R')
        notes.append('Шкаф реактора: {}×{}×{} мм (Ш×Г×В)'.format(*REACTOR) +
                     (f'; {other}: ширина 800 мм, глубина и высота — как у ПЧ' if other else ''))
    for i, n in enumerate(notes):
        pen.text(new_left, ylow + fs * (1.8 + 1.4 * i), n, fs * 0.9, anchor='start')

    pen.done()
    allb = pen.boxes + placed
    r = pymupdf.Rect(allb[0])
    for b in allb[1:]: r |= b
    pad = 0.03 * max(r.width, r.height)
    r += (-pad, -pad, pad, pad)
    s = SHEET_W / r.width
    out = pymupdf.open()
    op = out.new_page(width=SHEET_W, height=r.height * s)
    op.show_pdf_page(op.rect, canvas, 0, clip=r + (ox, oy, ox, oy))
    op.draw_rect(op.rect, color=(0, 0, 0), width=SHEET_W / 1500)
    out.subset_fonts()                                                          # только нужные буквы шрифта
    out.save(out_pdf, garbage=4, deflate=True)
    print(os.path.basename(out_pdf), 'добавлено', order, 'общая длина', tot, 'виды в плане:', [b[0] for b in bands], 'план нарисован' if plan_drawn else '')


if __name__ == '__main__':
    compose(sys.argv[1], sys.argv[2], sys.argv[3])
