"""Автопроверка конфигураторов ESQ в настоящем браузере (Chromium через Playwright).

Запуск из корня репозитория:
    pip install playwright pdfplumber python-docx && python -m playwright install chromium
    python tests/run_tests.py            # проверка
    python tests/run_tests.py --update   # пересохранить эталон маркировок (после намеренных изменений модельного ряда)

Что проверяется:
  • маркировки, ток, габариты и пусковой шкаф ESQ F ME800 и ME800-R на наборе конфигураций — против эталона tests/expected.json;
  • пример маркировки из техописания ME800-R (п. 5.1);
  • ТКП ПЧ (ME800, ME800-R, 3 кВ, с доп. строками) и ТКП УПП собираются, на листе 3 — нужная маркировка и итог;
  • УПП: подбор по двигателю, ЗИП в строке УПП (PDF и Word);
  • габариты и масса, вписанные вручную (ПЧ и УПП), — в техописании и ТКП;
  • ТКП ПЧ на несколько моделей (PDF и Word);
  • форма восстанавливается после перезагрузки страницы;
  • реестр ТКП — только по паролю, ссылки на него видны лишь вошедшим; пауза после неверного пароля, четыре менеджера одновременно скачивают ТКП;
  • сайт работает без CDN (cdn.jsdelivr.net заблокирован — библиотеки берутся из assets/vendor);
  • в консоли нет ошибок JavaScript.
"""
import asyncio, functools, http.server, io, json, os, subprocess, sys, threading

import pdfplumber
import docx as pydocx
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED = os.path.join(ROOT, 'tests', 'expected.json')
UPDATE = '--update' in sys.argv
CHROME = os.environ.get('CHROME_PATH')                       # необязательно: свой Chrome вместо скачанного Playwright

fails = []
def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: fails.append(msg)

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]

def pdf_pages(data):
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return len(pdf.pages)

PCH_CASES = []
for model, volts in [('ME800', {'T060': ['280', '1250', '1600', '1800', '4500', '8000'], 'T100': ['280', '2650', '2800', '12500']}),
                     ('ME800R', {'T030': ['250', '800', '900', '3300'], 'T060': ['280', '630', '1500', '1600', '2800', '8000'],
                                 'T100': ['280', '1000', '2500', '2650', '4500', '12500']})]:
    for v, powers in volts.items():
        for p in powers:
            for cap in ['EL', 'PF']:
                PCH_CASES.append({'model': model, 'voltage': v, 'power': p, 'capacitorType': cap})

async def main():
    port = serve(); base = f'http://127.0.0.1:{port}/'
    async with async_playwright() as pw:
        kw = {'args': ['--no-sandbox']}
        if CHROME: kw['executable_path'] = CHROME
        browser = await pw.chromium.launch(**kw)
        ctx = await browser.new_context(accept_downloads=True)
        await ctx.route('https://cdn.jsdelivr.net/**', lambda r: r.abort())          # проверяем работу без CDN
        await ctx.route('https://functions.yandexcloud.net/**', lambda r: r.abort())  # настоящие облачные функции тесты не трогают
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        accept_next = {'on': False}                                   # подтверждения (confirm), которые тест принимает
        def on_dialog(d):
            ok, accept_next['on'] = accept_next['on'], False
            asyncio.ensure_future(d.accept() if ok and d.type == 'confirm' else d.dismiss())
        page.on('dialog', on_dialog)

        async def sel(i, v):
            await page.select_option('#' + i, v)

        async def word():
            """Скачать ТКП в Word; вернуть весь текст документа (абзацы и таблицы)."""
            async with page.expect_download(timeout=180000) as dl:
                await page.click('a.btn-word')
            d = pydocx.Document(await (await dl.value).path())
            parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                for row in t.rows: parts += [c.text for c in row.cells]
            return ' '.join(parts), len(d.sections)

        async def tkp():
            """Скачать ТКП; вернуть (число листов, функция «текст листа i»).
            Текст в ТКП рисуется контурами букв, поэтому берём журнал выведенных строк генератора (window.__tkpLog)."""
            async with page.expect_download(timeout=120000) as dl:
                await page.click('a.btn-primary')
            d = await dl.value
            n = pdf_pages(open(await d.path(), 'rb').read())
            log = await page.evaluate("() => (window.__tkpLog || []).map(([p, s]) => [typeof p === 'number' ? p : window.__tkpLog.pages.indexOf(p), s])")
            return n, lambda i: ' '.join(s for p, s in log if p == i).replace('А', 'A')

        # ---------- ПЧ: маркировки ----------
        print('ПЧ: маркировки и габариты')
        await page.goto(base + 'configurator_vv_pch.html'); await page.wait_for_timeout(400)
        await page.evaluate("localStorage.clear()"); await page.reload(); await page.wait_for_timeout(400)
        got = {}
        for c in PCH_CASES:
            for k in ['model', 'voltage', 'power']: await sel(k, c[k])
            if await page.eval_on_selector('#capacitorType option[value="' + c['capacitorType'] + '"]', 'o => o.disabled'):
                continue                                                  # плёночные недоступны на этой мощности — такой конфигурации нет
            await sel('capacitorType', c['capacitorType'])
            got['|'.join(c.values())] = await page.evaluate("""() => ({ mark: result.textContent, mech: getMechanicalFor(voltage.value, power.value),
              starter: starter.value + (starter.disabled ? '!' : ''), cap: capacitorType.value })""")
        if UPDATE or not os.path.exists(EXPECTED):
            json.dump(got, open(EXPECTED, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'  эталон записан: {len(got)} конфигураций')
        else:
            exp = json.load(open(EXPECTED, encoding='utf-8'))
            diff = [k for k in exp if exp[k] != got.get(k)]
            check(not diff, f'{len(exp)} конфигураций совпадают с эталоном' + (f'; расходятся: {diff[:5]}' if diff else ''))

        await sel('model', 'ME800R'); await sel('voltage', 'T060'); await sel('power', '1250'); await sel('capacitorType', 'PF')
        for k, v in [('material', 'AL'), ('ip', '31'), ('expansion', 'X'), ('ups', 'U'), ('cable', 'D'), ('protocol', 'MR'), ('motor', 'A'),
                     ('sync', 'X'), ('bypass', 'X'), ('reactor', 'X'), ('starter', 'X'), ('cellBypass', 'B')]: await sel(k, v)
        mark = (await page.text_content('#result')).replace('А', 'A')
        check(mark == 'ESQ F ME800-1250P154AT060AL30XXX31XUDMRAX-RFB', 'маркировка ME800-R (как у ME800, окончание RFB): ' + mark)

        uo = await page.evaluate("() => { const e = document.getElementById('tkpUout'); e.value = '4,6'; e.dispatchEvent(new Event('input')); const m = document.getElementById('result').textContent; e.value = ''; e.dispatchEvent(new Event('input')); return m; }")
        check('AT060/046AL30' in uo.replace('А', 'A'), 'маркировка с выходным напряжением 4,6 кВ: ' + uo)
        # ME800-R: свои заводские чертежи (10 кВ)
        drw = await page.evaluate("() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); };"
                                  " set('voltage', 'T100'); set('power', '630'); set('capacitorType', 'PF'); set('bypass', 'M'); const a = rDrawing();"
                                  " set('capacitorType', 'EL'); set('power', '2500'); const b = rDrawing(); set('voltage', 'T060'); const c = rDrawing(); set('bypass', 'X');"
                                  " return [a && a.file, b && b.file, c]; }")
        check(drw[0].endswith('R_F_10_280-1000_M.pdf') and drw[1].endswith('R_E_10_2500-2650_B.pdf') and drw[2] is None, f'чертежи ME800-R по модели: {drw}')
        # компактные (плёночные 1600×1330): 6 кВ — те же чертежи, что 10 кВ; шкаф реактора 1000×1300×2100
        c6 = await page.evaluate("() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); };"
                                 " set('voltage', 'T060'); set('power', '400'); set('capacitorType', 'PF'); set('bypass', 'A'); set('reactor', 'R'); const a = rDrawing(), na = rExtrasNote();"
                                 " set('voltage', 'T100'); set('power', '1000'); const b = rDrawing(); set('reactor', 'X'); set('bypass', 'X');"
                                 " return [a && a.file, b && b.file, na]; }")
        check(c6[0] and c6[0] == c6[1] and c6[0].endswith('R_F_10_280-1000_A_R.pdf') and os.path.exists(os.path.join(ROOT, c6[0])) and '1000×1300×2100' in c6[2],
              f'ME800-R компактный 6 кВ — чертёж как у 10 кВ, реактор 1000×1300×2100: {c6}')
        for fn in [d for d in drw if d]:
            check(os.path.exists(os.path.join(ROOT, fn)), 'файл чертежа есть: ' + fn)
        # ME800-R, плёночные вне компактного корпуса — корпус G1: файл есть для каждой мощности и комплектации
        g1 = await page.evaluate("() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); };"
                                 " const out = []; for (const v of ['T060', 'T100']) { set('voltage', v); set('capacitorType', 'PF');"
                                 " for (const p of [...document.getElementById('power').options].map(o => o.value)) { set('power', p);"
                                 " for (const b of ['X', 'M', 'A']) for (const s of ['X', 'S']) for (const r of ['X', 'R']) { set('bypass', b); set('starter', s); set('reactor', r);"
                                 " const d = rDrawing(); out.push([v, p, b + s + r, d && d.file, getMechanicalFor(v, +p).size, document.getElementById('capacitorType').value]); } } }"
                                 " set('bypass', 'X'); set('starter', 'X'); set('reactor', 'X'); set('voltage', 'T060'); set('capacitorType', 'EL'); return out; }")
        big = [x for x in g1 if int(x[1]) > (630 if x[0] == 'T060' else 1000) and x[5] == 'PF' and x[4] not in (None, '—')]   # плёночные мощности из таблицы РЭ
        miss = [x for x in big if not x[3] or not os.path.exists(os.path.join(ROOT, x[3]))]
        check(big and not miss, f'чертежи G1 ME800-R для всех плёночных вне компактного корпуса ({len(big)} вариантов), нет: {miss[:3]}')
        nowarn = await page.evaluate("() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); };"
                                     " set('voltage', 'T100'); set('capacitorType', 'PF'); set('power', '1600'); const r = [isFilmBig(), document.getElementById('capNote').textContent];"
                                     " set('voltage', 'T060'); set('capacitorType', 'EL'); return r; }")
        check(nowarn[0] is False and 'не прикладывается' not in nowarn[1], f'ME800-R G1: нет предупреждения «чертёж не прикладывается»: {nowarn}')
        ex = {(x[0], x[1], x[2]): x[3] for x in g1}
        check((ex.get(('T100', '1600', 'MXX')) or '').endswith('R_G1_2450_2537_B.pdf') and (ex.get(('T060', '2000', 'XSX')) or '').endswith('R_G1L_2881.pdf'),
              f"чертёж G1 по мощности: {ex.get(('T100', '1600', 'MXX'))}, {ex.get(('T060', '2000', 'XSX'))}")

        # подбор по двигателю: 6 кВ, 1000 кВт, винтовой компрессор → на ступень выше 1000 кВт
        await page.click('#motorPick summary'); await page.fill('#mpKw', '1000'); await sel('mpLoad', '1')
        await page.click('#motorPick .btn');
        check(await page.input_value('#power') == '1120', 'подбор по двигателю: 1000 кВт, винтовой компрессор → 1120 кВт')

        # ---------- ПЧ: ТКП ----------
        print('ПЧ: ТКП')
        await page.fill('#tkpAuthor', 'Иванов И.И.'); await page.fill('#tkpPrice', '1000000')
        n, t = await tkp()
        check(n > 15 and 'ME800-1120P135' in t(3).replace('- ', '-') and 'REB' in t(3), f'ТКП ME800-R: {n} стр., маркировка на листе 3')
        check('150% в течение 2 секунд' in t(13) and 'Русский, английский' in t(14), 'ТКП ME800-R: характеристики по техописанию R')
        await page.evaluate("addExtraRow({name:'Комплект ЗИП', qty:2, unit:'компл.', price:'50000'}, true)")
        n, t = await tkp()
        check('Комплект ЗИП' in t(3) and 'Всего позиций: 2, на сумму 1 100 000' in t(3), 'ТКП: доп. строка и итог на листе 3')
        text, nsec = await word()
        check('Комплект ЗИП' in text and '150% в течение 2 секунд' in text and 'Расшифровка обозначения' in text and nsec > 15,
              f'ТКП ME800-R в Word: доп. строка, характеристики R, расшифровка; разделов {nsec}')
        await sel('voltage', 'T030'); await sel('power', '1000')
        n, t = await tkp()
        check(n > 15 and 'T030AL18' in t(3), 'ТКП ME800-R 3 кВ собирается')
        await sel('model', 'ME800'); await sel('voltage', 'T100'); await sel('power', '1000'); await sel('capacitorType', 'PF')
        n, t = await tkp()
        check('ESQ F ME800-1000P072' in t(3).replace('- ', '-') and '150% в течение 2 секунд' not in t(13), 'ТКП ME800 (плёночные, корпус G4) собирается, характеристики шаблона ME800')
        # ТКП на несколько моделей: общая часть + по модели расшифровка, схема коммутации, чертёж, характеристики
        for pw_ in ['315', '800']:
            for i_, v_ in [('model', 'ME800R'), ('voltage', 'T060'), ('power', pw_), ('capacitorType', 'PF')]: await sel(i_, v_)
            await page.click('.md-add')
        await sel('model', 'ME800'); await sel('voltage', 'T100'); await sel('power', '1000'); await sel('capacitorType', 'PF')
        keep = await page.text_content('#result')
        async with page.expect_download(timeout=300000) as dl:
            await page.click('a.btn-primary')
        d_ = await dl.value
        n_ = pdf_pages(open(await d_.path(), 'rb').read())
        check(n_ == 27 and d_.suggested_filename == 'TKP_ESQ_F_ME800_315-800kW.pdf' and await page.text_content('#result') == keep,
              f'ТКП на 2 модели: {n_} листов (5 общих + по модели 2+2+1+3, топология 1+2, 9 общих), форма вернулась к своей конфигурации')
        text, nsec = await word()
        check(nsec == 23 and '0315P038' in text and '0800P096' in text and text.count('Расшифровка обозначения') == 2 and 'Всего позиций:' in text,
              f'ТКП на 2 модели в Word: {nsec} разделов, обе модели')
        while await page.query_selector('#tkpModels .md-del'): await page.click('#tkpModels .md-del')
        # габариты и масса, вписанные вручную, — в техописании и ТКП
        await page.fill('#tkpDims', '2700x1400 x 2500'); await page.fill('#tkpMass', '3,1')
        check('2700×1400×2500' in await page.text_content('#dimsNote'), 'ручные габариты распознаны: ' + await page.text_content('#dimsNote'))
        await page.click('a.techdesc-btn'); await page.wait_for_timeout(300)
        td = await page.text_content('#techdesc')
        check('2700×1400×2500' in td and 'по согласованию' in td and ('3.1' in td or '3,1' in td), 'техописание: ручные габариты и масса')
        await page.click('a.techdesc-btn')
        n, t = await tkp()
        check('2700×1400×2500' in t(10) and '3100' in t(10) and '3,1' in t(14), 'ТКП: ручные габариты на листе чертежа, масса 3100 кг и в характеристиках')
        await page.fill('#tkpDims', ''); await page.fill('#tkpMass', '')

        # ---------- сохранение формы ----------
        print('Сохранение формы')
        await page.wait_for_timeout(300); before = await page.text_content('#result')
        await page.reload(); await page.wait_for_timeout(600)
        check(await page.text_content('#result') == before, 'конфигурация восстановлена после перезагрузки')
        check(await page.input_value('#tkpAuthor') == 'Иванов И.И.', 'составитель восстановлен')
        check(await page.eval_on_selector_all('#tkpExtras .ex-row', 'r => r.length') == 1, 'доп. строки ТКП восстановлены')
        await page.goto(base + 'configurator_vv_pch.html?cfg=1&model=ME800R&voltage=T100&power=2650&capacitorType=PF'); await page.wait_for_timeout(600)
        check((await page.text_content('#result')).startswith('ESQ F ME800-2650P191'), 'конфигурация открывается по ссылке')

        # ---------- УПП ----------
        print('УПП: ТКП')
        await page.goto(base + 'vv_upp.html'); await page.wait_for_timeout(500)
        check(await page.evaluate('!window.PDFLib'), 'pdf-lib не грузится вместе со страницей (только при скачивании ТКП)')
        await page.evaluate("document.getElementById('motorPick').open = true")
        await page.fill('#mpKw', '600'); await page.fill('#mpA', '80'); await page.click('#motorPick .btn')
        check(await page.input_value('#power') == '120', 'УПП: подбор по двигателю 600 кВт / 80 А → 120 А (1000 кВт)')
        await page.fill('#tkpAuthor', 'Иванов И.И.')
        await page.fill('#tkpZip', 'тиристорный блок')
        await page.fill('#tkpDims', '1100*1600*2400'); await page.fill('#tkpMass', '950')
        await page.evaluate("addExtraRow({name:'Шеф-монтаж', qty:1, unit:'усл.'}, true)")
        n, t = await tkp()
        check(n > 8 and 'ESQ F HVS' in t(3) and 'Шеф-монтаж' in t(3), f'ТКП УПП: {n} стр., доп. строка на листе 3')
        check('ЗИП: тиристорный блок' in t(3), 'ТКП УПП: ЗИП в строке УПП на листе 3')
        tu = ' '.join(t(i) for i in range(n))
        check('1100×1600×2400' in tu and '950 кг' in tu and 'по согласованию' in tu, 'ТКП УПП: ручные габариты и масса')
        text, nsec = await word()
        check('Шеф-монтаж' in text and 'Функции защиты' in text and 'ESQ F HVS' in text and 'ЗИП: тиристорный блок' in text, 'ТКП УПП в Word: доп. строка, ЗИП и характеристики')

        # ---------- реестр ТКП: только по паролю ----------
        print('Реестр ТКП')
        recs = await page.evaluate('TkpRegistry.read()')
        check(len(recs) >= 7 and any(r['fmt'] == 'Word' for r in recs) and any('HVS' in r['mark'] for r in recs), f'все скачанные ТКП записаны в реестр: {len(recs)}')
        await page.goto(base + 'registry.html'); await page.wait_for_timeout(400)
        check(await page.is_hidden('#regBody') and await page.is_visible('#gate') and await page.eval_on_selector_all('#rows tr', 'r => r.length') == 0,
              'без пароля реестр не открывается')
        for u in ['index.html', 'configurator_vv_pch.html', 'vv_upp.html']:
            await page.goto(base + u); await page.wait_for_timeout(300)
            check(await page.is_hidden('a.reg-link'), f'{u}: ссылки на реестр нет, пока не вошли')

        # ---------- общий реестр (облачная функция cloud/registry на локальном стенде) ----------
        print('Общий реестр')
        proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'registry_server.js')], stdout=subprocess.PIPE, text=True)
        try:
            fn_url = proc.stdout.readline().strip()
            await ctx.add_init_script(f"window.REGISTRY_URL = '{fn_url}'")
            await page.goto(base + 'vv_upp.html'); await page.wait_for_timeout(500)
            await tkp(); await page.wait_for_timeout(800)
            await page.goto(base + 'registry.html'); await page.wait_for_timeout(500)
            check(await page.is_visible('#login'), 'страница реестра предлагает войти в общий реестр')
            await page.fill('#pw', 'wrong'); await page.click('#login button'); await page.wait_for_timeout(500)
            check('Неверный пароль' in await page.text_content('#loginErr'), 'неверный пароль не пускает')
            check(await page.is_disabled('#login button'), 'после неверного пароля — пауза перед следующей попыткой')
            await page.fill('#pw', 'test-password'); await page.click('#login button'); await page.wait_for_timeout(1200)
            check(await page.is_visible('#regBody') and await page.is_hidden('#login') and await page.is_visible('#sharedBar'), 'после входа реестр открыт, форма входа скрыта')
            first = await page.inner_text('#rows tr:first-child')
            check('HVS' in first and 'не отправлено' not in first, 'свежее ТКП уже в общем реестре (ушло на сервер при скачивании)')
            n_rows = await page.evaluate('TkpRegistry.read().length')
            accept_next['on'] = True
            await page.click('#push'); await page.wait_for_timeout(2500)
            n_shared = await page.eval_on_selector_all('#rows tr', 'r => r.length')
            check(n_shared == n_rows, f'записи браузера перенесены в общий реестр без дублей: {n_shared}')
            async with page.expect_download() as dl:
                await page.click('#csv')
            csv_path = await (await dl.value).path()
            csv_text = open(csv_path, encoding='utf-8-sig').read()
            check(csv_text.count('\n') >= n_shared and 'Маркировка' in csv_text, 'выгрузка CSV для Excel')
            await page.set_input_files('#impFile', csv_path); await page.wait_for_timeout(1200)
            check(await page.eval_on_selector_all('#rows tr', 'r => r.length') == n_shared, 'повторная загрузка CSV не дублирует записи')
            await page.fill('#q', 'HVS'); await page.wait_for_timeout(100)
            check(0 < await page.eval_on_selector_all('#rows tr', 'r => r.length') < n_shared, 'поиск по реестру')
            await page.fill('#q', '')
            accept_next['on'] = True
            await page.click('#rows tr button.del'); await page.wait_for_timeout(800)
            await page.click('#reload'); await page.wait_for_timeout(800)
            check(await page.eval_on_selector_all('#rows tr', 'r => r.length') == n_shared - 1, 'удаление из общего реестра')
            link = await page.get_attribute('#rows tr a', 'href')
            await page.goto(link); await page.wait_for_timeout(600)
            check(bool(await page.text_content('#result')) and await page.is_visible('a.reg-link'), 'из реестра открывается конфигурация; после входа ссылка на реестр видна')
            await page.goto(base + 'registry.html'); await page.wait_for_timeout(800)

            # несколько менеджеров одновременно — у каждого свой браузер
            print('Несколько сотрудников одновременно')
            team = [('Петров П.П.', 'configurator_vv_pch.html'), ('Сидоров С.С.', 'vv_upp.html'),
                    ('Кузнецова А.В.', 'configurator_vv_pch.html'), ('Смирнов Д.А.', 'vv_upp.html')]
            async def manager(who, url):
                c = await browser.new_context(accept_downloads=True)
                await c.route('https://cdn.jsdelivr.net/**', lambda r: r.abort())
                await c.add_init_script(f"window.REGISTRY_URL = '{fn_url}'")
                p = await c.new_page(); errs = []
                p.on('pageerror', lambda e: errs.append(str(e)))
                await p.goto(base + url); await p.wait_for_timeout(500)
                await p.fill('#tkpAuthor', who)
                async with p.expect_download(timeout=180000) as dl:
                    await p.click('a.btn-primary')
                ok = (await dl.value).suggested_filename.endswith('.pdf')
                await p.wait_for_timeout(1500)
                unsent = await p.evaluate("TkpRegistry.read().filter(e => e.sent === false).length")
                await c.close()
                return ok and unsent == 0 and not errs
            res = await asyncio.gather(*(manager(w, u) for w, u in team))
            check(all(res), f'4 менеджера одновременно скачали ТКП, всё ушло в общий реестр: {res}')
            await page.click('#reload'); await page.wait_for_timeout(1200)
            rows = await page.inner_text('#rows')
            check(all(w in rows for w, _ in team), 'в общем реестре видны ТКП всех четырёх')
            await page.click('#logout'); await page.wait_for_timeout(300)
            check(await page.is_hidden('#regBody'), 'после выхода реестр снова закрыт')
            await page.goto(base + 'index.html'); await page.wait_for_timeout(300)
            check(await page.is_hidden('a.reg-link'), 'после выхода ссылка на реестр снова скрыта')
        finally:
            proc.terminate()

        # ---------- расчёт энергосбережения ----------
        print('Расчёт энергосбережения')
        await page.goto(base + 'energy.html'); await page.evaluate("localStorage.removeItem('esq.energy')"); await page.reload(); await page.wait_for_timeout(400)
        r = await page.evaluate("""() => __energyCalc({mech:'pump', ctl:'valve', kw:1000, load:85, hst:20, etaM:95, etaV:96.5, tariff:7.5, cost:'45000000', years:10},
            [{q:80, h:1000}])""")
        # Q=0,8: задвижка 850·(0,45+0,55·0,8)/0,95 = 796,3 кВт; ПЧ 850·0,8·(0,2+0,8·0,64)/(0,95·0,965) = 528,1 кВт
        check(abs(r['res'][0]['now'] - 796.3) < 0.5 and abs(r['res'][0]['vfd'] - 528.1) < 0.5, f"формулы: {r['res'][0]['now']:.1f} / {r['res'][0]['vfd']:.1f} кВт")
        check('млн руб.' in await page.text_content('#rRub'), 'страница считает итог: ' + await page.text_content('#rRub'))
        await page.goto(base + await page.get_attribute('#toConf', 'href')); await page.wait_for_timeout(700)
        check(await page.input_value('#power') == '1000', 'переход в конфигуратор с подбором по двигателю')

        check(not errors, 'нет ошибок JavaScript' + (': ' + '; '.join(errors[:3]) if errors else ''))
        await browser.close()

asyncio.run(main())
print('\nИТОГ: ' + ('все проверки пройдены' if not fails else f'не пройдено {len(fails)}'))
sys.exit(1 if fails else 0)
