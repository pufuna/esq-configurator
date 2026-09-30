/* Генератор ТКП для конфигуратора ESQ F ME800.
   Берёт assets/template.pdf и меняет в нём только зависящие от комплектации надписи.
   Все координаты — pt от левого верхнего угла страницы «как её видит человек».
   Таблица FIELDS снята с самого шаблона: границы надписи, базовая линия, кегль и цвет. */
(function () {
  'use strict';
  const { PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = window.PDFLib;
  const $ = id => document.getElementById(id);
  const WHITE = rgb(1, 1, 1), BLACK = rgb(0, 0, 0), BAND = rgb(10 / 255, 105 / 255, 114 / 255), NAVY = rgb(.137, .122, .129);
  const KV = { T060: 6, T100: 10 }, CELLS = { 30: 5, 36: 6, 48: 8, 54: 9 };
  const money = x => { const [a, b] = x.toFixed(2).replace(/\.00$/, '').split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (b ? ',' + b : ''); };

  /* name: [страница, x0, x1, базовая линия, кегль, верх, низ, [r,g,b]] — рамка стирания = x0..x1 × верх..низ */
  const FIELDS = {
    p6_v: [6, 367.16, 386.68, 276.35, 9.59, 269.25, 277.69, [0.0, 0.384, 0.447]],
    p6_in: [6, 232.7, 274.9, 97.51, 7.38, 92.05, 99.58, [0.0, 0.384, 0.447]],
    p6_out: [6, 265.28, 313.24, 485.0, 7.38, 477.91, 487.07, [0.0, 0.384, 0.447]],
    p6_stamp: [6, 562.46, 576.76, 506.25, 11.0, 498.11, 507.79, [0.0, 0.0, 0.0]],
    p7_A5: [7, 233.96, 245.56, 397.98, 9.13, 389.71, 399.26, [0.067, 0.412, 0.455]],
    p7_B5: [7, 263.3, 274.36, 421.56, 9.13, 413.29, 422.84, [0.067, 0.412, 0.455]],
    p7_C5: [7, 292.64, 303.16, 445.14, 9.13, 436.69, 446.42, [0.067, 0.412, 0.455]],
    p7_A6: [7, 233.96, 245.56, 468.72, 9.13, 460.27, 470.0, [0.067, 0.412, 0.455]],
    p7_B6: [7, 263.3, 274.36, 492.12, 9.13, 483.85, 493.4, [0.067, 0.412, 0.455]],
    p7_C6: [7, 292.64, 303.16, 515.7, 9.13, 507.43, 516.98, [0.067, 0.412, 0.455]],
    p7_b7: [7, 347.54, 351.94, 444.78, 2.47, 442.95, 445.13, [0.067, 0.412, 0.455]],
    p7_b8: [7, 347.54, 351.94, 516.06, 2.47, 514.23, 516.41, [0.067, 0.412, 0.455]],
    p7_motor: [7, 253.94, 266.44, 635.76, 7.3, 630.36, 636.78, [0.067, 0.412, 0.455]],
    p7_stamp: [7, 339.62, 353.92, 712.08, 11.0, 703.94, 713.62, [0.0, 0.0, 0.0]],
    p8_stamp: [8, 567.32, 581.8, 505.25, 11.0, 497.11, 506.79, [0.0, 0.0, 0.0]],
    p9_v: [9, 379.4, 397.48, 566.64, 9.23, 559.81, 567.93, [0.0, 0.0, 0.0]],
    p9_stamp: [9, 341.06, 355.36, 712.98, 11.0, 704.84, 714.52, [0.0, 0.0, 0.0]],
    p10_w1: [10, 500.18, 509.8, 471.59, 8.12, 464.95, 472.73, [0.039, 0.412, 0.447]],
    p10_w2: [10, 550.22, 559.84, 472.03, 8.8, 465.13, 473.26, [0.039, 0.412, 0.447]],
    p10_stamp: [10, 561.38, 575.68, 505.25, 11.0, 497.11, 506.79, [0.0, 0.0, 0.0]],
    p13_name: [13, 408.92, 422.32, 144.61, 10.99, 135.91, 146.15, [0.0, 0.0, 0.0]],
    p13_u: [13, 388.22, 439.24, 166.29, 10.99, 157.51, 167.83, [0.0, 0.0, 0.0]],
    p13_p: [13, 379.04, 418.0, 184.3, 10.99, 175.69, 185.84, [0.0, 0.0, 0.0]],
    p13_i: [13, 387.32, 412.42, 202.3, 10.99, 193.33, 203.84, [0.0, 0.0, 0.0]],
    p13_uout: [13, 394.88, 426.1, 238.03, 10.99, 229.33, 241.01, [0.0, 0.0, 0.0]],
    p13_eff: [13, 377.78, 438.88, 279.82, 10.99, 271.68, 281.36, [0.0, 0.0, 0.0]],
    p13_n: [13, 395.96, 429.34, 308.98, 10.99, 300.84, 310.52, [0.0, 0.0, 0.0]],
    p13_mat: [13, 438.44, 451.84, 707.04, 10.99, 698.41, 708.58, [0.0, 0.0, 0.0]],
    p13_cb: [13, 392.72, 406.12, 730.87, 10.99, 722.17, 732.41, [0.0, 0.0, 0.0]],
    p14_ip: [14, 404.24, 417.64, 160.62, 10.99, 151.93, 162.16, [0.0, 0.0, 0.0]],
    p14_life: [14, 326.3, 358.42, 223.2, 11, 215.06, 224.74, [0.0, 0.0, 0.0]],
    p14_cap: [14, 386.78, 432.22, 272.34, 10.99, 264.2, 273.88, [0.0, 0.0, 0.0]],
    p14_ups: [14, 401.72, 415.12, 301.54, 10.99, 292.87, 303.08, [0.0, 0.0, 0.0]],
    p14_proto: [14, 383.9, 435.82, 420.46, 10.99, 412.32, 422.0, [0.0, 0.0, 0.0]],
    p14_w: [14, 395.24, 408.64, 564.37, 10.99, 555.67, 565.91, [0.0, 0.0, 0.0]],
    p14_cable: [14, 402.8, 416.2, 596.48, 10.99, 587.71, 598.02, [0.0, 0.0, 0.0]],
    p14_reactor: [14, 380.48, 439.42, 689.09, 10.99, 680.95, 692.17, [0.0, 0.0, 0.0]],
    p15_taps: [15, 311.9, 364.54, 602.15, 10.99, 594.01, 605.23, [0.0, 0.0, 0.0]]
  };
  const STAMP_LAND = { cx: 575.05, maxW: 246 }, STAMP_PORT = { cx: 348.75, maxW: 296 }; // ячейки основных надписей

  function readState() {
    window.updateNomenclature();
    const g = id => $(id).value, txt = id => $(id).options[$(id).selectedIndex].text;
    const s = {
      v: g('voltage'), P: g('power'), I: g('current'), film: g('capacitorType') === 'PF', n: CELLS[g('pulsation')],
      ip: g('ip'), cu: g('material') === 'CU', starter: g('starter') === 'S', byp: g('bypass'), reactor: g('reactor') === 'R',
      exp: g('expansion'), expT: txt('expansion'), ups: g('ups') === 'U', cable: g('cable'), proto: txt('protocol'),
      motor: g('motor'), sync: g('sync'), cb: g('cellBypass'),
      who: g('tkpAuthor').trim(), qty: Math.max(1, parseInt(g('tkpQty'), 10) || 1),
      price: parseFloat(String(g('tkpPrice')).replace(/\s/g, '').replace(',', '.')) || 0
    };
    s.kv = KV[s.v];
    s.mark = $('result').textContent;                                     // полная маркировка из конфигуратора
    s.m = /^ESQ F ME800-(\d{4,5})P(\d{3})[AА](T\d{3})(AL|CU)(\d{2})([SX])([AMX])([RX])(\d{2})(2E|E|X)([UX])([DT])(MR|MT|PB|PN|CO|EI)([AS])([XB])-(P[A-F])([BN])$/.exec(s.mark);
    s.eff = s.film ? 97 : 96;
    s.life = s.film ? '200 000' : '100 000';                              // ресурс конденсаторов, ч
    s.sec = s.film ? 710 : 690;                                           // вторичная обмотка, В
    const m = window.getMechanicalFor(s.v, s.P);
    s.wT = parseFloat(m.weight);                                          // вес ПЧ, т (шкафы пока не учитываем)
    s.name = 'Преобразователь частоты ' + s.mark + ', ' + s.kv + ' кВ, ' + s.P + ' кВт, ' + s.I + ' А, IP' + s.ip + ', ' +
      (s.cu ? 'медный' : 'алюминиевый') + ' трансформатор, ' + s.n + ' ячеек на фазу, ' + (s.cb === 'B' ? 'с' : 'без') + ' байпас силовой ячейки' +
      (s.starter ? ', пусковой шкаф' : '') + (s.reactor ? ', шкаф реактора' : '') +
      (s.byp !== 'X' ? ', ' + (s.byp === 'A' ? 'автоматический' : 'ручной') + ' шкаф байпаса' : '') +
      (s.ups ? ', ИБП' : '') + (s.exp !== 'X' ? ', ' + s.expT : '') + ', ' + s.proto + ', вводы ' + (s.cable === 'T' ? 'сверху' : 'снизу') +
      ', ' + (s.motor === 'S' ? 'синхронный' : 'асинхронный') + ' двигатель, ' + (s.sync === 'B' ? 'с синхронизацией' : 'без синхронизации') + '.';
    return s;
  }

  async function generate(ev) {
    if (ev) ev.preventDefault();
    const btn = ev && ev.currentTarget; if (btn) btn.style.opacity = .6;
    try {
      const s = readState();
      if (!s.m) throw new Error('не удалось разобрать маркировку: ' + s.mark);
      const urls = ['assets/template.pdf', 'assets/fonts/LiberationSans-Regular.ttf', 'assets/fonts/Carlito-Regular.ttf', 'assets/fonts/DejaVuSansCondensed.ttf'];
      const [tpl, b1, b2, b3] = await Promise.all(urls.map(u => fetch(u).then(r => { if (!r.ok) throw new Error('Не найден файл ' + u); return r.arrayBuffer(); })));
      const doc = await PDFDocument.load(tpl);
      doc.registerFontkit(window.fontkit);
      const fA = await doc.embedFont(b1, { subset: true });   // Arial/Helvetica-подобный: обложка, таблица предложения
      const fI = await doc.embedFont(b2, { subset: true });   // узкий, ближе всего к ISOCPEUR: чертежи и таблицы характеристик
      const fT = await doc.embedFont(b3, { subset: true });   // Tahoma-подобный: подписи на обложке и в итогах
      const pg = doc.getPages();

      /* ---------- помощники ---------- */
      const rot = p => p.getRotation().angle;
      const rect = (p, x0, y0, x1, y1, c = WHITE) => {
        const H = p.getHeight();
        if (rot(p) === 90) p.drawRectangle({ x: y0, y: x0, width: y1 - y0, height: x1 - x0, color: c, borderWidth: 0 });
        else p.drawRectangle({ x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: c, borderWidth: 0 });
      };
      // vx — якорь по горизонтали, vy — базовая линия; hs — сжатие по ширине; maxW — не шире; dir:'down' — как у цифр плат на стр. 7
      const put = (p, str, vx, vy, size, o = {}) => {
        const f = o.f || fI, w0 = f.widthOfTextAtSize(str, size);
        let hs = o.hs || 1; if (o.maxW && w0 * hs > o.maxW) hs = o.maxW / w0;
        const w = w0 * hs; if (o.a === 'c') vx -= w / 2; else if (o.a === 'r') vx -= w;
        const r = rot(p), H = p.getHeight(), th = (((o.dir === 'down' ? -90 : 0) + r) * Math.PI) / 180;
        const ux = r === 90 ? vy : vx, uy = r === 90 ? vx : H - vy;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(hs * Math.cos(th), hs * Math.sin(th), -Math.sin(th), Math.cos(th), ux, uy));
        p.drawText(str, { x: 0, y: 0, size, font: f, color: o.c || BLACK });
        p.pushOperators(popGraphicsState());
      };
      // заменить надпись из таблицы FIELDS: стереть ровно её глифы и вписать новую на ту же базовую линию, тем же цветом
      const edit = (name, str, o = {}) => {
        const [pi, x0, x1, base, size, top, bot, col] = FIELDS[name], p = pg[pi];
        rect(p, x0, top, x1, bot);
        const a = o.a || 'c', ax = o.ax ?? (a === 'l' ? x0 + .4 : a === 'r' ? x1 - .4 : (o.cx ?? (x0 + x1) / 2));
        put(p, str, ax, base, (o.size || size) * (o.k || 1.02), { f: o.f || fI, a, c: rgb(...col), maxW: o.maxW, hs: o.hs });
      };
      // цифра на плате: текст на странице идёт сверху вниз, «верх» букв — вправо; базовая линия — левый край
      const board = (name, str) => {
        const [pi, x0, x1, , , top, bot, col] = FIELDS[name], p = pg[pi], sz = 5.6, hs = .65, w = fI.widthOfTextAtSize(str, sz) * hs;
        rect(p, x0 - .2, top - .3, x1 + .2, bot + .3);
        put(p, str, x0 + .4, (top + bot) / 2 - w / 2, sz, { f: fI, dir: 'down', hs, c: rgb(...col) });
      };
      const stamp = (name, land) => edit(name, s.mark, { size: 10, k: 1, a: 'c', ...(land ? STAMP_LAND : STAMP_PORT) });
      const wrap = (str, f, size, maxW) => {
        const out = []; let cur = '';
        for (const w of str.split(' ')) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
        out.push(cur); return out;
      };

      /* ---------- обложка ---------- */
      rect(pg[0], 37.4, 711.6, 200.6, 733.6, BAND);
      put(pg[0], s.mark, 38, 727.9, 20, { f: fA, c: WHITE, maxW: 515 });
      if (s.who) put(pg[0], s.who, 110, 758.1, 13, { f: fT, c: WHITE, maxW: 250 });
      put(pg[0], new Date().toLocaleDateString('ru-RU'), 490, 758.1, 13, { f: fT, c: WHITE });

      /* ---------- стр. 3: предложение ---------- */
      rect(pg[3], 101, 153.5, 344, 212.5);
      wrap(s.name, fA, 10, 238).forEach((l, i) => put(pg[3], l, 102.4, 162.8 + i * 11.15, 10, { f: fA }));
      put(pg[3], String(s.qty), 373.6, 241.4, 12, { f: fA, a: 'r' });
      if (s.price) {
        put(pg[3], money(s.price), 471, 241.4, 12, { f: fA, a: 'c' });
        put(pg[3], money(s.price * s.qty), 252.4, 359.6, 12, { f: fT, a: 'c', c: NAVY });
      }

      /* ---------- стр. 5: маркировка (подчёркивания и выноски шаблона остаются) ---------- */
      const m = s.m, SL = [[200.4, 236], [236, 247], [247, 273], [273, 285.3], [285.3, 296.3], [296.3, 325.1], [325.1, 347], [347, 366.1], [366.1, 377.1],
        [377.1, 389.5], [389.5, 401.8], [401.8, 422.3], [422.3, 431.9], [431.9, 442.9], [442.9, 453.9], [453.9, 477.2], [477.2, 489.5], [489.5, 501.8],
        [501.8, 511.4], [511.4, 534.7], [534.7, 545.7]];
      const G = [m[1], 'P', m[2], 'А', 'T', m[3].slice(1), m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15], '-', m[16], m[17]];
      rect(pg[5], 81.4, 120.4, 546.6, 135.6);
      put(pg[5], 'ESQ F ME800-', 82.5, 134.7, 20.5, { f: fI, maxW: 117.5 });
      G.forEach((t, i) => {                                  // двухбуквенное значение в узкой ячейке (например 2E) — уменьшаем кегль, а не только сжимаем
        const sw = SL[i][1] - SL[i][0] - .6; let sz = 20.5;
        if (fI.widthOfTextAtSize(t, sz) / sw > 1.45) sz = 20.5 * .62;
        put(pg[5], t, (SL[i][0] + SL[i][1]) / 2, 134.7, sz, { f: fI, a: 'c', maxW: sw });
      });

      /* ---------- стр. 6: схема коммутации ---------- */
      if (!s.film) edit('p6_v', s.sec + 'V', { a: 'l', maxW: 19.3 });   // та же ширина, что у «710V»
      if (s.kv === 10) edit('p6_in', '10кВ, 50Гц, 3ф.', { a: 'l' });
      edit('p6_out', s.kv + 'кВ, до ' + s.P + 'кВт', { a: 'c' });
      stamp('p6_stamp', true);

      /* ---------- стр. 7: топология ---------- */
      if (s.n !== 6) {
        const ph = ['A', 'B', 'C'], a = s.n - 1, b = s.n;
        ['A5', 'B5', 'C5'].forEach((k, i) => edit('p7_' + k, ph[i] + a, { size: 9.13 }));
        ['A6', 'B6', 'C6'].forEach((k, i) => edit('p7_' + k, ph[i] + b, { size: 9.13 }));
      }
      board('p7_b7', String(s.n - 1));                        // номера плат приёмопередатчиков (последние две)
      board('p7_b8', String(s.n));
      if (s.kv === 10) edit('p7_motor', '10 кВ', { a: 'l' });
      stamp('p7_stamp', false);

      /* ---------- стр. 8, 9 ---------- */
      stamp('p8_stamp', true);
      if (s.kv === 10) edit('p9_v', '10 кВ.', { a: 'l' });
      stamp('p9_stamp', false);

      /* ---------- стр. 10: вес, штамп, чертёж ---------- */
      const kg = isNaN(s.wT) ? '—' : String(Math.round(s.wT * 1000));
      edit('p10_w1', kg, { size: 9.5, k: 1 });
      edit('p10_w2', kg, { size: 9.5, k: 1 });
      stamp('p10_stamp', true);
      if (!s.film) await drawDrawing(doc, pg[10], rect);   // для плёнки остаётся чертёж из шаблона: габариты 1800×1425×2431 общие для 6 и 10 кВ

      /* ---------- стр. 13 ---------- */
      edit('p13_name', s.mark, { cx: 406, maxW: 296 });
      edit('p13_p', s.P + ' кВт', { cx: 410 });
      edit('p13_i', s.I + ' А', { cx: 410 });
      if (s.kv === 10) {
        edit('p13_u', '10000 В ±10%', { cx: 411 });
        edit('p13_uout', '0-10 кВ', { cx: 410.5 });
      }
      if (!s.film) edit('p13_eff', 'не менее 96%', { cx: 408.3 });
      if (s.n !== 6) edit('p13_n', s.n + ' ячеек', { cx: 412.6 });
      edit('p13_mat', s.cu ? 'медь' : 'алюминий', { a: 'l' });
      edit('p13_cb', s.cb === 'B' ? 'Присутствует' : 'Отсутствует', { cx: 410 });

      /* ---------- стр. 14 ---------- */
      edit('p14_ip', s.ip, { a: 'l' });
      if (s.film) edit('p14_life', s.life, { a: 'l', maxW: 31.6, size: 11 });
      if (!s.film) edit('p14_cap', 'Электролитические', { cx: 409.5 });
      edit('p14_ups', s.ups ? 'Присутствует' : 'Отсутствует', { cx: 410 });
      if (s.proto !== 'Modbus RTU') edit('p14_proto', s.proto, { cx: 409.9 });
      edit('p14_w', isNaN(s.wT) ? '—' : String(s.wT).replace('.', ','), { a: 'r', ax: 412.8 });
      edit('p14_cable', s.cable === 'T' ? 'Сверху' : 'Снизу', { cx: 410 });
      if (s.reactor) edit('p14_reactor', 'Присутствует', { cx: 410 });

      /* ---------- стр. 15: отпайки первичной обмотки для 10 кВ ---------- */
      if (s.kv === 10) edit('p15_taps', '9,5 и 10,5 кВ', { a: 'l', maxW: 51.5 });

      const out = await doc.save();
      const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = 'TKP_' + s.mark.replace(/\u0410/g, 'A').replace(/ /g, '_') + '.pdf';   // имя файла только латиницей: так оно не теряется в браузерах
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert('Не удалось сформировать ТКП: ' + e.message); }
    finally { if (btn) btn.style.opacity = 1; }
  }

  /* Габаритный чертёж для электролитов: поле чертежа шаблона очищается (рамки, штамп и таблица веса остаются) и вставляется файл из assets/ */
  async function drawDrawing(doc, page, rect) {
    const url = await window.findFirstExisting(window.buildDrawingCandidates());
    if (!url) { alert('Габаритный чертёж не найден в assets/ — в ТКП оставлен чертёж из шаблона (для плёночных конденсаторов).'); return; }
    const buf = await (await fetch(url)).arrayBuffer();
    let w, h, draw;
    if (/\.png$/i.test(url)) { const im = await doc.embedPng(buf); w = im.width; h = im.height; draw = o => page.drawImage(im, o); }
    else if (/\.jpe?g$/i.test(url)) { const im = await doc.embedJpg(buf); w = im.width; h = im.height; draw = o => page.drawImage(im, o); }
    else { const [em] = await doc.embedPdf(buf, [0]); w = em.width; h = em.height; draw = o => page.drawPage(em, o); }
    const B = [116, 105, 714, 411], bw = B[2] - B[0], bh = B[3] - B[1], H = page.getHeight();   // ниже 411 — «Вид сверху» и таблица веса (её верх 421,6)
    rect(page, 112, 103, 718, 416);                  // поле чертежа
    rect(page, 112, 416, 471.5, 480);                // подпись «Вид сверху» слева от таблицы веса
    const k = Math.min(bw / w, bh / h), dw = w * k, dh = h * k;
    draw({ x: B[0] + (bw - dw) / 2, y: H - (B[1] + (bh - dh) / 2) - dh, width: dw, height: dh });
  }

  window.downloadTKP = generate;
})();
