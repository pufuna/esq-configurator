"""Уменьшение PDF без видимых изменений (чертежи, шаблоны ТКП, документация).

    python tools/optimize_pdf.py файл.pdf [...]          # перезаписывает файлы, если стало меньше
    python tools/optimize_pdf.py --check файл.pdf [...]  # только показать выигрыш

Нужна библиотека pikepdf (pip install pikepdf). Что делает:
  1. Одинаковые объекты (шрифты, картинки, ICC-профили, продублированные при склейке страниц) — в одну копию.
  2. В векторной графике (чертежи из Chrome/Skia: координаты вида 2329.8999) — координаты путей
     округляются до 0,01 единицы (на листе это тысячные доли миллиметра). Матрицы (cm, Tm), шрифты (Tf)
     и текст не трогаются.
  3. Сжатие потоков с максимальной степенью, объектные потоки, удаление неиспользуемых ресурсов.
Картинки не пережимаются — качество остаётся прежним.
"""
import hashlib, os, re, sys, tempfile
import pikepdf

KEEP = {b'cm', b'Tm', b'Tf', b'Tc', b'Tw', b'Tz', b'TL', b'Ts', b'd', b'w', b'M', b'i', b'gs', b'Tj', b'TJ', b"'", b'"', b'Td', b'TD', b'BDC', b'DP', b'BI', b'ID'}
TOKEN = re.compile(rb'\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|<<|>>|\[|\]|/[^\s/\[\]()<>{}%]+|[-+]?(?:\d+\.\d*|\.\d+|\d+)|[^\s/\[\]()<>{}%]+)', re.S)
NUM = re.compile(rb'[-+]?(?:\d+\.\d*|\.\d+|\d+)$')


def fmt(x):
    s = ('%.2f' % x).rstrip('0').rstrip('.')
    if s.startswith('0.'): s = s[1:]
    elif s.startswith('-0.'): s = '-' + s[2:]
    return (s if s not in ('', '-', '-0') else '0').encode()


def round_content(data):
    """Округление операндов операторов путей и цвета; всё прочее — как было. None, если поток не разобрать."""
    if b'BI' in data and re.search(rb'\bBI\b', data): return None          # встроенные картинки — не трогаем
    out, ops, pos = [], [], 0
    for m in TOKEN.finditer(data):
        if m.start(1) != pos and data[pos:m.start(1)].strip(): return None
        pos = m.end()
        t = m.group(1)
        if NUM.match(t) or t[:1] in b'(<[]/' or t in (b'<<', b'>>'):
            ops.append(t); continue
        if t in KEEP: out.append(b' '.join(ops + [t]))
        else: out.append(b' '.join([fmt(float(o)) if NUM.match(o) and b'.' in o else o for o in ops] + [t]))
        ops = []
    if data[pos:].strip() or ops: return None
    return b'\n'.join(out) + b'\n'


def dedupe(pdf):
    seen, alias = {}, {}
    for o in pdf.objects:
        if isinstance(o, pikepdf.Stream):
            d = dict((k, repr(v)) for k, v in o.stream_dict.items() if k != '/Length')
            h = hashlib.sha256(o.read_raw_bytes() + repr(sorted(d.items())).encode()).hexdigest()
            if h in seen: alias[o.objgen] = seen[h]
            else: seen[h] = o
    if not alias: return 0
    def fix(x, depth=0):
        if depth > 60: return
        items = x.items() if isinstance(x, (pikepdf.Dictionary, pikepdf.Stream)) else enumerate(x) if isinstance(x, pikepdf.Array) else ()
        for k, v in list(items):
            if isinstance(v, pikepdf.Object) and v.is_indirect and v.objgen in alias: x[k] = alias[v.objgen]
            elif isinstance(v, (pikepdf.Dictionary, pikepdf.Array)) and not v.is_indirect: fix(v, depth + 1)
    for o in pdf.objects:
        if isinstance(o, (pikepdf.Dictionary, pikepdf.Stream, pikepdf.Array)): fix(o)
    fix(pdf.trailer)
    return len(alias)


def optimize(src):
    pdf = pikepdf.open(src)
    n_dup = dedupe(pdf)
    n_round = 0
    streams, seen = [], set()
    def forms(res):                                              # формы (XObject /Form) — и вложенные в них
        for xo in (res or {}).get('/XObject', {}).values():
            if isinstance(xo, pikepdf.Stream) and xo.get('/Subtype') == '/Form' and xo.objgen not in seen:
                seen.add(xo.objgen); streams.append(xo); forms(xo.get('/Resources'))
    for page in pdf.pages:
        streams += [page.obj.Contents] if isinstance(page.obj.get('/Contents'), pikepdf.Stream) else list(page.obj.get('/Contents', []))
        forms(page.Resources)
    if True:
        for s in streams:
            if b'.' not in s.read_bytes()[:4000]: continue
            new = round_content(s.read_bytes())
            if new is not None and len(new) < len(s.read_bytes()) * 0.97: s.write(new); n_round += 1
    pdf.remove_unreferenced_resources()
    fd, tmp = tempfile.mkstemp(suffix='.pdf', dir=os.path.dirname(os.path.abspath(src))); os.close(fd)
    pdf.save(tmp, compress_streams=True, recompress_flate=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    pdf.close()
    return tmp, n_dup, n_round


def main():
    check = '--check' in sys.argv
    files = [a for a in sys.argv[1:] if a != '--check']
    tot_a = tot_b = 0
    for f in files:
        tmp, nd, nr = optimize(f)
        a, b = os.path.getsize(f), os.path.getsize(tmp)
        if b < a * 0.98 and not check: os.replace(tmp, f)
        else: os.remove(tmp); b = b if check else a
        tot_a += a; tot_b += b
        print(f'{a/1024:8.0f} → {b/1024:8.0f} КБ  дублей {nd:3d}, округлено потоков {nr:2d}  {f}')
    print(f'итого {tot_a/2**20:.1f} → {tot_b/2**20:.1f} МБ')


if __name__ == '__main__':
    main()
