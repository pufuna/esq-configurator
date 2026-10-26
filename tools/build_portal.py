"""Архив сайта для размещения на корпоративном портале «Элком».

Запуск из корня репозитория (Python 3, без сторонних библиотек):
    python tools/build_portal.py                 # → dist/esq-configurator-<дата>.zip
    python tools/build_portal.py путь/к/архиву.zip

В архив попадает только то, что нужно сайту: страницы, скрипты, assets/ (чертежи, документация, шаблоны ТКП,
шрифты, библиотеки), конфиги веб-сервера (web.config — IIS, .htaccess — Apache, nginx.conf — пример)
и инструкция по внедрению. Не попадают: тесты, служебные скрипты, код облачных функций, шрифты для служебных
скриптов, образцы и пустые файлы-заглушки «x».
"""
import datetime, os, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {                                                    # в репозитории есть, сайту не нужны
    'assets/fonts/Carlito-Regular.ttf', 'assets/fonts/DejaVuSansCondensed.ttf',
    'assets/fonts/DejaVuSansCondensed-Bold.ttf', 'assets/fonts/LiberationSans-Regular.ttf',   # для tools/
    'assets/upp/template.pdf',                              # образец ТКП УПП (генератор берёт assets/upp/shell.pdf)
}
EXTRA = {                                                   # путь в архиве ← файл репозитория
    'web.config': 'deploy/web.config',
    '.htaccess': 'deploy/.htaccess',
    'nginx.conf.example': 'deploy/nginx.conf',
    'ИНСТРУКЦИЯ_ПО_ВНЕДРЕНИЮ.md': 'deploy/README.md',
}


def site_files():
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True).stdout.decode('utf-8')
    for f in out.split('\0'):
        if not f or f in SKIP or os.path.basename(f) == 'x':
            continue
        if '/' not in f and f.endswith(('.html', '.js')):  # страницы и скрипты в корне
            yield f
        elif f.startswith('assets/'):
            yield f


def main():
    dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'esq-configurator-' + datetime.date.today().isoformat() + '.zip')
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    files = sorted(site_files())
    for need in ['index.html', 'configurator_vv_pch.html', 'vv_upp.html', 'registry.html', 'assets/template.pdf']:
        if need not in files:
            sys.exit('нет обязательного файла: ' + need)
    total = 0
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in files:
            # PDF, картинки и шрифты уже сжаты — кладём как есть, так архив собирается быстрее
            packed = f.lower().endswith(('.pdf', '.png', '.jpg', '.webp', '.woff', '.woff2'))
            z.write(os.path.join(ROOT, f), f, zipfile.ZIP_STORED if packed else zipfile.ZIP_DEFLATED)
            total += os.path.getsize(os.path.join(ROOT, f))
        for arc, src in EXTRA.items():
            z.write(os.path.join(ROOT, src), arc)
    print(f'{dst}\n  файлов сайта: {len(files)}, {total / 2**20:.0f} МБ; архив {os.path.getsize(dst) / 2**20:.0f} МБ')


if __name__ == '__main__':
    main()
