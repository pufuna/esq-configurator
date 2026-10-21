"""DWG (JSON от LibreDWG dwgread -O json) → SVG.
   python3 render.py json_XX.json out.svg [--space model|paper] [--bbox x0,y0,x1,y1] [--no-text]
   Рисует пространство модели (или первый лист), разворачивает вставки блоков и размеры."""
import json, math, sys, re, html

def load(path):
    raw = open(path, 'rb').read()
    try: txt = raw.decode('utf-8')
    except UnicodeDecodeError: txt = raw.decode('utf-8', 'surrogateescape')
    txt = re.sub(r'(?<=[\[ ,:])-?nan(?=[ ,\]\n])', '0', txt)
    txt = re.sub(r'(?<=[\[ ,:])-?inf(?=[ ,\]\n])', '0', txt)
    return json.loads(txt, strict=False)

def fix_text(s):
    if not isinstance(s, str): return ''
    if any(0xdc80 <= ord(c) <= 0xdcff for c in s):               # байты не-UTF-8 — пробуем GBK
        b = s.encode('utf-8', 'surrogateescape')
        cands = []
        for enc in ('gbk', 'cp1251', 'utf-8'):
            try: t = b.decode(enc, 'replace'); cands.append((t.count('\ufffd'), t))
            except Exception: pass
        s = min(cands)[1]
    s = re.sub(r'\\U\+([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), s)
    return s

def mtext_plain(s):
    s = fix_text(s)
    s = s.replace('\\P', '\n').replace('\\~', ' ')
    s = re.sub(r'\\S([^;]*?)[#^/]([^;]*?);', r'\1/\2', s)          # дроби/допуски
    s = re.sub(r"\\[Ff][^;]*;", "", s)
    s = re.sub(r'\\[ACFHQTWfcpL][^;\\]*;', '', s)
    s = re.sub(r'\\[LlOoKk]', '', s)
    s = s.replace('{', '').replace('}', '')
    s = s.replace('%%c', 'Ø').replace('%%C', 'Ø').replace('%%d', '°').replace('%%D', '°').replace('%%p', '±').replace('%%P', '±')
    return s

class R:
    def __init__(self, d, no_text=False):
        self.no_text = no_text
        self.by = {}
        for o in d['OBJECTS']:
            h = o.get('handle')
            if h: self.by[h[2]] = o
        self.blocks = {o['name']: o for o in d['OBJECTS'] if o.get('object') == 'BLOCK_HEADER'}
        self.bh = {o['handle'][2]: o for o in d['OBJECTS'] if o.get('object') == 'BLOCK_HEADER' and o.get('handle')}
        self.ents = {}; self.multi = {}
        for o in d['OBJECTS']:
            if o.get('entity') and o.get('handle'):
                h = o['handle'][2]; self.multi.setdefault(h, []).append(o)
                self.ents.setdefault(h, o)
        self.multi_obj = {}
        for o in d['OBJECTS']:
            if o.get('object') and o.get('handle'): self.multi_obj.setdefault(o['handle'][2], []).append(o)
        self.bhmulti = {}
        for o in d['OBJECTS']:
            if o.get('object') == 'BLOCK_HEADER' and o.get('handle'): self.bhmulti.setdefault(o['handle'][2], []).append(o)
        self.layers = {}
        for o in d['OBJECTS']:
            if o.get('object') == 'LAYER':
                c = o.get('color', {}); idx = c.get('index', 7) if isinstance(c, dict) else 7
                off = (isinstance(idx, int) and idx < 0) or bool(o.get('off')) or bool((o.get('flag0', 0) or 0) & 1)  # frozen
                self.layers[o['handle'][2]] = {'name': fix_text(o.get('name', '')), 'off': off}
        # старые форматы (R2000/R2004): у BLOCK_HEADER нет списка entities — собираем по владельцу / entmode
        self.owned = {}; self.model = []
        SKIP = {'VERTEX_2D', 'VERTEX_3D', 'ATTRIB', 'SEQEND', 'BLOCK', 'ENDBLK'}
        for o in d['OBJECTS']:
            t = o.get('entity')
            if not t or t in SKIP: continue
            if o.get('entmode') == 2: self.model.append(o)
            elif o.get('entmode') == 1: pass                                  # пространство листа
            else:
                oh = o.get('ownerhandle')
                if oh: self.owned.setdefault(oh[-1], []).append(o)
        self.out = []; self.ext = [1e18, 1e18, -1e18, -1e18]; self.depth = 0
        self.texts = []

    def layer_off(self, e):
        l = e.get('layer')
        return bool(l and len(l) > 2 and self.layers.get(l[-1], {}).get('off'))

    # --- геометрия ---
    def tp(self, M, p):
        x, y = p[0], p[1]
        return (M[0] * x + M[1] * y + M[2], M[3] * x + M[4] * y + M[5])
    def grow(self, pts):
        for x, y in pts:
            if abs(x) > 1e9 or abs(y) > 1e9: continue
            self.ext[0] = min(self.ext[0], x); self.ext[1] = min(self.ext[1], y)
            self.ext[2] = max(self.ext[2], x); self.ext[3] = max(self.ext[3], y)
    def poly(self, M, pts, closed=False, w=0.25, fill=None):
        P = [self.tp(M, p) for p in pts]
        if len(P) < 2: return
        self.grow(P)
        d = 'M' + ' L'.join(f'{x:.2f},{-y:.2f}' for x, y in P) + (' Z' if closed else '')
        self.out.append(f'<path d="{d}" fill="{fill or "none"}" stroke="#000" stroke-width="{w}"/>')
    def arcpts(self, c, r, a0, a1, n=None):
        while a1 < a0: a1 += 2 * math.pi
        n = n or max(8, int((a1 - a0) / (math.pi / 36)))
        return [(c[0] + r * math.cos(a0 + (a1 - a0) * i / n), c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

    def bspline(self, ctrl, knots, deg, n=60):
        if not knots or len(ctrl) <= deg: return ctrl
        t0, t1 = knots[deg], knots[len(knots) - deg - 1]
        out = []
        for i in range(n + 1):
            t = t0 + (t1 - t0) * i / n
            k = deg
            while k < len(knots) - deg - 2 and t >= knots[k + 1]: k += 1
            dpts = [list(ctrl[j][:2]) for j in range(k - deg, k + 1)]
            for r in range(1, deg + 1):
                for j in range(deg, r - 1, -1):
                    a_den = knots[j + 1 + k - r] - knots[j + k - deg]
                    a = 0 if a_den == 0 else (t - knots[j + k - deg]) / a_den
                    dpts[j] = [(1 - a) * dpts[j - 1][0] + a * dpts[j][0], (1 - a) * dpts[j - 1][1] + a * dpts[j][1]]
            out.append(tuple(dpts[deg]))
        return out

    def text(self, M, ins, h, rot, s, align='start'):
        if self.no_text or not s.strip(): return
        x, y = self.tp(M, ins)
        sc = math.hypot(M[0], M[3]); hh = h * sc
        ang = rot + math.atan2(M[3], M[0])
        if hh <= 0: return
        lines = s.split('\n')
        self.grow([(x, y)])
        self.texts.append((x, y, s))
        for i, ln in enumerate(lines):
            yy = -y + i * hh * 1.5
            self.out.append(f'<text x="{x:.2f}" y="{yy:.2f}" font-size="{hh:.2f}" font-family="Arial, Helvetica, sans-serif" text-anchor="{align}" '
                            f'transform="rotate({-math.degrees(ang):.2f} {x:.2f} {-y:.2f})">{html.escape(ln)}</text>')

    # --- объекты ---
    def ent(self, e, M):
        if not e or e.get('invisible') or self.layer_off(e): return
        t = e.get('entity')
        if t == 'LINE': self.poly(M, [e['start'], e['end']])
        elif t == 'CIRCLE': self.poly(M, self.arcpts(e['center'], e['radius'], 0, 2 * math.pi, 72), True)
        elif t == 'ARC': self.poly(M, self.arcpts(e['center'], e['radius'], e['start_angle'], e['end_angle']))
        elif t == 'ELLIPSE':
            c, ax, ratio = e['center'], e['sm_axis'], e['axis_ratio']
            a0, a1 = e['start_angle'], e['end_angle']
            while a1 <= a0: a1 += 2 * math.pi
            bx, by = -ax[1] * ratio, ax[0] * ratio
            pts = [(c[0] + ax[0] * math.cos(a) + bx * math.sin(a), c[1] + ax[1] * math.cos(a) + by * math.sin(a))
                   for a in [a0 + (a1 - a0) * i / 72 for i in range(73)]]
            self.poly(M, pts)
        elif t == 'LWPOLYLINE':
            pts = e.get('points') or []; bul = e.get('bulges') or []
            closed = bool((e.get('flag', 0) or 0) & 512) or bool((e.get('flag', 0) or 0) & 1)
            out = []
            n = len(pts)
            for i in range(n if closed else n - 1):
                p, q = pts[i], pts[(i + 1) % n]
                b = bul[i] if i < len(bul) else 0
                out.append(p)
                if b:
                    th = 4 * math.atan(b); ch = math.dist(p, q)
                    if ch > 0:
                        r = ch / (2 * math.sin(th / 2)); mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
                        dx, dy = (q[0] - p[0]) / ch, (q[1] - p[1]) / ch
                        hdist = r * math.cos(th / 2)
                        cx, cy = mx - dy * hdist, my + dx * hdist
                        a0 = math.atan2(p[1] - cy, p[0] - cx); a1 = math.atan2(q[1] - cy, q[0] - cx)
                        if b < 0: a0, a1 = a1, a0
                        ap = self.arcpts((cx, cy), abs(r), a0, a1)
                        if b < 0: ap = ap[::-1]
                        out += ap[1:-1]
            if pts: out.append(pts[-1] if not closed else pts[0])
            self.poly(M, out)
        elif t in ('POLYLINE_2D', 'POLYLINE_3D'):
            vs = [self.by.get(h[3] if len(h) > 3 else h[2]) for h in (e.get('vertex') or [])]
            pts = [v['point'] for v in vs if v and 'point' in v]
            self.poly(M, pts, bool((e.get('flag', 0) or 0) & 1))
        elif t == 'SPLINE':
            P2 = lambda p: (p['x'], p['y']) if isinstance(p, dict) else tuple(p[:2])
            if e.get('ctrl_pts'): pts = self.bspline([P2(p) for p in e['ctrl_pts']], e.get('knots') or [], e.get('degree', 3))
            else: pts = [P2(p) for p in (e.get('fit_pts') or [])]
            self.poly(M, pts)
        elif t in ('SOLID', 'TRACE'):
            c = [e.get(k) for k in ('corner1', 'corner2', 'corner4', 'corner3')]
            if all(c): self.poly(M, c, True, 0.1, '#000')
        elif t == 'LEADER':
            self.poly(M, [p[:2] for p in (e.get('points') or [])])
        elif t == 'TEXT':
            al = {0: 'start', 1: 'middle', 2: 'end', 4: 'middle'}.get(e.get('horiz_alignment', 0), 'start')
            pt = e.get('alignment_pt') if al != 'start' and e.get('alignment_pt') else e.get('ins_pt')
            self.text(M, pt, e.get('height', 2.5), e.get('rotation', 0), mtext_plain(e.get('text_value', '')), al)
        elif t == 'MTEXT':
            xd = e.get('x_axis_dir', [1, 0, 0]); rot = math.atan2(xd[1], xd[0])
            att = e.get('attachment', 1); al = {1: 'start', 2: 'middle', 3: 'end'}[(att - 1) % 3 + 1]
            h = e.get('text_height', 2.5); ins = list(e['ins_pt'])
            ins[1] -= h * (0.8 if att <= 3 else (-0.0 if att <= 6 else -0.0))
            self.text(M, ins, h, rot, mtext_plain(e.get('text', '')), al)
        elif t == 'INSERT' or t == 'MINSERT':
            bh = e.get('block_header'); b = self.bh.get(bh[3] if bh and len(bh) > 3 else (bh[2] if bh else None))
            if b and self.depth < 12:
                s = e.get('scale', [1, 1, 1]); r = e.get('rotation', 0); ip = e['ins_pt']; bp = b.get('base_pt', [0, 0, 0])
                c, sn = math.cos(r), math.sin(r)
                L = [s[0] * c, -s[1] * sn, 0, s[0] * sn, s[1] * c, 0]
                L[2] = ip[0] - (L[0] * bp[0] + L[1] * bp[1]); L[5] = ip[1] - (L[3] * bp[0] + L[4] * bp[1])
                N = [M[0] * L[0] + M[1] * L[3], M[0] * L[1] + M[1] * L[4], M[0] * L[2] + M[1] * L[5] + M[2],
                     M[3] * L[0] + M[4] * L[3], M[3] * L[1] + M[4] * L[4], M[3] * L[2] + M[4] * L[5] + M[5]]
                self.depth += 1; self.block(b, N); self.depth -= 1
            for ah in (e.get('attribs') or []):
                a = self.by.get(ah[3] if len(ah) > 3 else ah[2])
                if a: self.text(M, a.get('ins_pt'), a.get('height', 2.5), a.get('rotation', 0), mtext_plain(a.get('text_value', '')))
        elif t in ('DIMENSION_LINEAR', 'DIMENSION_ALIGNED', 'DIMENSION_DIAMETER', 'DIMENSION_RADIUS'):
            self.dim(e, M)
        elif t and t.startswith('DIMENSION'):
            bh = e.get('block'); b = self.bh.get(bh[3] if bh and len(bh) > 3 else (bh[2] if bh else None))
            if b: self.depth += 1; self.block(b, M); self.depth -= 1
        elif t == 'HATCH':
            if e.get('is_solid_fill'):
                for path in (e.get('paths') or []):
                    pts = [s.get('point') or s.get('start') for s in (path.get('polyline_paths') or path.get('segs') or []) if (s.get('point') or s.get('start'))]
                    if len(pts) > 2: self.poly(M, [p[:2] for p in pts], True, 0.05, '#000')

    @staticmethod
    def ref(h, base):
        """Абсолютный номер объекта из ссылки DWG [код, размер, значение, ...] относительно base."""
        if not h or len(h) < 3: return None
        c, v = h[0], h[2]
        if c in (2, 3, 4, 5): return v
        if c == 6: return base + 1
        if c == 8: return base - 1
        if c == 10: return base + v
        if c == 12: return base - v
        return h[-1]
    def chain(self, b):
        """Объекты блока по цепочке first_entity → next_entity (форматы R2000/R2004)."""
        fe, le = b.get('first_entity'), b.get('last_entity')
        if not fe or fe[2] == 0: return []
        cur, end, out, seen = self.ref(fe, b['handle'][2]), self.ref(le, b['handle'][2]), [], set()
        last_idx = b.get('index', 0)
        while cur and cur not in seen and len(out) < 2000000:
            seen.add(cur)
            cands = self.multi.get(cur) or []
            if not cands: break
            # при повторяющихся номерах берём объект, идущий в файле после предыдущего (ближайший)
            after = [c for c in cands if c.get('index', 0) > last_idx]
            e = min(after, key=lambda c: c['index']) if after else cands[0]
            last_idx = e.get('index', last_idx)
            out.append(e)
            if cur == end: break
            ne = e.get('next_entity')
            cur = self.ref(ne, cur) if ne and ne[2] != 0 or (ne and ne[0] in (6, 8)) else cur + 1
        return out
    # --- размеры рисуем сами по точкам размера (блоки размеров в части файлов перепутаны) ---
    DIMCODES = {40: 'DIMSCALE', 41: 'DIMASZ', 42: 'DIMEXO', 44: 'DIMEXE', 140: 'DIMTXT', 147: 'DIMGAP', 77: 'DIMTAD'}
    def dimstyle(self, e):
        st = {'DIMSCALE': 1.0, 'DIMTXT': 2.5, 'DIMASZ': 2.5, 'DIMEXO': 0.625, 'DIMEXE': 1.25, 'DIMGAP': 0.625, 'DIMTAD': 1}
        h = e.get('dimstyle')
        o = None
        if h:
            for c in self.multi_obj.get(h[-1], []):
                if c.get('object') == 'DIMSTYLE': o = c
        if o:
            for k in st:
                if isinstance(o.get(k), (int, float)): st[k] = o[k]
        eed = e.get('eed') or []
        for i, x in enumerate(eed):                                     # переопределения стиля в DSTYLE
            if x.get('code') == 70 and x.get('value') in self.DIMCODES and i + 1 < len(eed):
                v = eed[i + 1].get('value')
                if isinstance(v, (int, float)): st[self.DIMCODES[x['value']]] = v
        sc = st['DIMSCALE'] or 1.0
        return {k: (v * sc if k not in ('DIMSCALE', 'DIMTAD') else v) for k, v in st.items()}
    def dimtext(self, e):
        m = e.get('act_measurement', 0) or 0
        num = f'{m:.1f}'.rstrip('0').rstrip('.') if abs(m - round(m)) > 0.05 else str(int(round(m)))
        if e.get('entity') == 'DIMENSION_DIAMETER': num = 'Ø' + num
        if e.get('entity') == 'DIMENSION_RADIUS': num = 'R' + num
        ut = e.get('user_text') or ''
        if ut == ' ': return ''
        return mtext_plain(ut.replace('<>', num)) if ut else num
    def arrow(self, M, tip, ux, uy, L):
        w = L / 6
        pts = [tip, (tip[0] - ux * L - uy * w, tip[1] - uy * L + ux * w), (tip[0] - ux * L + uy * w, tip[1] - uy * L - ux * w)]
        self.poly(M, pts, True, 0.05, '#000')
    def dim(self, e, M):
        st = self.dimstyle(e); t = e['entity']
        txt = self.dimtext(e); h = st['DIMTXT']
        if t in ('DIMENSION_LINEAR', 'DIMENSION_ALIGNED'):
            p1, p2, dp = e['xline1_pt'][:2], e['xline2_pt'][:2], e['def_pt'][:2]
            a = e.get('dim_rotation', 0) if t == 'DIMENSION_LINEAR' else math.atan2(p2[1] - p1[1], p2[0] - p1[0])
            ux, uy = math.cos(a), math.sin(a)
            proj = lambda p: (dp[0] + ux * ((p[0] - dp[0]) * ux + (p[1] - dp[1]) * uy), dp[1] + uy * ((p[0] - dp[0]) * ux + (p[1] - dp[1]) * uy))
            q1, q2 = proj(p1), proj(p2)
            for p, q in ((p1, q1), (p2, q2)):
                L = math.dist(p, q)
                if L > 1e-6:
                    vx, vy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
                    self.poly(M, [(p[0] + vx * st['DIMEXO'], p[1] + vy * st['DIMEXO']), (q[0] + vx * st['DIMEXE'], q[1] + vy * st['DIMEXE'])])
            self.poly(M, [q1, q2])
            L = math.dist(q1, q2)
            if L > 1e-6:
                vx, vy = (q2[0] - q1[0]) / L, (q2[1] - q1[1]) / L
                self.arrow(M, q2, vx, vy, st['DIMASZ']); self.arrow(M, q1, -vx, -vy, st['DIMASZ'])
            ang = a
        else:                                                           # диаметр / радиус
            p, q = e['def_pt'][:2], (e.get('first_arc_pt') or e['def_pt'])[:2]
            mid = e.get('text_midpt') or q
            self.poly(M, [p, q]); self.poly(M, [q, mid[:2]])
            L = math.dist(p, q)
            if L > 1e-6: self.arrow(M, q, (q[0] - p[0]) / L, (q[1] - p[1]) / L, st['DIMASZ'])
            ang = 0
        if not txt: return
        tr = e.get('text_rotation') or 0
        ang = tr if tr else ang
        ang = ang % (2 * math.pi)
        if math.pi / 2 + 1e-6 < ang <= 3 * math.pi / 2 + 1e-6: ang -= math.pi          # текст не вверх ногами
        mx, my = e.get('text_midpt', e['def_pt'])[:2]
        nx, ny = -math.sin(ang), math.cos(ang)
        if t in ('DIMENSION_LINEAR', 'DIMENSION_ALIGNED'):
            # текст «над линией» (DIMTAD=1): если точка текста лежит на размерной линии — поднимаем на полвысоты + зазор
            lx, ly = -math.sin(a), math.cos(a)
            dist = (mx - dp[0]) * lx + (my - dp[1]) * ly
            if abs(dist) < h * 0.6:
                off = h * 0.5 + max(st['DIMGAP'], h * 0.15) - dist * (lx * nx + ly * ny)
                mx, my = mx + nx * off, my + ny * off
        base = (mx - nx * h * 0.35, my - ny * h * 0.35)                 # text_midpt — середина текста
        self.text(M, base, h, ang, txt, 'middle')

    def block(self, b, M):
        if b.get('entities'):
            for h in b['entities']: self.ent(self.ents.get(h[3] if len(h) > 3 else h[2]), M)
        elif b.get('name') == '*Model_Space':
            for e in self.model: self.ent(e, M)
        else:
            for e in (self.chain(b) or self.owned.get(b['handle'][2], [])): self.ent(e, M)

    def svg(self, pad=0.02, bbox=None):
        x0, y0, x1, y1 = bbox or self.ext
        w, h = x1 - x0, y1 - y0; px, py = w * pad, h * pad
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - px:.1f} {-y1 - py:.1f} {w + 2 * px:.1f} {h + 2 * py:.1f}" '
                f'stroke-linecap="round" stroke-linejoin="round">\n<style>path{{vector-effect:non-scaling-stroke;stroke-width:0.7px}}</style>\n<rect x="{x0 - px:.1f}" y="{-y1 - py:.1f}" width="{w + 2 * px:.1f}" height="{h + 2 * py:.1f}" fill="#fff"/>\n'
                + '\n'.join(self.out) + '\n</svg>')

if __name__ == '__main__':
    a = sys.argv[1:]
    d = load(a[0]); r = R(d, '--no-text' in a)
    space = '*Paper_Space' if '--space' in a and a[a.index('--space') + 1] == 'paper' else '*Model_Space'
    r.block(r.blocks[space], [1, 0, 0, 0, 1, 0])
    bbox = None
    if '--bbox' in a: bbox = [float(v) for v in a[a.index('--bbox') + 1].split(',')]
    open(a[1], 'w').write(r.svg(bbox=bbox))
    print('extents', [round(v) for v in r.ext], 'paths', len(r.out), 'texts', len(r.texts))
    json.dump(r.texts, open(a[1] + '.texts.json', 'w'), ensure_ascii=False)
