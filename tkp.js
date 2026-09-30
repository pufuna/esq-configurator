/* Генератор ТКП для конфигуратора ESQ F ME800.
   Берёт assets/template.pdf, стирает переменные значения и печатает новые (pdf-lib).
   Координаты — в «визуальных» pt от левого верхнего угла страницы (как в pdfplumber). */
(function () {
  'use strict';
  const { PDFDocument, rgb, degrees } = window.PDFLib;
  const $ = id => document.getElementById(id);
  const WHITE = rgb(1, 1, 1), BLACK = rgb(0, 0, 0), TEAL = rgb(10 / 255, 105 / 255, 114 / 255);
  const KV = { T060: 6, T100: 10 }, CELLS = { 30: 5, 36: 6, 48: 8, 54: 9 };

  const spaces = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const money = x => { const [a, b] = x.toFixed(2).replace(/\.00$/, '').split('.'); return spaces(a) + (b ? ',' + b : ''); };

  function readState() {
    const g = id => $(id).value, txt = id => $(id).options[$(id).selectedIndex].text;
    const s = {
      v: g('voltage'), P: g('power'), I: g('current'), film: g('capacitorType') === 'PF',
      n: CELLS[g('pulsation')], ip: g('ip'), cu: g('material') === 'CU',
      cell: g('cellSize'), cb: g('cellBypass'), starter: g('starter') === 'S', byp: g('bypass'),
      reactor: g('reactor') === 'R', exp: g('expansion'), expT: txt('expansion'),
      ups: g('ups') === 'U', cable: g('cable'), proto: txt('protocol'),
      who: g('tkpAuthor').trim(), qty: Math.max(1, parseInt(g('tkpQty'), 10) || 1),
      price: parseFloat(String(g('tkpPrice')).replace(/\s/g, '').replace(',', '.')) || 0
    };
    s.kv = KV[s.v];
    s.mark = 'ME800-' + String(s.P).padStart(4, '0') + '-' + s.v + '-' + s.cell + s.cb; // как в файле «модели»
    s.sec = s.film ? 710 : 690;                       // вторичная обмотка, В
    s.eff = s.film ? 97 : 96;                         // КПД, %
    s.life = s.film ? '200 000' : '100 000';          // ресурс конденсаторов, ч
    s.taps = s.kv === 6 ? '5,7 и 6,3' : '9,5 и 10,5'; // отпайки, кВ
    const m = window.getMechanicalFor(s.v, s.P);
    s.wT = parseFloat(m.weight);                      // вес ПЧ, т (шкафы пока не учитываем)
    s.name = 'Преобразователь частоты ESQ F ME800 ' + s.kv + ' кВ, ' + s.P + ' кВт, ' + s.I + ' А, IP' + s.ip + ', ' +
      (s.cu ? 'медный' : 'алюминиевый') + ' трансформатор, ' + s.n + ' ячеек на фазу, ' +
      (s.cb === 'B' ? 'с' : 'без') + ' байпас силовой ячейки' +
      (s.starter ? ', пусковой шкаф' : '') + (s.reactor ? ', шкаф реактора' : '') +
      (s.byp !== 'X' ? ', ' + (s.byp === 'A' ? 'автоматический' : 'ручной') + ' шкаф байпаса' : '') +
      (s.ups ? ', ИБП' : '') + (s.exp !== 'X' ? ', ' + s.expT : '') +
      ', ' + s.proto + ', вводы ' + (s.cable === 'T' ? 'сверху' : 'снизу') + ', асинхронный двигатель, без синхронизации.';
    return s;
  }

  async function generate(ev) {
    if (ev) ev.preventDefault();
    const btn = ev && ev.currentTarget; if (btn) btn.style.opacity = .6;
    try {
      const s = readState();
      const [tpl, fr, fb] = await Promise.all(['assets/template.pdf', 'assets/fonts/DejaVuSansCondensed.ttf', 'assets/fonts/DejaVuSansCondensed-Bold.ttf']
        .map(u => fetch(u).then(r => { if (!r.ok) throw new Error('Не найден файл ' + u); return r.arrayBuffer(); })));
      const doc = await PDFDocument.load(tpl);
      doc.registerFontkit(window.fontkit);
      const fR = await doc.embedFont(fr, { subset: true }), fB = await doc.embedFont(fb, { subset: true });
      const pg = doc.getPages();

      /* --- помощники (визуальные координаты, учитывают /Rotate страницы) --- */
      const rot = p => p.getRotation().angle;
      const er = (p, x0, y0, x1, y1, c = WHITE) => {
        const H = p.getHeight();
        if (rot(p) === 90) p.drawRectangle({ x: y0, y: x0, width: y1 - y0, height: x1 - x0, color: c, borderWidth: 0 });
        else p.drawRectangle({ x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: c, borderWidth: 0 });
      };
      // vx — начало строки (или центр/конец при a='c'/'r'), vy — базовая линия; up — текст читается снизу вверх
      const tx = (p, str, vx, vy, size, o = {}) => {
        const f = o.b ? fB : fR, w = f.widthOfTextAtSize(str, size);
        if (o.a === 'c') vx -= w / 2; else if (o.a === 'r') vx -= w;
        const r = rot(p), H = p.getHeight();
        const pos = r === 90 ? { x: vy, y: vx } : { x: vx, y: H - vy };
        p.drawText(str, { ...pos, size, font: f, color: o.c || BLACK, rotate: degrees((o.up ? 90 : 0) + r) });
      };
      const fit = (p, x0, y0, x1, y1, str, size, o = {}) => { // стереть прямоугольник и вписать текст по центру/слева
        er(p, x0, y0, x1, y1);
        const ax = o.a === 'l' ? x0 + 1 : o.a === 'r' ? x1 - 1 : (x0 + x1) / 2;
        tx(p, str, ax, y1 - 2.3, size, { ...o, a: o.a === 'l' ? undefined : (o.a || 'c') });
      };
      const wrap = (str, size, maxW) => {
        const out = []; let cur = '';
        for (const w of str.split(' ')) {
          const t = cur ? cur + ' ' + w : w;
          if (fR.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t;
        }
        out.push(cur); return out;
      };

      /* --- 0. Обложка --- */
      er(pg[0], 36, 710, 320, 735, TEAL);
      tx(pg[0], 'ESQ F ME800-' + s.cell, 38, 728, 17, { c: WHITE });
      const today = new Date().toLocaleDateString('ru-RU');
      if (s.who) tx(pg[0], s.who, 108, 758, 11, { c: WHITE });
      tx(pg[0], today, 490, 755, 11, { c: WHITE });

      /* --- 3. Таблица предложения --- */
      er(pg[3], 99, 152, 346, 214);
      wrap(s.name, 9, 240).forEach((l, i) => tx(pg[3], l, 102, 163 + i * 11.15, 9));
      fit(pg[3], 360, 229, 410, 246, s.qty + ' шт', 10, { a: 'c' });
      if (s.price) {
        fit(pg[3], 426, 229, 520, 246, money(s.price), 10, { a: 'c' });
        tx(pg[3], money(s.price * s.qty), 222, 360, 10);
      }

      /* --- 5. Маркировка (по файлу «модели») --- */
      er(pg[5], 50, 116, 552, 385);
      tx(pg[5], 'ESQ F ' + s.mark, 83, 137, 16);
      ['1 - Модель ПЧ', '2 - Мощность ПЧ, кВт', '3 - Напряжение ПЧ: T060 - 6 кВ; T100 - 10 кВ',
        '4 - Тип силовой ячейки', '5 - Байпас силовой ячейки, B - включен в комплектацию; N - не включен в комплектацию']
        .forEach((l, i) => tx(pg[5], l, 50, 175 + i * 14, 10));

      /* --- 6. Схема коммутации --- */
      fit(pg[6], 367, 267.5, 387, 279.5, s.sec + 'V', 8.5, { a: 'l' });
      fit(pg[6], 232, 90.5, 280, 100, s.kv + 'кВ, 50Гц, 3ф.', 7.4, { a: 'l' });
      fit(pg[6], 260, 477.5, 320, 487.5, s.kv + 'кВ, до ' + s.P + 'кВт', 7.4, { a: 'c' });
      er(pg[6], 560, 495, 580, 510);

      /* --- 7. Топология: подписи последних ячеек и плат --- */
      const a = s.n - 1, b = s.n, colX = [235.1, 264.4, 293.8], ph = ['A', 'B', 'C'];
      [[390.8, a], [461.4, b]].forEach(([top, k]) => colX.forEach((x, i) => {
        // ячейки на схеме идут по диагонали: сдвиг по вертикали на 23.6 на фазу
        const t = top + i * 23.6; fit(pg[7], x - 1, t - 1, x + 11, t + 10.5, ph[i] + k, 9, { a: 'l' });
      }));
      [[442.7, a], [513.9, b]].forEach(([t, k]) => { er(pg[7], 346, t - 2, 354, t + 5); tx(pg[7], String(k), 352.3, t + 3.6, 7, { up: true }); });
      fit(pg[7], 253, 629, 276, 638, s.kv + ' кВ', 7, { a: 'l' });

      /* --- 8, 9. Подписи --- */
      er(pg[8], 565, 495, 585, 510);
      fit(pg[9], 378, 558, 399, 569, s.kv + ' кВ.', 8.5, { a: 'l' });
      er(pg[9], 339, 703, 358, 716);

      /* --- 10. Габаритный чертёж и вес --- */
      er(pg[10], 559, 495, 578, 510);
      const kg = isNaN(s.wT) ? '—' : String(Math.round(s.wT * 1000));
      fit(pg[10], 497, 463, 514, 475, kg, 8, { a: 'c' });
      fit(pg[10], 547, 463, 564, 475, kg, 8, { a: 'c' });
      await drawDrawing(doc, pg[10], er);

      /* --- 13. Характеристики --- */
      const C = 410, P13 = pg[13];
      fit(P13, 250, 134, 570, 149, 'Преобразователь частоты ESQ F ' + s.mark, 9.5, { a: 'c' });
      fit(P13, 380, 155, 445, 171, s.kv * 1000 + ' В ±10%', 10, { a: 'c' });
      fit(P13, 375, 173, 445, 189, s.P + ' кВт', 10, { a: 'c' });
      fit(P13, 375, 191, 445, 206, s.I + ' А', 10, { a: 'c' });
      fit(P13, 392, 227, 430, 242, '0-' + s.kv + ' кВ', 10, { a: 'c' });
      fit(P13, 374, 269, 445, 284, 'не менее ' + s.eff + '%', 10, { a: 'c' });
      fit(P13, 392, 298, 434, 313, s.n + ' ячеек', 10, { a: 'c' });
      fit(P13, 437, 696, 470, 711, s.cu ? 'медь' : 'алюминий', 10, { a: 'l' });
      fit(P13, 375, 720, 445, 735, s.cb === 'B' ? 'Присутствует' : 'Отсутствует', 10, { a: 'c' });

      /* --- 14. Характеристики (продолжение) --- */
      const P14 = pg[14];
      fit(P14, 402, 150, 424, 165, s.ip, 10, { a: 'l' });
      fit(P14, 324, 213, 360, 227, s.life, 10.5, { a: 'l' }); // «100 000» -> ресурс по типу конденсаторов
      fit(P14, 370, 261, 450, 277, s.film ? 'Пленочные' : 'Электролитические', 10, { a: 'c' });
      fit(P14, 380, 291, 445, 306, s.ups ? 'Присутствует' : 'Отсутствует', 10, { a: 'c' });
      fit(P14, 375, 410, 445, 425, s.proto, 10, { a: 'c' });
      fit(P14, 392, 554, 413, 568, isNaN(s.wT) ? '—' : String(s.wT).replace('.', ','), 10, { a: 'r' });
      fit(P14, 380, 586, 445, 601, s.cable === 'T' ? 'Сверху' : 'Снизу', 10, { a: 'c' });
      fit(P14, 375, 678, 445, 693, s.reactor ? 'Присутствует' : 'Отсутствует', 10, { a: 'c' });

      /* --- 15. Отпайки первичной обмотки --- */
      fit(pg[15], 240, 592, 556, 605, 'на напряжение ' + s.taps + ' кВ при повышенном напряжении в', 10, { a: 'l' });

      const out = await doc.save();
      const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = 'ТКП_ESQ_F_' + s.mark + '.pdf';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert('Не удалось сформировать ТКП: ' + e.message); }
    finally { if (btn) btn.style.opacity = 1; }
  }

  /* Габаритный чертёж на стр. 10: файлы из assets/, те же правила подбора, что в конфигураторе */
  async function drawDrawing(doc, page, er) {
    const url = await window.findFirstExisting(window.buildDrawingCandidates());
    if (!url) { alert('Габаритный чертёж не найден в assets/. В ТКП оставлен чертёж из шаблона (6 кВ, плёнка).'); return; }
    const buf = await (await fetch(url)).arrayBuffer();
    const B = [115, 105, 720, 425], bw = B[2] - B[0], bh = B[3] - B[1], H = page.getHeight();
    let w, h, draw;
    if (/\.png$/i.test(url)) { const im = await doc.embedPng(buf); w = im.width; h = im.height; draw = o => page.drawImage(im, o); }
    else if (/\.jpe?g$/i.test(url)) { const im = await doc.embedJpg(buf); w = im.width; h = im.height; draw = o => page.drawImage(im, o); }
    else { const [em] = await doc.embedPdf(buf, [0]); w = em.width; h = em.height; draw = o => page.drawPage(em, o); }
    const k = Math.min(bw / w, bh / h), dw = w * k, dh = h * k;
    er(page, B[0], B[1], B[2], B[3]);
    draw({ x: B[0] + (bw - dw) / 2, y: H - (B[1] + (bh - dh) / 2) - dh, width: dw, height: dh });
  }

  window.downloadTKP = generate;
})();
