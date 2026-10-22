"""Лист корпуса G1 (ME800-R, плёночные ячейки, мощности вне компактного корпуса) из out_r/R_G1.svg.
   python3 g1.py <ширина ПЧ> <высота с вентиляторами> <0|B> [--extras]
   Подписи габаритов берутся из руководства по эксплуатации (ширина/высота), геометрия — заводской лист MF5000-G1 (2450 мм).
   0 — без шкафа байпаса (шкаф 650 мм и его размеры/выноски убираются), B — с шкафом байпаса.
   --extras — лист будет дополнен шкафами (compose_r): общий размер остаётся цепочкой без подписи «общая длина».
   Результат: out_r/R_G1_<W>_<H>_<0|B>.svg + .dims.json"""
import sys, json, re
from compose_r import item_box

BYP = (4265, 4925)          # шкаф байпаса на фасаде и в плане (x, единицы листа)
SIDE_R = 3300               # правее — уже не боковой вид
FRONT_Y = (5250, 7500)      # полоса фасада и вида сзади (без вентиляторов)

def drop_dim(lines, text):
    """Убрать размер по подписи: текст и идущие перед ним пути (выносные, размерная линия, стрелки)."""
    out, i = [], 0
    idx = [k for k, l in enumerate(lines) if l.startswith('<text') and re.search(r'>' + re.escape(text) + r'</text>', l)]
    kill = set()
    for k in idx:
        kill.add(k); j = k - 1
        while j >= 0 and lines[j].startswith('<path') and k - j <= 5: kill.add(j); j -= 1
    return [l for k, l in enumerate(lines) if k not in kill]

def relabel(lines, old, new):
    return [re.sub(r'>' + re.escape(old) + r'</text>', '>' + new + '</text>', l) if l.startswith('<text') else l for l in lines]

def main(W, H, byp, extras):
    src = open('out_r/R_G1.svg').read().split('\n')
    meta = json.load(open('out_r/R_G1.dims.json'))
    head, body = src[:3], [l for l in src[3:] if l.startswith('<path') or l.startswith('<text')]
    dims = meta['dims']
    if byp == '0':
        # фасад и планы: всё, что целиком в пределах шкафа байпаса (и размеры левее него)
        def in_byp(b): return b[0] >= SIDE_R and b[2] <= BYP[1] - 3       # стенка на границе с ПЧ (x≈4920) — это боковая линия самого ПЧ, оставляем
        # вид сзади: шкаф байпаса — крайний справа
        rear = [item_box(l) for l in body if l.startswith('<path')]
        rear = [b for b in rear if b and b[0] > 11000 and FRONT_Y[0] <= b[1] and b[3] <= FRONT_Y[1]]
        rr = max(b[2] for b in rear)
        def in_rear(b): return b[0] >= rr - 680 and b[2] <= rr + 3 and b[1] >= FRONT_Y[0] - 150 and b[3] <= FRONT_Y[1]
        # глубина на виде сверху (1519.5 / 1349.5) — была у левого края шкафа байпаса; переносим к левому краю ПЧ
        from compose_r import shift
        moved = []
        for txt in ('1519.5', '1349.5'):
            k = next((i for i, l in enumerate(body) if l.startswith('<text') and '>' + txt + '</text>' in l), None)
            if k is None: continue
            j = k - 1
            while j >= 0 and body[j].startswith('<path') and k - j <= 5: j -= 1
            moved += [shift(l, BYP[1] - BYP[0] + 5) for l in body[j + 1:k + 1]]
        keep = []
        for l in body:
            b = item_box(l)
            if l.startswith('<text') and re.search(r'вход/выход ВН|шкаф байпаса', l): continue   # выноски к вводам ВН — они в шкафу байпаса
            if b and l.startswith('<path') and (in_byp(b) or in_rear(b)): continue
            if b and l.startswith('<path') and 'fill="#000"' in l and b[0] >= SIDE_R and b[2] <= BYP[1] + 3: continue   # стрелки убранных размеров
            if b and l.startswith('<text') and in_byp(b) and re.search(r'>[\d.]+<', l): continue
            keep.append(l)
        body = drop_dim(keep, '(3100)') + moved
        dims = [d for d in dims if not (min(d['x1'][0], d['x2'][0]) >= SIDE_R - 800 and max(d['x1'][0], d['x2'][0]) <= BYP[1] + 3) and d['text'] != '(3100)']
        if W != 2450: body = drop_dim(body, '2266')
    else:
        tot = W + 650
        body = relabel(body, '(3100)', str(tot) if extras else f'{tot} (общая длина)')
        for d in dims:
            if d['text'] == '(3100)': d['text'] = str(tot)
        if W != 2450: body = drop_dim(body, '2266')
    body = relabel(body, '2450 (ПЧ)', f'{W} (ПЧ)'); body = relabel(body, '2450', str(W))
    body = relabel(body, '2537.5', str(H))
    for d in dims:
        if d['text'] == '2450(变频器)': d['text'] = f'{W}(ПЧ)'
    body = relabel(body, '650 (шкаф байпаса)', '650 (байпас)')
    if W != 2450:                                                     # раздельное исполнение: вид по листу 2450 мм — уточняется
        allb = [item_box(l) for l in body if item_box(l)]
        x0, y0, x1 = min(b[0] for b in allb), min(b[1] for b in allb), max(b[2] for b in allb)
        body.append(f'<text x="{(x0 + x1) / 2:.0f}" y="{-(y0 - 250):.0f}" font-size="120" font-family="Arial, Helvetica, sans-serif" text-anchor="middle">'
                    f'Внешний вид будет уточнён перед заказом.</text>')
    name = f'R_G1_{W}_{H}_{byp}'
    # рамка листа — по содержимому
    allb = [item_box(l) for l in body if item_box(l)]
    bx0, by0, bx1, by1 = min(b[0] for b in allb), min(b[1] for b in allb), max(b[2] for b in allb), max(b[3] for b in allb)
    pad = 0.03 * max(bx1 - bx0, by1 - by0); bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad
    w, h = bx1 - bx0, by1 - by0
    svg = re.sub(r'viewBox="[^"]+" width="\d+" height="\d+"', f'viewBox="{bx0:.1f} {-by1:.1f} {w:.1f} {h:.1f}" width="{w / h * 800:.0f}" height="800"', head[0])
    rect = f'<rect x="{bx0:.1f}" y="{-by1:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#fff" stroke="#000" stroke-width="{w / 1500:.2f}"/>'
    open(f'out_r/{name}.svg', 'w').write('\n'.join([svg, head[1], rect] + body + ['</svg>']))
    json.dump({'dims': dims, 'view': [bx0, by0, bx1, by1]}, open(f'out_r/{name}.dims.json', 'w'), ensure_ascii=False)
    print(name)

if __name__ == '__main__':
    main(int(sys.argv[1]), sys.argv[2], sys.argv[3], '--extras' in sys.argv)
