/* Генератор ТКП для конфигуратора УПП ESQ F HVS.
   Берёт assets/upp/template.pdf и меняет в нём только надписи, зависящие от комплектации.

   Устроен так же, как tkp.js для ПЧ: буквы рисуются контурами из assets/glyphs.json (ISOCPEUR — таблицы и штампы,
   Arial — таблица предложения, Tahoma — обложка); шаблон УПП набран теми же шрифтами, поэтому вставки
   совпадают с исходным текстом. Старая надпись не закрывается белым прямоугольником, а вырезается отсечением.

   Координаты — pt от левого верхнего угла страницы «как её видит человек». Номера страниц — с нуля (0 — обложка). */
(function () {
  'use strict';
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, decodePDFRawStream } = window.PDFLib;
  const WHITE = rgb(1, 1, 1), BLACK = rgb(0, 0, 0), BAND = rgb(10 / 255, 105 / 255, 114 / 255), NAVY = rgb(.137, .122, .129);
  const LINE_H = rgb(10 / 255, 105 / 255, 114 / 255), LINE_V = rgb(32 / 255, 118 / 255, 126 / 255);   // линии таблицы стр. 8
  const PROTO = { MT: 'Modbus TCP', PB: 'Profibus DP', PN: 'ProfiNet', CO: 'CANopen', EI: 'EtherNet/IP' };
  const IFACE = { MT: 'Ethernet', PN: 'Ethernet', EI: 'Ethernet', CO: 'CAN' };
  const money = x => { const [a, b] = x.toFixed(2).replace(/\.00$/, '').split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (b ? ',' + b : ''); };

  /* name: [страница, x0, x1, базовая линия, кегль, верх, низ, сжатие по ширине] — сняты с шаблона */
  const FIELDS = {
    p4_stamp: [4, 334.87, 407.15, 712.6, 12.22, 702.74, 714.96, .9],
    p5_stamp: [5, 314.25, 404.8, 720.01, 12.22, 710.15, 722.37, .9],   // ширина — по самой длинной надписи из листов схем E и IK
    p6_name: [6, 368.03, 440.25, 144.07, 10.99, 135.2, 146.19, 1],
    p6_p: [6, 390.14, 426.27, 165.68, 10.99, 156.8, 167.8, 1],
    p6_i: [6, 400.21, 420.61, 184.96, 10.99, 176.09, 187.08, 1],
    p6_u: [6, 382.5, 434.68, 201.45, 10.99, 192.58, 203.73, 1],
    p6_motor: [6, 305.51, 499.8, 235.48, 10.99, 226.61, 237.61, 1],
    p6_ctl: [6, 368.73, 439.47, 277.55, 10.99, 268.68, 279.68, 1],
    p6_ctlV: [6, 389.15, 404.01, 277.55, 10.99, 268.68, 279.68, 1],   // только «220» в «АС ~220 В ±15%»
    p6_starts: [6, 324.27, 488.45, 294.99, 10.99, 286.12, 297.11, 1],
    p6_tmin: [6, 431.72, 441.63, 350.9, 10.99, 342.03, 353.02, 1],        // «20» в «-20 °С» (эксплуатация)
    p6_ol: [6, 257.0, 524.78, 692.4, 10.99, 683.52, 694.52, 1],
    p6_ul: [6, 375.6, 445.12, 715.9, 10.99, 707.03, 718.03, 1],
    p6_ult: [6, 345.84, 474.9, 727.78, 10.99, 718.91, 729.9, 1],
    p7_log: [7, 307.63, 496.15, 682.11, 10.99, 673.24, 684.23, 1],
    p10_tmin: [10, 277.46, 287.38, 666.08, 10.99, 657.2, 668.2, 1],      // «20» в «от -20⁰С» (эксплуатация)
    p7_proto: [7, 384.89, 433.07, 285.17, 10.99, 276.3, 287.29, 1],
    p7_iface: [7, 395.88, 427.77, 312.35, 10.99, 303.48, 314.47, 1],
    p8_ip: [8, 382.48, 399.49, 134.83, 10.99, 125.96, 136.95, 1],
    p8_dims: [8, 338.07, 442.9, 231.8, 10.99, 222.92, 233.92, 1],
    p8_srv: [8, 356.79, 423.38, 266.84, 10.99, 257.97, 268.96, 1],
    p8_cab: [8, 378.51, 402.95, 298.97, 10.99, 290.09, 301.09, 1],
    p8_kv: [8, 126.55, 143.05, 455.41, 9.13, 448.04, 457.17, 1],
    p8_L: [8, 170.5, 174.6, 529.6, 9.13, 521.7, 530.8, 1],
    p8_N: [8, 170.4, 175.1, 539.6, 9.13, 531.7, 540.8, 1],
    p11_srv: [11, 338.51, 418.54, 168.34, 10.99, 159.47, 170.2, 1]
  };

  /* ---------- векторный текст (как в tkp.js) ---------- */
  function makeFonts(GL, helv) {
    const F = {};
    for (const key of ['iso', 'arial', 'tahoma']) {
      const f = GL[key], upm = f.upm, g = f.g;
      const glyph = ch => g[ch] || g[ch.normalize('NFD')[0]] || g['?'] || g[' '];
      F[key] = {
        upm, cap: f.cap,
        width: (str, size) => [...str].reduce((a, ch) => a + glyph(ch)[0], 0) * size / upm,
        path(str) {
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
    F.helv = { std: helv, width: (str, size) => helv.widthOfTextAtSize(str, size) };
    return F;
  }

  /* Маски: исходное содержимое страницы обёрнуто в отсечение «страница минус зоны» */
  function prepareMasks(doc, pages) {
    const slots = pages.map(p => {
      p.node.normalize();
      const arr = p.node.Contents();
      const pre = doc.context.register(doc.context.stream(' ')), post = doc.context.register(doc.context.stream(' '));
      arr.insert(0, pre); arr.push(post);
      return { p, pre, post, zones: [] };
    });
    return {
      add(i, x0, y0, x1, y1) { slots[i].zones.push([x0, y0, x1, y1]); },
      apply() {
        for (const sl of slots) {
          if (!sl.zones.length) continue;
          const W = sl.p.getWidth(), H = sl.p.getHeight(), r = sl.p.getRotation().angle, n = v => +v.toFixed(2);
          let op = 'q\n';
          for (const [x0, y0, x1, y1] of sl.zones) {
            const [a, b, c, d] = r === 90 ? [y0, x0, y1, x1] : [x0, H - y1, x1, H - y0];   // /Rotate 90 у стр. 4
            op += `0 0 ${n(W)} ${n(H)} re ${n(a)} ${n(b)} ${n(c - a)} ${n(d - b)} re W* n\n`;
          }
          doc.context.assign(sl.pre, doc.context.stream(op));
          doc.context.assign(sl.post, doc.context.stream('\nQ\n'));
        }
      }
    };
  }

  /* Удалить текст из потока страницы: «X Y TD[…]TJ» → «X Y TD[]TJ». Возвращает число удалённых. */
  function deleteTJ(doc, page, patterns) {
    let done = 0;
    const arr = page.node.Contents();
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i), st = doc.context.lookup(ref);
      if (!st || !st.dict || !st.contents) continue;
      let bytes; try { bytes = decodePDFRawStream(st).decode(); } catch (e) { continue; }
      let changed = false;
      for (const pat of patterns) {
        const p = Array.from(pat, ch => ch.charCodeAt(0) & 255);
        const head = pat.indexOf('[') + 1, tail = pat.length - 3;     // сохраняем «X Y TD[» и «]TJ»
        outer: for (let j = 0; j + p.length <= bytes.length; j++) {
          for (let k = 0; k < p.length; k++) if (bytes[j + k] !== p[k]) continue outer;
          const out = new Uint8Array(bytes.length - (tail - head));
          out.set(bytes.subarray(0, j + head)); out.set(bytes.subarray(j + tail), j + head);
          bytes = out; changed = true; done++; break;
        }
      }
      if (changed) doc.context.assign(ref, doc.context.flateStream(bytes));
    }
    return done;
  }
  const SCHEMES = { E: 'assets/upp/scheme_E.pdf', IK: 'assets/upp/scheme_IK.pdf' };
  const COVER_MODEL = ['39.147 115.402 TD[(ESQ)0.000312( F HVS)-0.000623(06-75)]TJ'];
  const COVER_DATE = ['475.786 86.834 TD[(\x00\x15\x00\x15)]TJ', '487.098 86.834 TD[(.0)]TJ', '503.136 86.834 TD[(7)]TJ',
    '506.621 86.834 TD[(.2)0.004186(0)0.025116(2)0.004186(6)]TJ'];

  async function generate(ev) {
    if (ev) ev.preventDefault();
    const btn = ev && ev.currentTarget; if (btn) btn.style.opacity = .6;
    try {
      const s = window.uppState();
      const get = u => fetch(u).then(r => { if (!r.ok) throw new Error('Не найден файл ' + u); return r; });
      const [tpl, GL] = await Promise.all([get('assets/upp/template.pdf').then(r => r.arrayBuffer()), get('assets/glyphs.json').then(r => r.json())]);
      const doc = await PDFDocument.load(tpl);
      // исполнения E и IK — свой лист однолинейной схемы (стр. 5) из assets/upp/scheme_*.pdf, штамп на нём в том же месте
      if (SCHEMES[s.pkg]) {
        const src = await PDFDocument.load(await get(SCHEMES[s.pkg]).then(r => r.arrayBuffer()));
        const [pageE] = await doc.copyPages(src, [0]);
        doc.removePage(5); doc.insertPage(5, pageE);
      }
      const F = makeFonts(GL, await doc.embedFont(StandardFonts.Helvetica));
      const pg = doc.getPages();
      const M = prepareMasks(doc, pg);

      /* ---------- помощники ---------- */
      const rot = p => p.getRotation().angle;
      const rect = (p, x0, y0, x1, y1, c = WHITE) => {
        const H = p.getHeight();
        if (rot(p) === 90) p.drawRectangle({ x: y0, y: x0, width: y1 - y0, height: x1 - x0, color: c, borderWidth: 0 });
        else p.drawRectangle({ x: x0, y: H - y1, width: x1 - x0, height: y1 - y0, color: c, borderWidth: 0 });
      };
      const put = (p, str, vx, vy, size, o = {}) => {
        const f = F[o.f || 'iso'], w0 = f.width(str, size);
        let hs = o.hs || 1; if (o.maxW && w0 * hs > o.maxW) hs = o.maxW / w0;
        const w = w0 * hs; if (o.a === 'c') vx -= w / 2; else if (o.a === 'r') vx -= w;
        const r = rot(p), H = p.getHeight(), th = (r * Math.PI) / 180;
        const cs = Math.cos(th), sn = Math.sin(th), ux = r === 90 ? vy : vx, uy = r === 90 ? vx : H - vy;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(cs * hs, sn * hs, -sn, cs, ux, uy));
        if (f.std) p.drawText(str, { x: 0, y: 0, size, font: f.std, color: o.c || BLACK });
        else p.drawSvgPath(f.path(str), { x: 0, y: 0, scale: size / f.upm, color: o.c || BLACK, borderWidth: 0 });
        p.pushOperators(popGraphicsState());
      };
      // заменить надпись из FIELDS: вырезать её глифы и вписать новую на ту же базовую линию (по центру старой или от её левого края)
      const edit = (name, str, o = {}) => {
        const [pi, x0, x1, base, size, top, bot, hs] = FIELDS[name], p = pg[pi];
        M.add(pi, x0 - .5, top - .7, x1 + .5, bot + .6);
        const a = o.a || 'c', ax = o.ax ?? (a === 'l' ? x0 : a === 'r' ? x1 : (x0 + x1) / 2);
        put(p, str, ax, base, size, { f: 'iso', a, hs: o.hs || hs, maxW: o.maxW });
      };
      const fitLines = (str, f, maxW, maxH, sizes) => {          // перенос по словам, кегль уменьшается, пока текст не влезет
        for (const size of sizes) {
          const out = []; let cur = '';
          for (const w of str.split(' ')) { const t = cur ? cur + ' ' + w : w; if (F[f].width(t, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
          out.push(cur);
          if (out.length * size * 1.12 <= maxH || size === sizes[sizes.length - 1]) return { lines: out, size };
        }
      };

      /* ---------- обложка: Helvetica 24,48 и Tahoma 14 белым по бирюзовой плашке ---------- */
      if (!deleteTJ(doc, pg[0], COVER_MODEL)) rect(pg[0], 37.5, 705, 300, 734, BAND);
      put(pg[0], s.mark, 39.15, 726.64, 24.48, { f: 'helv', c: WHITE, maxW: 515 });
      if (deleteTJ(doc, pg[0], COVER_DATE) < COVER_DATE.length) rect(pg[0], 488, 742, 566, 761, BAND);
      put(pg[0], new Date().toLocaleDateString('ru-RU'), 490.06, 755.21, 14.04, { f: 'tahoma', c: WHITE, hs: 1.03 });
      if (s.who) put(pg[0], 'Составил: ' + s.who, 39.15, 755.21, 14.04, { f: 'tahoma', c: WHITE, maxW: 395 });

      /* ---------- стр. 3: предложение ---------- */
      M.add(3, 99, 147.1, 233.8, 183.6);                                     // ячейка «Наименование»
      const nm = fitLines(s.name, 'arial', 128, 35, [10, 9, 8.5, 8, 7.5, 7]);
      const y0 = 147.1 + (36.5 - nm.lines.length * nm.size * 1.12) / 2 + nm.size * .93;
      nm.lines.forEach((l, i) => put(pg[3], l, 102.4, y0 + i * nm.size * 1.12, nm.size, { f: 'arial' }));
      M.add(3, 263, 160.5, 275, 173);
      put(pg[3], String(s.qty), 268.9, 169.71, 10, { f: 'helv', a: 'c' });
      if (s.price) {
        put(pg[3], money(s.price), 361.7, 169.71, 10, { f: 'helv', a: 'c', maxW: 116 });
        put(pg[3], money(s.price * s.qty), 480.1, 169.71, 10, { f: 'helv', a: 'c', maxW: 109 });
        put(pg[3], money(s.price * s.qty), 480.1, 197.33, 9.48, { f: 'tahoma', a: 'c', c: NAVY, maxW: 109 });
        put(pg[3], money(s.price * s.qty), 292, 261.76, 12, { f: 'tahoma', a: 'c', c: NAVY, maxW: 74 });
      }

      /* ---------- стр. 4: габаритный эскиз ---------- */
      edit('p4_stamp', s.mark, { a: 'l', maxW: 250 });
      if (s.noDrawing) M.add(4, 88, 160, 516, 520);                          // эскиз шаблона только для шкафа 1000×1500×2300
      else put(pg[4], 'Масса — ' + s.massKg + ' кг', 307.5, 545, 12.22, { a: 'c' });

      /* ---------- стр. 5: однолинейная схема ---------- */
      edit('p5_stamp', s.mark, { a: 'l', maxW: 250 });

      /* ---------- стр. 6: основные характеристики ---------- */
      edit('p6_name', s.mark, { maxW: 290 });
      edit('p6_p', s.P + ' кВт');
      edit('p6_i', s.I + ' А');
      if (s.kv === 10) edit('p6_u', '10000В ±15%');
      if (s.motor === 'S') edit('p6_motor', 'Синхронный');
      if (s.ctl === 'AC110') edit('p6_ctlV', '110', { a: 'l' });
      else if (s.ctl === 'DC220' || s.ctl === 'DC110') edit('p6_ctl', 'DC ' + s.ctl.slice(2) + ' В ±15%');
      if (s.startsH !== 6) edit('p6_starts', '1-' + s.startsH + ' пуска в час с перерывом 10 мин.');

      // постоянные исправления шаблона — по данным завода (руководство RSE1000 V2025)
      edit('p6_tmin', '10', { a: 'l' });
      edit('p6_ol', 'Степени защиты от перегрузки: 10A, 10, 20, 30, OFF');
      edit('p6_ul', 'Уровень: 50–100%');
      edit('p6_ult', 'Время срабатывания: 0–10с');
      edit('p7_log', 'Хранение данных о последних 1000 ошибках');
      edit('p10_tmin', '10', { a: 'l' });

      /* ---------- стр. 7: связь ---------- */
      if (s.proto !== 'MR') {
        edit('p7_proto', 'Modbus RTU; ' + PROTO[s.proto]);
        if (IFACE[s.proto]) edit('p7_iface', 'RS-485; ' + IFACE[s.proto]);
      }

      /* ---------- стр. 8: условия эксплуатации, схема ---------- */
      if (s.ip !== 'IP41') edit('p8_ip', s.ip);
      if (!s.dims) M.add(8, 337.5, 222.2, 443.4, 234.5);                    // габариты по заказу — строка пустая
      else if (s.noDrawing) edit('p8_dims', s.dims.replace(/×/g, 'х') + ' (ШхГхВ)');
      if (s.srv === '1') edit('p8_srv', 'Одностороннее');
      if (s.cable === 'T') edit('p8_cab', 'Сверху');
      if (s.kv === 10) edit('p8_kv', '10 кВ', { a: 'l' });
      if (s.ctl.startsWith('DC')) { edit('p8_L', '+'); edit('p8_N', '-'); }
      // строка «Масса» под таблицей: линии как у таблицы (горизонтали 0,72 pt, вертикаль 1,2 pt)
      const p8 = pg[8], H8 = p8.getHeight(), yb = 343.3;
      p8.drawRectangle({ x: 34.0, y: H8 - yb - .36, width: 520.5, height: .72, color: LINE_H, borderWidth: 0 });
      p8.drawRectangle({ x: 237.14, y: H8 - yb, width: 1.2, height: yb - 313.3, color: LINE_V, borderWidth: 0 });
      put(p8, 'Масса', 128.6, 332.2, 10.99, { a: 'c' });
      put(p8, s.massKg + ' кг', 390.1, 332.2, 10.99, { a: 'c' });

      /* ---------- стр. 11: вид обслуживания ---------- */
      if (s.srv === '1') edit('p11_srv', 'с одной стороны.', { a: 'l', maxW: 82 });

      M.apply();
      if (s.noDrawing) alert('Напоминание: для ' + s.mark + ' габаритный эскиз в ТКП не вставляется — страница эскиза останется пустой' +
        (s.dims ? '' : ', строка «Габариты» тоже') + '. Приложите эскиз к ТКП отдельно.');
      const out = await doc.save();
      const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url;
      link.download = 'TKP_' + s.mark.replace(/ /g, '_') + '.pdf';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert('Не удалось сформировать ТКП: ' + e.message); }
    finally { if (btn) btn.style.opacity = 1; }
  }

  window.downloadTKP = generate;
})();
