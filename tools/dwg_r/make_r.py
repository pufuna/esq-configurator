"""Габаритные чертежи ESQ F ME800-R из DWG производителя → чистые листы (только виды и размеры, подписи по-русски).
   python3 make_r.py <ключ_файла> <имя_выхода> [номер_листа]
   Результат: out_r/<имя>.svg (дальше — в PDF через Chrome)."""
import sys, json, re, math, html
from render import load, R

TR = {                                                              # перевод надписей (точное совпадение)
    '控制柜': 'Шкаф упр.', '单元柜': 'Шкаф ячеек', '变压器柜': 'Шкаф тр-ра', '旁路柜': 'Шкаф байпаса',
    '风机出风方向朝后': 'Выход воздуха — назад', '焊接螺母M6': 'Гайка приварная M6', '风机出风口固定螺钉M8*L': 'Крепление выхода вентилятора — винты M8',
    '560风机': 'Вентилятор 560', '1个560风机': 'Вентилятор 560', '2个560风机': 'Вентиляторы 560, 2 шт.', '3个560风机': 'Вентиляторы 560, 3 шт.',
    '2个450风机': 'Вентиляторы 450, 2 шт.', '1个500风机': 'Вентилятор 500',
    '1个500风机(风机罩外形尺寸同560)': 'Вентилятор 500 (кожух как у 560)', '1个500风机(风机罩外形尺寸同560风机罩)': 'Вентилятор 500 (кожух как у 560)',
    '上进上出时：低压控制进线位置示意': 'Ввод сверху: ввод цепей управления', '上进上出时：高压输入/输出位置示意': 'Ввод сверху: вход/выход ВН',
    '上进上出时：高压输入位置示意': 'Ввод сверху: вход ВН', '上进上出时：高压输出位置示意': 'Ввод сверху: выход ВН',
    '下进下出时：低压控制进线位置示意': 'Ввод снизу: ввод цепей управления', '下进下出时：高压输入/输出位置示意': 'Ввод снизу: вход/выход ВН',
    '下进下出时：高压输入位置示意': 'Ввод снизу: вход ВН', '下进下出时：高压输出位置示意': 'Ввод снизу: выход ВН',
    '注：高低压进线孔在柜体顶部和底部都有开孔，用户可自行选择': 'Отверстия для кабелей ВН и цепей управления есть в крыше и в основании шкафов — ввод сверху или снизу по выбору заказчика.',
    # надписи на дверях (мелкие)
    '控制电源': 'Питание упр.', '故障': 'Авария', '运行': 'Работа', '复位': 'Сброс', '急停': 'Аварийный стоп', '开': 'Вкл', '关': 'Откл',
    '本地/远程': 'Местн./дист.', '手动/自动': 'Ручн./авт.', '温控仪': 'Терморегулятор', '电源指示': 'Питание', '高压电源': 'Высокое напряжение',
    '高压带电显示器': 'Индикатор наличия ВН', '工频合闸': 'Вкл. от сети', '变频进线合闸': 'Вкл. вход ПЧ', '变频出线合闸': 'Вкл. выход ПЧ',
}
SUFFIX = {'(底座槽钢)': ' (основание)', '(变频器)': ' (ПЧ)', '(开口)': ' (проём)', '（开口）': ' (проём)'}

def translate(s):
    s0 = s.strip()
    if s0 in TR: return TR[s0]
    if s0.startswith('注：') and '高低压进线孔' in s0:              # примечание с «применимостью» — оставляем только про кабели
        return TR['注：高低压进线孔在柜体顶部和底部都有开孔，用户可自行选择']
    for k, v in SUFFIX.items():
        if s0.endswith(k): return s0[:-len(k)] + v
    if re.search(r'[一-鿿]', s0): return None                # прочий китайский текст (штамп, предупреждения) — убираем
    if re.search(r'WARNING|warning|Only qualified', s0): return None
    return s

class RR(R):
    dims_log = []
    def dim(self, e, M):
        t = e['entity']
        if t in ('DIMENSION_LINEAR', 'DIMENSION_ALIGNED') and self.depth == 0:
            self.dims_log.append({'m': e.get('act_measurement', 0), 'text': self.dimtext(e), 'x1': list(self.tp(M, e['xline1_pt'])), 'x2': list(self.tp(M, e['xline2_pt'])),
                                  'dp': list(self.tp(M, e['def_pt'])), 'rot': e.get('dim_rotation', 0) if t == 'DIMENSION_LINEAR' else None})
        super().dim(e, M)
    def text(self, M, ins, h, rot, s, align='start'):
        t = translate(s)
        if t:
            if t.startswith('Отверстия для кабелей'):                  # длинное примечание — в две строки
                t = 'Примечание: отверстия для кабелей ВН и цепей управления есть в крыше\nи в основании шкафов — ввод сверху или снизу по выбору заказчика.'
            super().text(M, ins, h, rot, t, align)

def coords(item):
    if item.startswith('<text'):                                     # текст: левый и правый край по оценке ширины
        m = re.search(r'x="([-\d.]+)" y="([-\d.]+)" font-size="([\d.]+)"[^>]*text-anchor="(\w+)"', item)
        x, y, fs, an = float(m.group(1)), -float(m.group(2)), float(m.group(3)), m.group(4)
        w = len(re.sub(r'<[^>]+>', '', item.split('>', 1)[1])) * fs * 0.52
        a = {'start': 0, 'middle': -w / 2, 'end': -w}[an]
        if 'rotate(-90' in item or 'rotate(90' in item or 'rotate(270' in item: return [(x, y), (x, y + w)]
        return [(x + a, y), (x + a + w, y + fs)]
    nums = [float(v) for v in re.findall(r'-?\d+\.?\d*', item.split('"')[1])] if item.startswith('<path') else None
    if nums is None:
        m = re.search(r'x="([-\d.]+)" y="([-\d.]+)"', item); return [(float(m.group(1)), -float(m.group(2)))]
    return [(nums[i], -nums[i + 1]) for i in range(0, len(nums) - 1, 2)]

def main(key, name, sheet=1):
    info = json.load(open(f'out/{key}_s{sheet}.json')); x0, y0, x1, y1 = info['bbox']; W, H = x1 - x0, y1 - y0
    d = load(f'json_{key}.json'); r = RR(d); r.block(r.blocks['*Model_Space'], [1, 0, 0, 0, 1, 0])
    # штамп и таблица изменений: по положению известных надписей исходного листа (их тексты — в r0)
    r0 = R(d); r0.block(r0.blocks['*Model_Space'], [1, 0, 0, 0, 1, 0])
    pos = lambda pat: [(x, y) for x, y, s in r0.texts if x0 <= x <= x1 and y0 <= y <= y1 and re.search(pat, s)]
    sj, cl = pos(r'^\s*设\s*计\s*$'), pos(r'^\s*材料\s*$'); rev = pos(r'^\s*修订')
    ex = []
    # штамп — буквой «Г»: нижняя полоса (от «设计») и правая часть (от «材料»)
    if sj: ex.append((min(p[0] for p in sj) - 0.012 * W, y0, x1, max(p[1] for p in sj) + 0.02 * H))
    if cl: ex.append((min(p[0] for p in cl) - 0.012 * W, y0, x1, max(p[1] for p in cl) + 0.02 * H))
    if rev: ex.append((min(p[0] for p in rev) - 0.22 * W, min(p[1] for p in rev) - 0.05 * H, x1, y1))
    ix0, iy0, ix1, iy1 = x0 + 0.04 * W, y0 + 0.035 * H, x1 - 0.04 * W, y1 - 0.035 * H     # внутри рамки с сеткой
    inside = lambda p: ix0 <= p[0] <= ix1 and iy0 <= p[1] <= iy1 and not any(a <= p[0] <= c and b <= p[1] <= e for a, b, c, e in ex)
    keep, ext = [], [1e18, 1e18, -1e18, -1e18]
    for it in r.out:
        pts = coords(it)
        if not pts or not all(inside(p) for p in pts): continue
        keep.append(it)
        for p in pts:
            ext = [min(ext[0], p[0]), min(ext[1], p[1]), max(ext[2], p[0]), max(ext[3], p[1])]
    # одиночный «мусор» вдали от видов (точки, обрывки) — убираем: вокруг него почти нет других объектов
    cell = 0.04 * W; grid = {}
    cen = [(it, coords(it)) for it in keep]
    mass = {}
    for it, pts in cen:
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        k = (int(cx // cell), int(cy // cell)); grid.setdefault(k, []).append(it)
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        mass[k] = mass.get(k, 0) + math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    # «масса» вокруг — суммарный размер объектов в соседних клетках: мелкие обрывки вдали от видов её почти не имеют
    def crowd(k): return sum(mass.get((k[0] + i, k[1] + j), 0) for i in (-1, 0, 1) for j in (-1, 0, 1))
    lonely = {id(it) for k, its in grid.items() if crowd(k) < 0.03 * W for it in its if not it.startswith('<text')}
    keep = [it for it in keep if id(it) not in lonely]
    ext = [1e18, 1e18, -1e18, -1e18]
    for it in keep:
        for p in coords(it): ext = [min(ext[0], p[0]), min(ext[1], p[1]), max(ext[2], p[0]), max(ext[3], p[1])]
    pad = 0.035 * max(ext[2] - ext[0], ext[3] - ext[1])
    bx0, by0, bx1, by1 = ext[0] - pad, ext[1] - pad, ext[2] + pad, ext[3] + pad
    w, h = bx1 - bx0, by1 - by0
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{bx0:.1f} {-by1:.1f} {w:.1f} {h:.1f}" width="{w / h * 800:.0f}" height="800" '
           f'stroke-linecap="round" stroke-linejoin="round">\n<style>path{{vector-effect:non-scaling-stroke;stroke-width:0.6px}} text{{font-family:Arial,Helvetica,sans-serif}}</style>\n'
           f'<rect x="{bx0:.1f}" y="{-by1:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#fff" stroke="#000" stroke-width="{w / 1500:.2f}"/>\n'
           + '\n'.join(keep) + '\n</svg>')
    open(f'out_r/{name}.svg', 'w').write(svg)
    dl = [d for d in r.dims_log if inside(d['dp'])]
    json.dump({'dims': dl, 'view': [bx0, by0, bx1, by1]}, open(f'out_r/{name}.dims.json', 'w'), ensure_ascii=False)
    print(name, 'paths', len(keep), 'size', round(w), 'x', round(h))

if __name__ == '__main__':
    import os; os.makedirs('out_r', exist_ok=True)
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1)
