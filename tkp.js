/* Генератор ТКП для конфигуратора ESQ F ME800.
   Берёт assets/template.pdf и меняет в нём только надписи, зависящие от комплектации.

   Буквы рисуются контурами из assets/glyphs.json. Контуры сняты с шрифтов, встроенных в сам шаблон
   (ISOCPEUR — чертежи и таблицы, Arial — таблица предложения, Tahoma — обложка), поэтому вставки
   выглядят как исходный текст и одинаково отображаются и печатаются в любой программе.
   Шрифты в PDF не встраиваются, fontkit не нужен.

   Координаты — pt от левого верхнего угла страницы «как её видит человек».
   Таблица FIELDS снята с шаблона: границы надписи, базовая линия, кегль и цвет. */
(function () {
  'use strict';
  const { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
    rectangle, clipEvenOdd, endPath, decodePDFRawStream } = window.PDFLib;
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
    p7_A5: [7, 229.99, 252.34, 397.98, 9.13, 390.46, 401.05, [0.067, 0.412, 0.455]],
    p7_B5: [7, 259.43, 281.67, 421.56, 9.13, 414.04, 424.63, [0.067, 0.412, 0.455]],
    p7_C5: [7, 288.76, 311.11, 445.14, 9.13, 437.63, 448.11, [0.067, 0.412, 0.455]],
    p7_A6: [7, 229.99, 252.34, 468.72, 9.13, 461.1, 471.69, [0.067, 0.412, 0.455]],
    p7_B6: [7, 259.43, 281.67, 492.12, 9.13, 484.68, 495.16, [0.067, 0.412, 0.455]],
    p7_C6: [7, 288.76, 311.11, 515.7, 9.13, 508.15, 518.75, [0.067, 0.412, 0.455]],
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
    p13_uout: [13, 394.88, 426.1, 238.03, 10.99, 229.33, 239.6, [0.0, 0.0, 0.0]],
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
    s.g4 = s.film && (!window.isPFNCabinet || window.isPFNCabinet(s.v, s.P));   // компактный шкаф G4 — в шаблоне уже его чертёж
    s.g4x = s.g4 && !!(window.pfExtrasCode && window.pfExtrasCode());          // шкаф G4 + доп. шкафы — свой чертёж из assets/drawings_pf/
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

  /* ---------- векторный текст ---------- */
  function makeFonts(GL, helv) {
    const F = {};
    for (const key of ['iso', 'arial', 'tahoma']) {
      const f = GL[key], upm = f.upm, g = f.g;
      const glyph = ch => g[ch] || g[ch.normalize('NFD')[0]] || g['?'] || g[' '];
      F[key] = {
        upm, cap: f.cap,
        width: (str, size) => [...str].reduce((a, ch) => a + glyph(ch)[0], 0) * size / upm,
        path(str) {                                            // один SVG-путь на всю строку, в единицах шрифта
          let x = 0, out = '';
          for (const ch of str) {
            const [w, cmds] = glyph(ch);
            for (const c of cmds) {
              out += c[0];
              for (let i = 1; i < c.length; i += 2) out += (i > 1 ? ',' : '') + +(c[i] + x).toFixed(1) + ',' + c[i + 1];
              out += ' ';
            }
            x += w;
          }
          return out;
        }
      };
    }
    F.helv = { std: helv, width: (str, size) => helv.widthOfTextAtSize(str, size) };  // для надписей, набранных в шаблоне Helvetica
    return F;
  }

  /* Старый чертёж шаблона (стр. 10) для электролитов. Зоны сняты с шаблона: рамка 110,7…720,3; заголовок до 102,5;
     таблица веса 472,5…570,1 × 421,6…481,6; штамп от 489,2 — всё это вне зон и остаётся. */
  const OLD_DRAWING_ZONES = [
    [111.2, 103.3, 719.8, 420.9],   // поле видов
    [111.2, 420.9, 471.9, 488.0],   // слева от таблицы веса («Вид сверху»)
    [570.7, 420.9, 719.8, 488.0],   // справа от таблицы веса (нижние выноски)
    [471.9, 482.3, 570.7, 488.0]    // под таблицей веса
  ];

  /* Маски. Старое значение не закрывается белым прямоугольником, а вырезается: исходное содержимое страницы
     обёрнуто в область отсечения «страница минус зоны», поэтому внутри зон оно не рисуется и не печатается.
     Каждая зона вычитается отдельным отсечением, так что пересекающиеся зоны тоже работают. */
  function prepareMasks(doc, pages) {
    const slots = pages.map(p => {
      p.node.normalize();
      const arr = p.node.Contents();
      const pre = doc.context.register(doc.context.stream(' ')), post = doc.context.register(doc.context.stream(' '));
      arr.insert(0, pre); arr.push(post);
      return { p, pre, post, zones: [] };
    });
    return {
      add(i, x0, y0, x1, y1) { slots[i].zones.push([x0, y0, x1, y1]); },   // зона в координатах «как на экране»
      apply() {
        for (const sl of slots) {
          if (!sl.zones.length) continue;
          const W = sl.p.getWidth(), H = sl.p.getHeight(), r = sl.p.getRotation().angle, n = v => +v.toFixed(2);
          let op = 'q\n';
          for (const [x0, y0, x1, y1] of sl.zones) {
            const [a, b, c, d] = r === 90 ? [y0, x0, y1, x1] : [x0, H - y1, x1, H - y0];   // /Rotate 90 у стр. 7 и 9
            op += `0 0 ${n(W)} ${n(H)} re ${n(a)} ${n(b)} ${n(c - a)} ${n(d - b)} re W* n\n`;
          }
          doc.context.assign(sl.pre, doc.context.stream(op));
          doc.context.assign(sl.post, doc.context.stream('\nQ\n'));
        }
      }
    };
  }

  /* Удалить строку текста из потока страницы (обложка: «ESQ F ME800-PF»). Возвращает true, если нашла. */
  function deleteLiteral(doc, page, literal) {
    const pat = Array.from('(' + literal + ')', ch => ch.charCodeAt(0));
    const arr = page.node.Contents();
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i), st = doc.context.lookup(ref);
      if (!st || !st.dict || !st.contents) continue;
      let bytes; try { bytes = decodePDFRawStream(st).decode(); } catch (e) { continue; }
      outer: for (let j = 0; j + pat.length <= bytes.length; j++) {
        for (let k = 0; k < pat.length; k++) if (bytes[j + k] !== pat[k]) continue outer;
        const out = new Uint8Array(bytes.length - pat.length + 2);
        out.set(bytes.subarray(0, j)); out[j] = 40; out[j + 1] = 41; out.set(bytes.subarray(j + pat.length), j + 2);   // «(…)» → «()»
        doc.context.assign(ref, doc.context.flateStream(out));   // поток содержимого страницы: словарь, кроме сжатия, не нужен
        return true;
      }
    }
    return false;
  }

  async function generate(ev) {
    if (ev) ev.preventDefault();
    const btn = ev && ev.currentTarget; if (btn) btn.style.opacity = .6;
    try {
      const s = readState();
      if (!s.m) throw new Error('не удалось разобрать маркировку: ' + s.mark);
      const get = u => fetch(u).then(r => { if (!r.ok) throw new Error('Не найден файл ' + u); return r; });
      const [tpl, GL] = await Promise.all([get('assets/template.pdf').then(r => r.arrayBuffer()), get('assets/glyphs.json').then(r => r.json())]);
      const doc = await PDFDocument.load(tpl);
      const F = makeFonts(GL, await doc.embedFont(StandardFonts.Helvetica));
      const pg = doc.getPages();
      const M = prepareMasks(doc, pg);
      if (!s.g4 || s.g4x) OLD_DRAWING_ZONES.forEach(z => M.add(10, ...z));   // чертёж шаблона остаётся только для «голого» шкафа G4

      /* ---------- помощники ---------- */
      const rot = p => p.getRotation().angle;
      const rect = (p, x0, y0, x1, y1, c = WHITE) => {
        const H = p.getHeight();
        if (rot(p) === 90) p.drawRectangle({ x: y0, y: x0, width: y1 - y0, height: x1 - x0, color: c, borderWidth: 0 });
        else p.drawRectangle({ x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: c, borderWidth: 0 });
      };
      /* vx — якорь по горизонтали, vy — базовая линия; o.f — шрифт (iso | arial | tahoma | helv);
         o.hs — сжатие по ширине, o.maxW — не шире (сжимается), o.skew — наклон курсива, o.dir:'down' — текст сверху вниз */
      const put = (p, str, vx, vy, size, o = {}) => {
        const f = F[o.f || 'iso'], w0 = f.width(str, size);
        let hs = o.hs || 1; if (o.maxW && w0 * hs > o.maxW) hs = o.maxW / w0;
        const w = w0 * hs; if (o.a === 'c') vx -= w / 2; else if (o.a === 'r') vx -= w;
        const r = rot(p), H = p.getHeight(), th = (((o.dir === 'down' ? -90 : 0) + r) * Math.PI) / 180, k = o.skew || 0;
        const cs = Math.cos(th), sn = Math.sin(th), ux = r === 90 ? vy : vx, uy = r === 90 ? vx : H - vy;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(cs * hs, sn * hs, cs * k - sn, sn * k + cs, ux, uy));
        if (f.std) p.drawText(str, { x: 0, y: 0, size, font: f.std, color: o.c || BLACK });
        else p.drawSvgPath(f.path(str), { x: 0, y: 0, scale: size / f.upm, color: o.c || BLACK, borderWidth: 0 });
        p.pushOperators(popGraphicsState());
      };
      // заменить надпись из таблицы FIELDS: стереть ровно её глифы и вписать новую на ту же базовую линию, тем же цветом
      const edit = (name, str, o = {}) => {
        const [pi, x0, x1, base, size, top, bot, col] = FIELDS[name], p = pg[pi];
        // с небольшим запасом, чтобы не оставалось тонких следов от краёв старых знаков (у ячеек топологии — ровно внутренность рамки)
        if (/^p7_[ABC]/.test(name)) M.add(pi, x0, top, x1, bot); else M.add(pi, x0 - .5, top - .7, x1 + .5, bot + .6);
        const a = o.a || 'c', ax = o.ax ?? (a === 'l' ? x0 + .4 : a === 'r' ? x1 - .4 : (o.cx ?? (x0 + x1) / 2));
        put(p, str, ax, base, o.size || size, { f: 'iso', a, c: rgb(...col), maxW: o.maxW, hs: o.hs, skew: o.skew });
      };
      // цифра на плате приёмопередатчика (стр. 7): текст повёрнут, читается сверху вниз
      const board = (name, str) => {
        const [pi, x0, x1, , , top, bot, col] = FIELDS[name], p = pg[pi], sz = 3.6 * F.iso.upm / F.iso.cap, w = F.iso.width(str, sz);
        M.add(pi, x0 - .3, top - .4, x1 + .3, bot + .4);
        put(p, str, x0 + .5, (top + bot) / 2 - w / 2, sz, { dir: 'down', c: rgb(...col) });
      };
      const stamp = (name, land) => edit(name, s.mark, { size: 10.5, ...(land ? STAMP_LAND : STAMP_PORT) });
      const wrap = (str, f, size, maxW) => {
        const out = []; let cur = '';
        for (const w of str.split(' ')) { const t = cur ? cur + ' ' + w : w; if (F[f].width(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
        out.push(cur); return out;
      };

      /* ---------- обложка (в шаблоне: Helvetica 20 и Tahoma 14, белым по бирюзовой плашке) ---------- */
      if (!deleteLiteral(doc, pg[0], 'ESQ F ME800-PF')) rect(pg[0], 37.4, 711.6, 200.6, 733.6, BAND);   // если строку не нашли — закрыть цветом плашки
      put(pg[0], s.mark.replace(/А/g, 'A'), 38.4, 727.9, 20, { f: 'helv', c: WHITE, maxW: 515 });
      if (s.who) put(pg[0], s.who, 108, 758.7, 14, { f: 'tahoma', c: WHITE, maxW: 300 });
      put(pg[0], new Date().toLocaleDateString('ru-RU'), 489, 755.7, 14, { f: 'tahoma', c: WHITE });

      /* ---------- стр. 3: предложение (Arial 10; количество и цена — Helvetica 12) ---------- */
      M.add(3, 101, 153.5, 344, 212.5);
      wrap(s.name, 'arial', 10, 238).forEach((l, i) => put(pg[3], l, 102.4, 162.8 + i * 11.15, 10, { f: 'arial' }));
      put(pg[3], String(s.qty), 373.6, 241.4, 12, { f: 'helv', a: 'r' });
      if (s.price) {
        put(pg[3], money(s.price), 471, 241.4, 12, { f: 'helv', a: 'c' });
        put(pg[3], money(s.price * s.qty), 252.4, 359.6, 12, { f: 'tahoma', a: 'c', c: NAVY });
      }

      /* ---------- стр. 5: маркировка — подчёркивания и выноски шаблона остаются, меняются только буквы ---------- */
      const m = s.m, SL = [[200.4, 236], [236, 247], [247, 273], [273, 285.3], [285.3, 296.3], [296.3, 325.1], [325.1, 347], [347, 366.1], [366.1, 377.1],
        [377.1, 389.5], [389.5, 401.8], [401.8, 422.3], [422.3, 431.9], [431.9, 442.9], [442.9, 453.9], [453.9, 477.2], [477.2, 489.5], [489.5, 501.8],
        [501.8, 511.4], [511.4, 534.7], [534.7, 545.7]];
      const G = [m[1], 'P', m[2], 'А', 'T', m[3].slice(1), m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15], '-', m[16], m[17]];
      const MS = 13.5 * F.iso.upm / F.iso.cap;                 // высота прописных как в шаблоне — 13,5 pt
      M.add(5, 200.2, 120.4, 546.6, 135.6);
      G.forEach((t, i) => {
        const sw = SL[i][1] - SL[i][0] - .6; let sz = MS;
        if (F.iso.width(t, sz) / sw > 1.45) sz = MS * .62;     // «2E» в узкой ячейке — мельче, а не сплющено
        put(pg[5], t, (SL[i][0] + SL[i][1]) / 2, 134.7, sz, { a: 'c', maxW: sw });
      });

      /* ---------- стр. 6: схема коммутации ---------- */
      if (!s.film) edit('p6_v', s.sec + 'V', { a: 'l' });
      if (s.kv === 10) edit('p6_in', '10кВ, 50Гц, 3ф.', { a: 'l' });
      edit('p6_out', s.kv + 'кВ, до ' + s.P + 'кВт', { a: 'c' });
      stamp('p6_stamp', true);

      /* ---------- стр. 7: топология ---------- */
      if (s.n !== 6) {
        const ph = ['A', 'B', 'C'];
        const X = [235.05, 264.38, 293.82];                    // левый край подписи, как в шаблоне; стирается только внутренность рамки ячейки
        ['A5', 'B5', 'C5'].forEach((k, i) => edit('p7_' + k, ph[i] + (s.n - 1), { size: 9.13, a: 'l', ax: X[i] }));
        ['A6', 'B6', 'C6'].forEach((k, i) => edit('p7_' + k, ph[i] + s.n, { size: 9.13, a: 'l', ax: X[i] }));
      }
      board('p7_b7', String(s.n - 1));                         // номера двух последних плат приёмопередатчиков
      board('p7_b8', String(s.n));
      if (s.kv === 10) edit('p7_motor', '10 кВ', { a: 'l' });
      stamp('p7_stamp', false);

      /* ---------- стр. 8, 9 ---------- */
      stamp('p8_stamp', true);
      if (s.kv === 10) edit('p9_v', '10 кВ.', { a: 'l' });
      stamp('p9_stamp', false);

      /* ---------- стр. 10: вес (курсив, как в таблице), штамп, чертёж ---------- */
      const kg = isNaN(s.wT) ? '—' : String(Math.round(s.wT * 1000));
      edit('p10_w1', kg, { size: 8.8, skew: .27 });
      edit('p10_w2', kg, { size: 8.8, skew: .27 });
      stamp('p10_stamp', true);
      if (s.film && !s.g4) alert('Напоминание: для плёночного ПЧ этой мощности габаритный чертёж в ТКП не вставляется — страница чертежа останется пустой. Приложите чертёж к ТКП отдельно.');
      else if (!s.g4 || s.g4x) await drawDrawing(doc, pg[10]);    // для шкафа G4 остаётся чертёж шаблона: 1800×1425×2431 общий для 6 и 10 кВ

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
      if (s.film) edit('p14_life', s.life, { a: 'l', maxW: 31.6 });
      if (!s.film) edit('p14_cap', 'Электролитические', { cx: 409.5 });
      edit('p14_ups', s.ups ? 'Присутствует' : 'Отсутствует', { cx: 410 });
      if (s.proto !== 'Modbus RTU') edit('p14_proto', s.proto, { cx: 409.9 });
      edit('p14_w', isNaN(s.wT) ? '—' : String(s.wT).replace('.', ','), { a: 'r', ax: 412.8 });
      edit('p14_cable', s.cable === 'T' ? 'Сверху' : 'Снизу', { cx: 410 });
      if (s.reactor) edit('p14_reactor', 'Присутствует', { cx: 410 });

      /* ---------- стр. 15: отпайки первичной обмотки для 10 кВ ---------- */
      if (s.kv === 10) edit('p15_taps', '9,5 и 10,5 кВ', { a: 'l', maxW: 51.5 });

      M.apply();
      const out = await doc.save();
      const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url;
      link.download = 'TKP_' + s.mark.replace(/А/g, 'A').replace(/ /g, '_') + '.pdf';   // имя латиницей: так оно не теряется в браузерах
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert('Не удалось сформировать ТКП: ' + e.message); }
    finally { if (btn) btn.style.opacity = 1; }
  }

  /* ================= Габаритный чертёж для электролитов =================
     Файл чертежа из assets/ — обычно целый лист: рамка, поле подшивки, основная надпись.
     Лист рендерится через pdf.js в картинку, по ней находятся рамка и основная надпись,
     затем из исходного PDF вырезается (в векторе) только поле с видами, а основная надпись закрывается.
     Если рамку найти не удалось — вставляется весь лист, как раньше. */
  const PDFJS_BASE = new URL(window.PDFJS_BASE || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/', document.baseURI).href;
  let pdfjsP = null;
  const loadPdfjs = () => pdfjsP || (pdfjsP = import(PDFJS_BASE + 'pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs'; return m;
  }));

  // поиск рамки, основной надписи и границ изображения на отрисованном листе (пиксели, вид «как на экране»)
  function findLayout(img, W, H) {
    const d = img.data, dark = new Uint8Array(W * H);
    for (let i = 0, j = 0; j < W * H; i += 4, j++) dark[j] = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11 < 170 ? 1 : 0;
    const D = (x, y) => dark[y * W + x];
    const run = (get, n) => {                                   // самый длинный отрезок линии (разрывы до 2 px допускаются)
      let best = [0, -1, -1], s = -1, last = -1, gap = 0;
      for (let i = 0; i < n; i++) {
        if (get(i)) { if (s < 0) s = i; last = i; gap = 0; }
        else if (s >= 0 && ++gap > 2) { if (last - s > best[0]) best = [last - s, s, last]; s = -1; }
      }
      if (s >= 0 && last - s > best[0]) best = [last - s, s, last];
      return best;
    };
    const rows = [], cols = [];
    for (let y = 0; y < H; y++) { const r = run(x => D(x, y), W); if (r[0] >= .5 * W) rows.push({ y, s: r[1], e: r[2] }); }
    for (let x = 0; x < W; x++) { const r = run(y => D(x, y), H); if (r[0] >= .5 * H) cols.push({ x, s: r[1], e: r[2] }); }
    const lc = cols.filter(c => c.x < .2 * W), rc = cols.filter(c => c.x > .8 * W);
    if (!lc.length || !rc.length) return null;
    const L = Math.max(...lc.map(c => c.x)), R = Math.min(...rc.map(c => c.x));          // внутренние края рамки
    const span = r => r.s <= L + .03 * W && r.e >= R - .03 * W;
    const tr = rows.filter(r => r.y < .2 * H && span(r)), br = rows.filter(r => r.y > .8 * H && span(r));
    if (!tr.length || !br.length) return null;
    const T = Math.max(...tr.map(r => r.y)), B = Math.min(...br.map(r => r.y));
    const fw = R - L, fh = B - T;

    // основная надпись: левая граница — вертикаль, стоящая на нижней линии рамки, с горизонталью от неё до правой рамки
    let tb = null;
    const up = x => { let n = 0, gap = 0; for (let y = B - 1; y > T; y--) { if (D(x, y)) { n = B - y; gap = 0; } else if (++gap > 2) break; } return n; };
    for (let x = Math.round(L + .3 * fw); x < R - .05 * fw && !tb; x++) {
      const h = up(x);
      if (h < .05 * fh || h > .5 * fh) continue;
      const y = B - h;
      for (let yy = y - 2; yy <= y + 2; yy++) {
        let c = 0; for (let xx = x; xx <= R; xx++) c += D(xx, yy);
        if (c >= .85 * (R - x)) { tb = [x, y, R, B]; break; }
      }
    }

    // границы изображения внутри рамки без основной надписи
    const ins = 4; let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = T + ins; y < B - ins; y++) for (let x = L + ins; x < R - ins; x++) {
      if (!D(x, y) || (tb && x >= tb[0] - 3 && y >= tb[1] - 3)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const pad = Math.round(.012 * Math.max(W, H));
    const box = [Math.max(L + 2, x0 - pad), Math.max(T + 2, y0 - pad), Math.min(R - 2, x1 + pad), Math.min(B - 2, y1 + pad)];
    return { box, tb };
  }

  async function drawDrawing(doc, page) {
    const url = await window.findFirstExisting(window.buildDrawingCandidates());
    if (!url) { alert('Габаритный чертёж для этой мощности не найден в assets/ — поле чертежа в ТКП оставлено пустым.'); return; }
    const buf = await (await fetch(url)).arrayBuffer();
    const A = [116, 105, 714, 411], aw = A[2] - A[0], ah = A[3] - A[1], H = page.getHeight();   // ниже 411 — таблица веса (её верх 421,6)
    const fit = (w, h) => { const k = Math.min(aw / w, ah / h); return { k, dw: w * k, dh: h * k, X: A[0] + (aw - w * k) / 2, Y: A[1] + (ah - h * k) / 2 }; };

    if (/\.(png|jpe?g)$/i.test(url)) {                // картинка: обрезаем на canvas
      const im = await createImageBitmap(new Blob([buf]));
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0);
      const lay = findLayout(cx.getImageData(0, 0, cv.width, cv.height), cv.width, cv.height);
      let [bx0, by0, bx1, by1] = lay ? lay.box : [0, 0, cv.width, cv.height];
      if (lay && lay.tb) { cx.fillRect(lay.tb[0] - 3, lay.tb[1] - 3, lay.tb[2] - lay.tb[0] + 6, lay.tb[3] - lay.tb[1] + 6); }
      const out = document.createElement('canvas'); out.width = bx1 - bx0; out.height = by1 - by0;
      out.getContext('2d').drawImage(cv, bx0, by0, out.width, out.height, 0, 0, out.width, out.height);
      const png = await doc.embedPng(await (await new Promise(r => out.toBlob(r, 'image/png'))).arrayBuffer());
      const f = fit(out.width, out.height);
      page.drawImage(png, { x: f.X, y: H - f.Y - f.dh, width: f.dw, height: f.dh });
      return;
    }

    // PDF: находим поле чертежа по картинке листа и вырезаем его из исходного PDF в векторе
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const srcPage = src.getPage(0);
    let lay = null, vp = null, rot = srcPage.getRotation().angle % 360;
    try {
      const pdfjs = await loadPdfjs();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      const p1 = await pdf.getPage(1);
      const v1 = p1.getViewport({ scale: 1 });
      vp = p1.getViewport({ scale: 1800 / Math.max(v1.width, v1.height) });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await p1.render({ canvas: cv, canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
      lay = findLayout(ctx.getImageData(0, 0, cv.width, cv.height), cv.width, cv.height);
      rot = ((p1.rotate % 360) + 360) % 360;
      pdf.destroy();
    } catch (e) { console.warn('Не удалось разобрать лист чертежа, вставляю целиком:', e); lay = null; }

    let bbox, vw, vh;                                  // bbox — в координатах исходного PDF; vw×vh — видимый размер вырезки (pt)
    if (lay) {
      const [ax, ay] = vp.convertToPdfPoint(lay.box[0], lay.box[1]), [bx, by] = vp.convertToPdfPoint(lay.box[2], lay.box[3]);
      bbox = { left: Math.min(ax, bx), right: Math.max(ax, bx), bottom: Math.min(ay, by), top: Math.max(ay, by) };
      vw = (lay.box[2] - lay.box[0]) / vp.scale; vh = (lay.box[3] - lay.box[1]) / vp.scale;
    } else {
      const mb = srcPage.getMediaBox();
      bbox = { left: mb.x, bottom: mb.y, right: mb.x + mb.width, top: mb.y + mb.height };
      [vw, vh] = rot % 180 ? [mb.height, mb.width] : [mb.width, mb.height];
    }
    const em = await doc.embedPage(srcPage, bbox);
    const f = fit(vw, vh), X = f.X, Y = H - f.Y - f.dh; // нижний левый угол вырезки на листе ТКП
    // /Rotate исходного листа: встроенная страница рисуется без него, поэтому поворачиваем сами
    const cw = rot % 180 ? f.dh : f.dw, ch = rot % 180 ? f.dw : f.dh;
    const o = { 0: [X, Y], 90: [X, Y + f.dh], 180: [X + f.dw, Y + f.dh], 270: [X + f.dw, Y] }[rot] || [X, Y];
    page.pushOperators(pushGraphicsState());
    if (lay && lay.tb) {                               // основная надпись листа, если попала в вырезку, отсекается
      const [bx0, by0, bx1, by1] = lay.box, k = f.dw / (bx1 - bx0);
      const tx0 = Math.max(bx0, lay.tb[0] - 3), ty0 = Math.max(by0, lay.tb[1] - 3);
      if (tx0 < bx1 && ty0 < by1) {
        const hx0 = f.X + (tx0 - bx0) * k, hy0 = f.Y + (ty0 - by0) * k, hx1 = f.X + f.dw + 1, hy1 = f.Y + f.dh + 1;
        page.pushOperators(rectangle(0, 0, page.getWidth(), H), rectangle(hx0, H - hy1, hx1 - hx0, hy1 - hy0), clipEvenOdd(), endPath());
      }
    }
    page.drawPage(em, { x: o[0], y: o[1], width: cw, height: ch, rotate: degrees(-rot) });
    page.pushOperators(popGraphicsState());
  }

  window.downloadTKP = generate;
})();
