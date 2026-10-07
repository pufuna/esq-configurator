/* Генератор ТКП для конфигуратора ESQ F ME800.
   Берёт assets/template.pdf (оформление ТКП, постоянный текст набран шрифтом Inter — как в техописании)
   и дописывает всё, что зависит от комплектации: обложку, предложение, описание с выбранными опциями,
   расшифровку обозначения, схему коммутации, схемы из техописания, габаритный чертёж, таблицы характеристик.

   Буквы рисуются контурами Inter из assets/glyphs.json (L — Light, R — Regular, S — SemiBold),
   поэтому вставки выглядят так же, как текст шаблона, и одинаково печатаются в любой программе.

   Координаты — pt от левого верхнего угла страницы «как её видит человек». */
(function () {
  'use strict';
  // Safari (iPad/iPhone, старые Mac) не умеет перебирать ReadableStream через for await — а pdf.js так читает страницы
  if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
    ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
      const reader = this.getReader();
      try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } }
      finally { reader.releaseLock(); }
    };
  }
  const { PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
    rectangle, clipEvenOdd, endPath } = window.PDFLib;
  const $ = id => document.getElementById(id);
  const WHITE = rgb(1, 1, 1), DARK = rgb(35 / 255, 31 / 255, 33 / 255), TEAL = rgb(10 / 255, 105 / 255, 114 / 255),
    ORANGE = rgb(242 / 255, 105 / 255, 40 / 255), FILL = rgb(.875, .925, .93);
  const KV = { T060: 6, T100: 10 }, CELLS = { 30: 5, 36: 6, 48: 8, 54: 9 };
  const money = x => { const [a, b] = x.toFixed(2).replace(/\.00$/, '').split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (b ? ',' + b : ''); };

  /* Ячейки значений в таблицах характеристик (стр. 13–15): [страница, x0, y0, x1, y1] — сняты при сборке шаблона */
  const CELL = {
    t_name: [13, 244.8, 128.7, 566.8, 153.8], t_u: [13, 244.8, 153.8, 566.8, 171.8], t_p: [13, 244.8, 171.8, 566.8, 189.7],
    t_i: [13, 244.8, 189.7, 566.8, 207.7], t_uout: [13, 244.8, 225.7, 566.8, 240.8], t_eff: [13, 244.8, 261.6, 566.8, 291.1],
    t_n: [13, 244.8, 291.1, 566.8, 319.9], t_mat: [13, 244.8, 694.9, 566.8, 712.9], t_cb: [13, 244.8, 712.9, 566.8, 741.4],
    t_ip: [14, 242.1, 145.7, 567.8, 168.2], t_life: [14, 242.1, 209.3, 567.8, 256.1], t_cap: [14, 242.1, 256.1, 567.8, 283.5],
    t_ups: [14, 242.1, 283.5, 567.8, 314.8], t_proto: [14, 242.1, 402.5, 567.8, 430.7], t_w: [14, 242.1, 544.8, 567.8, 576.8],
    t_cable: [14, 242.1, 576.8, 567.8, 608.9], t_reactor: [14, 242.1, 675.2, 567.8, 697.2], t_taps: [15, 232.0, 579.1, 555.0, 618.3]
  };
  /* Основная надпись: [страница, центр, базовая линия, макс. ширина] */
  const STAMP = { 6: [575.05, 506.0, 246], 7: [348.75, 712.1, 296], 8: [575.05, 505.0, 246], 9: [348.75, 713.0, 296], 10: [575.05, 505.0, 246] };

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
    s.mark = $('result').textContent;
    s.m = /^ESQ F ME800-(\d{4,5})P(\d{3})[AА](T\d{3})(AL|CU)(\d{2})([SX])([AMX])([RX])(\d{2})(2E|E|X)([UX])([DT])(MR|MT|PB|PN|CO|EI)([AS])([XB])-(P?[A-F])([BN])$/.exec(s.mark);
    s.r = !!($('tkpR') && $('tkpR').checked);   // галочка «R»: ячейка без P + примечание на чертеже
    s.g4 = s.film && (!window.isPFNCabinet || window.isPFNCabinet(s.v, s.P));   // компактный корпус G4
    s.g4x = s.g4 && !!(window.pfExtrasCode && window.pfExtrasCode());
    s.starterReq = !!(window.isStarterRequired && window.isStarterRequired(s.v, s.P));
    s.eff = s.film ? 97 : 96;
    s.life = s.film ? '200 000' : '100 000';
    s.sec = s.film ? 710 : 690;
    const m = window.getMechanicalFor(s.v, s.P);
    s.wT = parseFloat(m.weight);
    s.wFull = window.totalWeightT ? window.totalWeightT(m.weight) : s.wT;
    s.name = 'Преобразователь частоты ' + s.mark + ', ' + s.kv + ' кВ, ' + s.P + ' кВт, ' + s.I + ' А, IP' + s.ip + ', ' +
      (s.cu ? 'медный' : 'алюминиевый') + ' трансформатор, ' + s.n + ' ячеек на фазу, ' + (s.cb === 'B' ? 'с байпасом' : 'без байпаса') + ' силовой ячейки' +
      (s.starter ? ', пусковой шкаф' : '') + (s.reactor ? ', шкаф реактора' : '') +
      (s.byp !== 'X' ? ', ' + (s.byp === 'A' ? 'автоматический' : 'ручной') + ' шкаф байпаса' : '') +
      (s.ups ? ', ИБП' : '') + (s.exp !== 'X' ? ', ' + s.expT : '') + ', ' + s.proto + ', вводы ' + (s.cable === 'T' ? 'сверху' : 'снизу') +
      ', ' + (s.motor === 'S' ? 'синхронный' : 'асинхронный') + ' двигатель, ' + (s.sync === 'B' ? 'с синхронизацией' : 'без синхронизации') + '.';
    return s;
  }

  /* ---------- векторный текст ---------- */
  function makeFonts(GL) {
    const F = {};
    for (const key of Object.keys(GL)) {
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
    return F;
  }

  /* Маски: старое содержимое листа обёрнуто в отсечение «страница минус зоны» */
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
            const [a, b, c, d] = r === 90 ? [y0, x0, y1, x1] : [x0, H - y1, x1, H - y0];
            op += `0 0 ${n(W)} ${n(H)} re ${n(a)} ${n(b)} ${n(c - a)} ${n(d - b)} re W* n\n`;
          }
          doc.context.assign(sl.pre, doc.context.stream(op));
          doc.context.assign(sl.post, doc.context.stream('\nQ\n'));
        }
      }
    };
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
      const F = makeFonts(GL);
      window.__tkpF = F;
      const pg = doc.getPages();
      const M = prepareMasks(doc, pg);

      /* ---------- помощники ---------- */
      const rot = p => p.getRotation().angle;
      /* vx — якорь по горизонтали, vy — базовая линия; o.f — шрифт L | R | S; o.a — l | c | r; o.maxW — сжать по ширине; o.ang — поворот, град. против часовой */
      const put = (p, str, vx, vy, size, o = {}) => {
        str = String(str);
        const f = F[o.f || 'L'], w0 = f.width(str, size);
        let hs = 1; if (o.maxW && w0 > o.maxW) hs = o.maxW / w0;
        const w = w0 * hs, r = rot(p), H = p.getHeight(), th = ((o.ang || 0) + r) * Math.PI / 180;
        const cs = Math.cos(th), sn = Math.sin(th);
        const off = o.a === 'c' ? -w / 2 : o.a === 'r' ? -w : 0;
        let ux = r === 90 ? vy : vx, uy = r === 90 ? vx : H - vy;
        ux += off * cs; uy += off * sn;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(cs * hs, sn * hs, -sn, cs, ux, uy));
        p.drawSvgPath(f.path(str), { x: 0, y: 0, scale: size / f.upm, color: o.c || DARK, borderWidth: 0 });
        p.pushOperators(popGraphicsState());
        return w;
      };
      const W = (str, f, size) => F[f].width(String(str), size);
      const wrap = (str, f, size, maxW) => {
        const out = []; let cur = '';
        for (const w of String(str).split(' ')) { const t = cur ? cur + ' ' + w : w; if (W(t, f, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
        out.push(cur); return out;
      };
      /* абзац с выравниванием по ширине; top — верх строки; возвращает низ абзаца */
      const para = (p, x0, x1, top, str, o = {}) => {
        const f = o.f || 'L', size = o.size || 9.6, lead = o.lead || size * 1.375, ind = o.indent || 0, c = o.c || DARK;
        const words = String(str).split(' '), lines = []; let cur = [];
        for (const w of words) {
          const lim = x1 - x0 - (lines.length ? 0 : ind), t = cur.concat(w).join(' ');
          if (cur.length && W(t, f, size) > lim) { lines.push(cur); cur = [w]; } else cur.push(w);
        }
        lines.push(cur);
        let y = top + size * .95;
        lines.forEach((ln, k) => {
          const xs = x0 + (k ? 0 : ind), avail = x1 - xs;
          if (o.justify !== false && k < lines.length - 1 && ln.length > 1) {
            const ww = ln.reduce((a, w) => a + W(w, f, size), 0), gap = (avail - ww) / (ln.length - 1);
            let xx = xs; for (const w of ln) { if (!o.dry) put(p, w, xx, y, size, { f, c }); xx += W(w, f, size) + gap; }
          } else if (!o.dry) put(p, ln.join(' '), xs, y, size, { f, c });
          y += lead;
        });
        return y - lead + size * .3;
      };
      /* текст в ячейке: по центру, с переносом; кегль уменьшается, если не помещается */
      const cell = (name, str, o = {}) => {
        const [pi, x0, y0, x1, y1] = CELL[name], p = pg[pi], f = o.f || 'L', pad = 4;
        let size = o.size || 8.6, ls, ld, h;
        for (;;) { ld = size * 1.24; ls = wrap(str, f, size, x1 - x0 - 2 * pad); h = (ls.length - 1) * ld + size * .72; if (h <= y1 - y0 - 3 || size < 6) break; size -= .2; }
        let y = (y0 + y1) / 2 - h / 2 + size * .72;
        for (const l of ls) { put(p, l, (x0 + x1) / 2, y, size, { f, a: 'c' }); y += ld; }
      };
      const stamp = i => { const [cx, base, mw] = STAMP[i]; put(pg[i], s.mark, cx, base, 9, { f: 'R', a: 'c', maxW: mw }); };

      /* ---------- обложка: фото по типу корпуса, маркировка, автор, дата ---------- */
      if (!s.g4) {
        try {
          const jpg = await doc.embedPng(await get('assets/cover_g1g3.png').then(r => r.arrayBuffer()));   // фон фото прозрачный — рисунок обложки виден
          M.add(0, 20, 194.2, 279, 513.6);                                   // фото шкафа G4 из шаблона
          const H0 = pg[0].getHeight();
          pg[0].drawImage(jpg, { x: 44.3, y: H0 - 484.6, width: 331.9, height: 297.7 });
        } catch (e) { console.warn('Фото корпуса G1/G3 не найдено — на обложке остаётся фото шаблона', e); }
      }
      put(pg[0], s.mark.replace(/А/g, 'A'), 38.6, 727.5, 15.5, { f: 'R', c: WHITE, maxW: 518 });
      if (s.who) put(pg[0], s.who, 37.6 + W('Составил:', 'R', 12.5) + 7, 758.7, 12.5, { f: 'R', c: WHITE, maxW: 330 });
      put(pg[0], new Date().toLocaleDateString('ru-RU'), 443.5 + W('ДАТА:', 'R', 12.5) + 6, 758.7, 12.5, { f: 'R', c: WHITE });

      /* ---------- стр. 3: предложение ---------- */
      wrap(s.name, 'L', 9.6, 240).forEach((l, i) => put(pg[3], l, 102.4, 162.5 + i * 12.3, 9.6));
      put(pg[3], s.qty + ' шт', 375.85, 243, 10.2, { a: 'c' });
      if (s.price) put(pg[3], money(s.price), 470.9, 243, 10.2, { a: 'c' });
      put(pg[3], 'Всего позиций: 1, на сумму ' + (s.price ? money(s.price * s.qty) : '______________') + ' рублей, включая НДС 22 %', 58.6, 361.5, 10.6);

      /* ---------- стр. 4: описание + выбранные опции ---------- */
      drawDescription(pg[4], s, para, put, W);

      /* ---------- стр. 5: расшифровка обозначения ---------- */
      drawDecode(pg[5], s, put, W, wrap);

      /* ---------- стр. 6: схема коммутации (рисуется по комплектации) ---------- */
      drawSwitching(pg[6], s, put, W);

      /* ---------- условия эксплуатации: −5…+40 °С при работе, −20…+70 °С при хранении (как в РЭ) ---------- */
      M.add(13, 250, 433.7, 562, 444.5);                                 // стр. 13, таблица: строка с температурой
      put(pg[13], 'окружающего воздуха от −5 °С до +40 °С и относительной влажности не', 405.8, 442.2, 8.6, { a: 'c' });
      M.add(15, 236, 173.5, 551, 184.4);                                 // стр. 15, защиты: порог повышенного напряжения — 110 % (как в РЭ)
      put(pg[15], 'Защита срабатывает при уровне напряжения выше 110% от номинального', 237.3, 182.0, 8.6);
      M.add(17, 68.5, 660.6, 545, 686.6);                                // стр. 17, раздел 7: две строки с температурами
      put(pg[17], 'температура воздуха при хранении и транспортировке — от минус 20 °С до плюс 70 °С;', 70.1, 670.2, 9.6);
      put(pg[17], 'температура окружающего воздуха — от минус 5 °С до плюс 40 °С;', 70.1, 683.7, 9.6);
      for (const i of [6, 7, 8, 9, 10]) stamp(i);

      /* ---------- стр. 7–9, 12: схемы из техописания ---------- */
      const SCH = new URL(window.SCHEMES_BASE || 'assets/schemes/', document.baseURI).href;
      const schFiles = { 7: 'struct_' + s.n + '.pdf', 8: (s.film ? 'cell_pf' : 'cell_el') + '.pdf', 9: 'ext.pdf', 12: 'sine.pdf' };
      const ZONE = { 7: [82, 150, 522, 692], 8: [112, 103, 719, 487], 9: [82, 146.5, 522, 692], 12: [70, 234, 525, 416] };
      for (const [i, f] of Object.entries(schFiles)) {
        try { const r = await fetch(SCH + f); if (r.ok) await drawScheme(doc, pg[+i], await r.arrayBuffer(), ZONE[i]); }
        catch (e) { console.warn('Схема не найдена: ' + f, e); }
      }

      /* ---------- стр. 10: вес и чертёж ---------- */
      const kgOf = t => isNaN(t) ? '—' : String(Math.round(t * 1000));
      put(pg[10], kgOf(s.wT), 508.2, 472.5, 8.4, { f: 'R', a: 'c', c: TEAL });
      put(pg[10], kgOf(s.wFull), 557.0, 472.5, 8.4, { f: 'R', a: 'c', c: TEAL, maxW: 24 });
      if (s.film && !s.g4) alert('Напоминание: для плёночного ПЧ этой мощности габаритный чертёж в ТКП не вставляется — страница чертежа останется пустой. Приложите чертёж к ТКП отдельно.');
      else await drawDrawing(doc, pg[10]);
      if (s.r) put(pg[10], '*фактические габариты могут отличаться и будут уточнены после заказа', 128, 472.5, 8.4, { c: DARK, maxW: 330 });

      /* ---------- стр. 13–15: значения характеристик ---------- */
      cell('t_name', s.mark);
      cell('t_u', (s.kv === 10 ? '10000' : '6000') + ' В ±10%');
      cell('t_p', s.P + ' кВт');
      cell('t_i', s.I + ' А');
      cell('t_uout', '0–' + s.kv + ' кВ');
      cell('t_eff', 'не менее ' + s.eff + '%');
      cell('t_n', s.n + ' ячеек');
      cell('t_mat', 'Материал обмоток — ' + (s.cu ? 'медь' : 'алюминий'));
      cell('t_cb', s.cb === 'B' ? 'Присутствует' : 'Отсутствует');
      cell('t_ip', 'IP' + s.ip);
      cell('t_life', 'Стандартно ' + s.life + ' часов (температура, нагрузка и время непрерывного использования имеют большое влияние на срок службы конденсаторов)');
      cell('t_cap', s.film ? 'Пленочные' : 'Электролитические');
      cell('t_ups', s.ups ? 'Присутствует' : 'Отсутствует');
      cell('t_proto', s.proto);
      const tn = t => String(t).replace('.', ',');
      cell('t_w', isNaN(s.wT) ? '—' : (s.wFull > s.wT ? 'ПЧ — ' + tn(s.wT) + ' т; с дополнительными шкафами — ' + tn(s.wFull) + ' т' : tn(s.wT) + ' т'));
      cell('t_cable', s.cable === 'T' ? 'Сверху' : 'Снизу');
      cell('t_reactor', s.reactor ? 'Присутствует' : 'Отсутствует');
      cell('t_taps', 'На первичной обмотке есть встроенные отпайки для переключения на напряжение ' + (s.kv === 10 ? '9,5 и 10,5' : '5,7 и 6,3') + ' кВ при повышенном напряжении в питающей сети');

      M.apply();
      const out = await doc.save();
      const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url;
      link.download = 'TKP_' + s.mark.replace(/А/g, 'A').replace(/ /g, '_') + '.pdf';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert('Не удалось сформировать ТКП: ' + e.message); }
    finally { if (btn) btn.style.opacity = 1; }
  }

  /* ================= Стр. 4: описание преобразователя и выбранная дополнительная комплектация ================= */
  const DESC_PARAS = [
    'Высоковольтный преобразователь частоты ESQ F ME800 предназначен для управления асинхронными двигателями высокого напряжения.',
    'Устройство широко применяется в производстве стройматериалов, химической промышленности, металлургии, сталелитейной и бумажной промышленности и т.д.',
    'Может использоваться на разных нагрузках — включая насосы, вентиляторы, компрессоры, дробилки, мешалки, конвейерные ленты и т.д.',
    'В ESQ F ME800 реализована топология многократного выпрямления тока со сдвигом фаз на стороне источника питания, которая дает минимальные гармонические искажения питающей сети и высокий коэффициент мощности.'];
  const DESC_BULLETS = [
    'Понижение гармонических искажений до минимальных значений с помощью технологии многократного выпрямления тока со сдвигом фаз на стороне источника питания.',
    'Удержание высокого коэффициента мощности.',
    'Непрерывность работы при кратковременном пропадании питания (до 5 секунд — со снижением частоты, без останова).',
    'Контроль и ограничение значения пускового тока.',
    'Плавный запуск электродвигателя.',
    'Снижение расходов обслуживания из-за износа двигателя.',
    'Работу ЭД с установившейся частотой вращения при изменении момента нагрузки от нуля до номинального значения момента приводного ЭД.',
    'Плавный пуск, разгон и регулирование скорости асинхронного ЭД в диапазоне от 0 до 100% номинальной скорости вращения ЭД.',
    'Пропуск критических частот при частотном регулировании.',
    'Автоматический перезапуск при перебое электропитания.',
    'Местное и дистанционное управление.',
    'Исключение «самохода» и «ползучей» скорости в нулевом положении органов управления.',
    'Плавный заряд конденсаторов звена постоянного тока (в комплектации с пусковым шкафом).',
    'Запуск с отслеживанием скорости.',
    'Многоскоростной режим, ПЧ сохраняет значения нескольких частотных диапазонов, времени ускорения, замедления и может быстро переключаться между диапазонами.',
    'Управление ускорением и замедлением по кривой.',
    'Резервное копирование параметров.',
    'Работу с датчиком технологического процесса в замкнутом контуре (встроенный ПИД-регулятор).'];
  const DESC_TAIL = [
    'Преобразователь частоты ESQ F ME800 работает в режиме преобразования «переменный ток — постоянный ток — переменный ток» и состоит из ряда последовательно соединенных силовых ячеек, индивидуально запитанных от трансформатора, обеспечивающего фазовый сдвиг питания.',
    'Изменяя количество ячеек в каждой фазе, можно менять выходное напряжение преобразователя частоты, не ограничиваясь предельным напряжением силовых компонентов. Коммутационными элементами преобразователя являются IGBT-транзисторы. Схема преобразователя частоты имеет высокую надежность за счет использования последовательно подключенных силовых ячеек и метода сложения напряжений.'];

  function extrasList(s) {
    const L = [];
    if (s.starter) L.push(['Пусковой шкаф', ' — ограничивает бросок тока намагничивания трансформатора и заряда конденсаторов при подаче высокого напряжения: конденсаторы заряжаются через токоограничивающие резисторы, после чего вакуумный контактор шунтирует резисторы' + (s.starterReq ? ' (обязателен для ПЧ с номинальным током более 200 А)' : '') + '.']);
    if (s.byp === 'A') L.push(['Шкаф автоматического байпаса', ' — переключение двигателя на питание от сети при неисправности ПЧ или по технологическим требованиям; вакуумные контакторы KM1–KM3.']);
    if (s.byp === 'M') L.push(['Шкаф ручного байпаса', ' — переключение двигателя на питание от сети при неисправности ПЧ или по технологическим требованиям; разъединители QS1, QS2-1 и QS2-2; QS2-1 и QS2-2 связаны механической блокировкой, что исключает подачу сетевого напряжения на выход ПЧ.']);
    if (s.reactor) L.push(['Шкаф выходного реактора', ' — снижает скорость нарастания напряжения и емкостные токи кабельной линии, уменьшает нагрузку на изоляцию двигателя при большой длине кабеля.']);
    if (s.ups) L.push(['Источник бесперебойного питания (ИБП)', ' цепей управления — питание системы управления при пропадании внешнего питания, время работы до 2 ч.']);
    if (s.exp === 'E') L.push(['Плата расширения входов/выходов', ' — дополнительно 8 дискретных входов/выходов (+8 DI/DO).']);
    if (s.exp === '2E') L.push(['Две платы расширения входов/выходов', ' — дополнительно 16 дискретных входов/выходов (+16 DI/DO).']);
    if (s.cb === 'B') L.push(['Байпас силовых ячеек', ' — неисправная ячейка автоматически шунтируется без останова ПЧ, работа продолжается со сниженным выходным напряжением.']);
    if (s.sync === 'B') L.push(['Синхронизация с сетью', ' — синхронный перевод двигателя с ПЧ на сеть и обратно без броска тока.']);
    const more = [];                                                      // короткие пункты — одной строкой
    if (s.motor === 'S') more.push('управление синхронным двигателем');
    if (s.m && s.m[13] !== 'MR') more.push('протокол связи с АСУ ТП ' + s.proto);
    if (s.cu) more.push('медные обмотки трансформатора');
    if (s.cable === 'T') more.push('ввод и вывод силовых кабелей сверху');
    if (more.length === 1) L.push([more[0][0].toUpperCase() + more[0].slice(1), '.']);
    else if (more.length) L.push(['Также', ': ' + more.join('; ') + '.']);
    return L;
  }

  function drawDescription(p, s, para, put, W) {
    const X0 = 56, X1 = 548, TOP = 133, BOTTOM = 728, ex = extrasList(s);
    const layout = (size, dry) => {
      const lead = size * 1.37, o = { size, lead, dry }, gap = size * .45;
      let y = TOP;
      for (const t of DESC_PARAS) y = para(p, X0, X1, y, t, { ...o, indent: 22 }) + gap;
      y += gap;
      if (!dry) put(p, 'ВВ ПЧ типа ESQ F ME800 обеспечивает:', X0 + 22, y + size * .95, size, { f: 'S' });
      y += lead + 1;
      for (const b of DESC_BULLETS) { if (!dry) put(p, '•', X0 + 4, y + size * .95, size); y = para(p, X0 + 15, X1, y, b, { ...o, justify: false }) + size * .18; }
      y += gap * 1.5;
      for (const t of DESC_TAIL) y = para(p, X0, X1, y, t, { ...o, indent: 22 }) + gap;
      if (ex.length) {
        y += gap * 1.5;
        if (!dry) put(p, 'Дополнительная комплектация в данном предложении:', X0 + 22, y + size * .95, size, { f: 'S', c: TEAL });
        y += lead + 1;
        for (const [head, rest] of ex) {
          if (!dry) put(p, '•', X0 + 4, y + size * .95, size, { c: TEAL });
          // первое слово-заголовок полужирным: рисуем его отдельно, остальное — абзацем с отступом первой строки
          const hw = W(head, 'S', size);
          if (!dry) put(p, head, X0 + 15, y + size * .95, size, { f: 'S' });
          const glue = /^[ ]/.test(rest) ? W(' ', 'L', size) : 0, restTxt = rest.replace(/^ /, '');
          if (restTxt === '.') { if (!dry) put(p, '.', X0 + 15 + hw, y + size * .95, size); y += size * 1.25; }
          else y = para(p, X0 + 15, X1, y, restTxt, { ...o, indent: hw + glue, justify: false });
          y += size * .3;
        }
      }
      return y;
    };
    let size = 9.6;
    while (size > 7.2 && layout(size, true) > BOTTOM) size -= .1;
    layout(size, false);
  }

  /* ================= Стр. 5: расшифровка обозначения (как рис. 10 и таблица п. 5.1 техописания) ================= */
  function drawDecode(p, s, put, W, wrap) {
    const TEAL5 = rgb(3 / 255, 91 / 255, 110 / 255), OR5 = rgb(243 / 255, 95 / 255, 39 / 255), HEAD = rgb(212 / 255, 212 / 255, 212 / 255);
    const H = p.getHeight(), m = s.m, X0 = 58, X1 = 554;
    put(p, 'Расшифровка обозначения', X0, 122, 13, { f: 'S', c: ORANGE });
    const seg = [['ESQ F ME800', 1], ['–'], [String(m[1]) + 'P', 2], [m[2] + 'А', 3], [m[3], 4], [m[4], 5], [m[5], 6], [m[6], 7], [m[7], 8], [m[8], 9],
      [m[9], 10], [m[10], 11], [m[11], 12], [m[12], 13], [m[13], 14], [m[14], 15], [m[15], 16], ['–'], [m[16], 17], [m[17], 18]];
    const fw = (t, z) => W(t, 'S', z);
    const gap = .3, w1 = seg.reduce((a, [t]) => a + fw(t, 1), 0) + gap * (seg.length - 1);
    const z = Math.min(19, (X1 - X0 - 4) / w1), base = 168;
    let x = X0 + ((X1 - X0) - w1 * z) / 2, k = 0;
    for (const [t, n] of seg) {
      const w = fw(t, z);
      if (!n) { put(p, t, x, base, z, { f: 'S' }); x += w + gap * z; continue; }
      const c = k++ % 2 ? OR5 : TEAL5;
      put(p, t, x, base, z, { f: 'S', c });
      const uy = base + z * .2, cx = x + w / 2;
      p.drawRectangle({ x, y: H - uy - z * .12, width: w, height: z * .12, color: c, borderWidth: 0 });
      p.drawLine({ start: { x: cx, y: H - uy - z * .12 }, end: { x: cx, y: H - uy - z * .62 }, thickness: .6, color: DARK });
      put(p, String(n), cx, uy + z * 1.18, z * .48, { f: 'R', a: 'c' });
      x += w + gap * z;
    }
    put(p, 'Маркировка преобразователя', (X0 + X1) / 2, base + z * 2.35, 8.5, { a: 'c' });

    const kv = { T030: 3, T060: 6, T100: 10 }[m[3]] || '', cells = { 30: 5, 36: 6, 48: 8, 54: 9 }[m[5]] || '';
    const yes = (on, code, off) => on ? code + ' — включен в комплект' : off + ' — не включен';
    const rows = [
      ['Серия высоковольтных преобразователей частоты', 'ESQ F ME800'],
      ['Мощность ПЧ, кВт (с буквой P)', m[1] + 'P — ' + (+m[1]) + ' кВт'],
      ['Номинальный выходной ток ПЧ, А (с буквой А)', m[2] + 'А — ' + (+m[2]) + ' А'],
      ['Номинальное напряжение ПЧ', m[3] + ' — ' + kv + ' кВ'],
      ['Материал обмоток трансформатора', m[4] === 'CU' ? 'CU — медь' : 'AL — алюминий'],
      ['Пульсность схемы выпрямления', m[5] + ' — ' + m[5] + '-пульсная (' + kv + ' кВ, ' + cells + ' ячеек в фазе)'],
      ['Пусковой шкаф', yes(m[6] === 'S', 'S', 'X')],
      ['Шкаф байпаса', { A: 'A — автоматический', M: 'M — ручной', X: 'X — без шкафа байпаса' }[m[7]]],
      ['Шкаф реактора', yes(m[8] === 'R', 'R', 'X')],
      ['Степень защиты ПЧ, IP', m[9] + ' — IP' + m[9]],
      ['Плата расширения входов/выходов', { E: 'E — +8 DI/DO', '2E': '2E — +16 DI/DO', X: 'X — без плат расширения' }[m[10]]],
      ['Источник бесперебойного питания (ИБП)', yes(m[11] === 'U', 'U', 'X')],
      ['Ввод/вывод кабелей', m[12] === 'T' ? 'T — сверху' : 'D — снизу'],
      ['Протокол связи', { MR: 'MR — Modbus RTU', MT: 'MT — Modbus TCP', PB: 'PB — Profibus DP', PN: 'PN — Profinet', CO: 'CO — CANopen', EI: 'EI — EtherNet/IP' }[m[13]]],
      ['Тип двигателя', m[14] === 'S' ? 'S — синхронный' : 'A — асинхронный'],
      ['Синхронизация с сетью', m[15] === 'B' ? 'B — с синхронизацией' : 'X — без синхронизации'],
      ['Тип силовой ячейки', /^P?F$/.test(m[16]) ? (s.g4 ? m[16] + ' — сдвоенная силовая ячейка с пленочными конденсаторами звена постоянного тока (корпус G4)'
        : m[16] + ' — силовая ячейка с пленочными конденсаторами звена постоянного тока') : m[16] + ' — силовая ячейка с электролитическими конденсаторами звена постоянного тока'],
      ['Байпас силовых ячеек', yes(m[17] === 'B', 'B', 'N')]
    ];
    const C = [X0, X0 + 40, X0 + 236, X1], FS = 8.4, LH = 10.6, PAD = 3.6;
    let y = base + z * 3.3;
    const line = (x0, y0, x1, y1) => p.drawLine({ start: { x: x0, y: H - y0 }, end: { x: x1, y: H - y1 }, thickness: .6, color: DARK });
    const hh = 16;
    p.drawRectangle({ x: C[0], y: H - y - hh, width: C[3] - C[0], height: hh, color: HEAD, borderWidth: 0 });
    [['Поз.', 0], ['Параметр', 1], ['Обозначение', 2]].forEach(([t, i]) => put(p, t, (C[i] + C[i + 1]) / 2, y + hh / 2 + FS * .36, FS, { f: 'S', a: 'c' }));
    const top = y; line(C[0], y, C[3], y); y += hh; line(C[0], y, C[3], y);
    rows.forEach((r, i) => {
      const L1 = wrap(r[0], 'L', FS, C[2] - C[1] - 2 * PAD), L2 = wrap(r[1], 'L', FS, C[3] - C[2] - 2 * PAD), n = Math.max(L1.length, L2.length), h = n * LH + 2 * PAD - 1;
      put(p, String(i + 1), (C[0] + C[1]) / 2, y + h / 2 + FS * .36, FS, { f: 'S', a: 'c' });
      const ty = y + PAD + FS * .82 + (n - L1.length) * LH / 2, vy = y + PAD + FS * .82 + (n - L2.length) * LH / 2;
      L1.forEach((t, j) => put(p, t, C[1] + PAD, ty + j * LH, FS));
      L2.forEach((t, j) => put(p, t, C[2] + PAD, vy + j * LH, FS));
      y += h; line(C[0], y, C[3], y);
    });
    C.forEach(cx => line(cx, top, cx, y));
  }

  /* ================= Стр. 6: схема коммутации =================
     Слева — силовая цепь сверху вниз: сеть → QF → [шкаф байпаса: KM1 / QS1] → [пусковой шкаф: R ∥ KM4] → ПЧ →
     [шкаф реактора: L] → [KM2 / QS2-1] → двигатель; ветвь байпаса KM3 / QS2-2 — в обход ПЧ (у ручного байпаса QS2-1 и QS2-2 — с механической блокировкой).
     Справа — питание цепей управления (как в исходной схеме шаблона). Условные обозначения — в стиле рис. 7 техописания. */
  function drawSwitching(p, s, put, W) {
    const H = p.getHeight(), LW = .9;
    const Y = y => H - y;
    const ln = (x0, y0, x1, y1, o = {}) => p.drawLine({ start: { x: x0, y: Y(y0) }, end: { x: x1, y: Y(y1) }, thickness: o.w || LW, color: o.c || DARK, dashArray: o.dash });
    const poly = (pts, o) => { for (let i = 0; i + 1 < pts.length; i++) ln(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o); };
    const box = (x0, y0, x1, y1, o = {}) => p.drawRectangle({ x: x0, y: Y(y1), width: x1 - x0, height: y1 - y0, borderWidth: o.w ?? LW, borderColor: o.bc || DARK, color: o.fill, borderDashArray: o.dash });
    const dot = (x, y, r = 1.7) => p.drawCircle({ x, y: Y(y), size: r, color: DARK });
    const circ = (x, y, r, o = {}) => p.drawCircle({ x, y: Y(y), size: r, borderWidth: o.w ?? LW, borderColor: DARK, color: o.fill });
    const T = (str, x, y, o = {}) => put(p, str, x, y, o.size || 6.8, { f: o.f || 'R', a: o.a, c: o.c });
    const DASH = [3.2, 2.2];
    const svg = d => p.drawSvgPath(d, { x: 0, y: H, borderWidth: LW, borderColor: DARK });   // путь SVG в «экранных» координатах
    // разъём (два «шеврона» вниз)
    const plug = (x, y) => { for (const d of [0, 4]) { poly([[x - 3.2, y + d], [x, y + d + 3], [x + 3.2, y + d]]); } };
    // замыкающий контакт: y0 — верх, y1 — низ; kind: km (контактор) | qf (выключатель) | qs (разъединитель)
    const sw = (x, y0, y1, kind, label, la = 'r') => {
      const L = y1 - y0, a = L * .32;
      ln(x, y0, x, y0 + a);
      ln(x, y1 - a * .9, x, y1);
      ln(x, y1 - a * .9, x - L * .3, y0 + a + L * .03);            // нож
      if (kind === 'km') svg(`M ${x - 2.6} ${y0 + a} A 2.6 2.6 0 0 1 ${x + 2.6} ${y0 + a}`);
      if (kind === 'qf') { ln(x - 2.4, y0 + a - 2.4, x + 2.4, y0 + a + 2.4); ln(x - 2.4, y0 + a + 2.4, x + 2.4, y0 + a - 2.4); }
      if (kind === 'qs') ln(x - 2.8, y0 + a, x + 2.8, y0 + a);
      if (label) T(label, la === 'r' ? x + 6 : x - L * .3 - 3, y0 + L * .62, { a: la === 'r' ? 'l' : 'r', f: 'S', size: 6.6 });   // у пары с блокировкой подписи — снаружи
      return [x - L * .3 * .55, (y0 + a + y1 - a * .9) / 2];          // точка на ноже — для механической блокировки
    };
    const interlock = (p1, p2) => { ln(p1[0], p1[1], p2[0], p2[1], { dash: [2, 1.6], w: .7 }); const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2; poly([[mx - 3, my + 1.5], [mx + 3, my + 1.5], [mx, my + 5.5], [mx - 3, my + 1.5]], { w: .7 }); };
    const resistor = (x, y0, y1) => { box(x - 3.4, y0, x + 3.4, y1); };
    const inductor = (x, y0, y1) => {                                  // 4 полуокружности
      const n = 4, h = (y1 - y0) / n; let d = '';
      for (let i = 0; i < n; i++) { const ya = y0 + i * h, yb = ya + h; d += `M ${x} ${ya} A ${h / 2} ${h / 2} 0 0 1 ${x} ${yb} `; }
      svg(d);
    };
    const arrowDown = (x, y) => p.drawSvgPath(`M ${x - 3} ${y - 6} L ${x + 3} ${y - 6} L ${x} ${y} Z`, { x: 0, y: H, color: DARK });
    const cabinet = (x0, y0, x1, y1, name, inside) => {               // шкаф — штриховая рамка, название справа от неё (или внутри, внизу)
      box(x0, y0, x1, y1, { dash: DASH, w: .7 });
      if (inside) T(name, x0 + 4, y1 - 4, { size: 6.4, c: TEAL, f: 'S' });
      else String(name).split('\n').forEach((t, i) => T(t, x1 + 4, y0 + 8 + i * 7.6, { size: 6.4, c: TEAL, f: 'S' }));
    };

    /* ---------- силовая часть ---------- */
    const X = 250, XB = 178;                    // ось ПЧ и ось ветви байпаса
    const byp = s.byp !== 'X', man = s.byp === 'M';
    ln(X - 40, 120, X + 40, 120, { w: 2.6 });                                       // шины сети
    T('Питание ПЧ', X + 46, 117, { f: 'S' }); T(s.kv + ' кВ, 50 Гц, 3ф.', X + 46, 125.5);
    ln(X, 120, X, 126); plug(X, 126); ln(X, 133, X, 135);
    sw(X, 135, 157, 'qf', 'QF');
    plug(X, 157); ln(X, 164, X, 166);
    let y = 166;
    const yNode = 172;
    const bypName = man ? 'Шкаф ручного\nбайпаса' : 'Шкаф автоматического\nбайпаса';
    if (byp) {
      ln(X, y, X, yNode); dot(X, yNode);
      ln(X, yNode, XB, yNode);                                                    // ветвь байпаса к KM3 / QS2-2
      ln(X, yNode, X, yNode + 4);
      sw(X, yNode + 4, yNode + 26, man ? 'qs' : 'km', man ? 'QS1' : 'KM1');
      cabinet(XB - 40, y - 1, X + 56, yNode + 31, bypName);
      y = yNode + 26;
    }
    // пусковой шкаф: токоограничивающий резистор, параллельно — вакуумный контактор
    if (s.starter) {
      const yS0 = y + 11, yS1 = yS0 + 34;
      ln(X, y, X, yS0); dot(X, yS0); dot(X, yS1);
      ln(X, yS0, X - 14, yS0); ln(X - 14, yS0, X - 14, yS0 + 8); resistor(X - 14, yS0 + 8, yS1 - 8); ln(X - 14, yS1 - 8, X - 14, yS1); ln(X - 14, yS1, X, yS1);
      T('R', X - 20, yS0 + 19.5, { a: 'r', f: 'S', size: 6.6 });
      ln(X, yS0, X + 14, yS0); ln(X + 14, yS0, X + 14, yS0 + 3); sw(X + 14, yS0 + 3, yS1 - 3, 'km', 'KM4'); ln(X + 14, yS1 - 3, X + 14, yS1); ln(X + 14, yS1, X, yS1);
      cabinet(X - 36, yS0 - 5, X + 56, yS1 + 5, 'Пусковой шкаф');
      y = yS1;
    }

    // преобразователь частоты: трансформатор и силовые ячейки
    const yP0 = y + 12, yP1 = yP0 + 74, PX0 = X - 46, PX1 = X + 66;
    ln(X, y, X, yP0);
    box(PX0, yP0, PX1, yP1, { fill: FILL, w: .8 });
    T('R, S, T', X - 4, yP0 + 8, { a: 'r', size: 6 });
    T('ESQ F ME800', PX1 - 4, yP1 - 4, { f: 'S', size: 7, a: 'r' });
    circ(X, yP0 + 20, 7.5); circ(X - 5, yP0 + 31, 7.5); circ(X + 5, yP0 + 31, 7.5);   // фазосдвигающий трансформатор
    ln(X, yP0, X, yP0 + 12.5);
    T('Тр-р', X + 12, yP0 + 18, { size: 6 });
    ln(X, yP0 + 38.5, X, yP0 + 44); T(s.sec + ' В', X + 4, yP0 + 43, { size: 5.6 });
    box(X - 32, yP0 + 44, X + 32, yP0 + 62, { w: .8 });
    T('Силовые ячейки', X, yP0 + 51.5, { a: 'c', size: 5.6 });
    T('A1…C' + s.n + ' (' + s.n + ' в фазе)', X, yP0 + 58.5, { a: 'c', size: 5.6 });
    ln(X, yP0 + 62, X, yP1);
    ln(X + 12.5, yP0 + 31, PX1, yP0 + 31);                                        // вспомогательная обмотка 380 В — к шкафу управления
    T('380 В', PX1 - 4, yP0 + 28.5, { size: 5.8, a: 'r' });
    T('U, V, W', X - 4, yP1 - 4, { size: 6, a: 'r' });
    const yAux = yP0 + 31;
    y = yP1;

    // шкаф реактора
    if (s.reactor) {
      const yR0 = y + 12, yR1 = yR0 + 24;
      ln(X, y, X, yR0); inductor(X, yR0 + 2, yR1 - 2); ln(X, yR0, X, yR0 + 2); ln(X, yR1 - 2, X, yR1);
      T('L', X + 10, yR0 + 14, { f: 'S', size: 6.6 });
      cabinet(X - 36, yR0 - 4, X + 56, yR1 + 4, 'Шкаф реактора');
      y = yR1;
    }

    // выход байпаса: KM2 (за ПЧ) и KM3 (от сети); механическая блокировка — только у ручного (QS2-1 / QS2-2)
    let yJoin = y + 10;
    if (byp) {
      const yB0 = y + 11, yB1 = yB0 + 22; yJoin = yB1 + 7;
      ln(X, y, X, yB0);
      const a2 = sw(X, yB0, yB1, man ? 'qs' : 'km', man ? 'QS2-1' : 'KM2');
      ln(XB, yNode, XB, yB0);
      const a3 = sw(XB, yB0, yB1, man ? 'qs' : 'km', man ? 'QS2-2' : 'KM3', 'l');
      if (man) interlock(a3, a2);
      ln(X, yB1, X, yJoin); ln(XB, yB1, XB, yJoin); ln(XB, yJoin, X, yJoin); dot(X, yJoin);
      cabinet(XB - 40, yB0 - 5, X + 56, yJoin + 5, bypName);          // те же контакты шкафа байпаса — на выходе ПЧ
    } else ln(X, y, X, yJoin);

    // двигатель
    const yM = yJoin + 22;
    ln(X, yJoin, X, yM - 11);
    circ(X, yM, 11);
    T('M', X, yM + 1, { a: 'c', f: 'S', size: 8.5 }); T('~', X, yM + 7.5, { a: 'c', size: 6.5 });
    T('Подключаемый электродвигатель', X + 16, yM - 1.5, { f: 'S' });
    T(s.kv + ' кВ, до ' + s.P + ' кВт', X + 16, yM + 7);

    /* ---------- питание цепей управления ---------- */
    const C1 = 640, C2 = 560, CB = 600, top = 120;
    cabinet(470, 140, 708, 440, 'Шкаф управления', true);
    T('Внешнее питание цепей управления', C1 - 5, top, { f: 'S', a: 'r' }); T('380 В, 3Ф, 50 Гц, 4×2,5 мм²', C1 - 5, top + 8.5, { a: 'r' });
    ln(C1, top - 4, C1, 166); circ(C1, 160, 3.2); ln(C1 - 4, 164, C1 + 4, 156);
    T('TBPIN: 1, 2, 3, 4', C1 - 6, 162.5, { a: 'r', size: 6 });
    ln(C1, 163.2, C1, 172);
    sw(C1, 172, 196, 'qf', 'MCB1'); const k11 = sw(C1, 204, 228, 'km', 'KM11'); ln(C1, 196, C1, 204);
    // от вспомогательной обмотки трансформатора ПЧ
    ln(PX1, yAux, 500, yAux); ln(500, yAux, 500, 158); ln(500, 158, C2, 158); arrowDown(C2, 172); ln(C2, 158, C2, 166);
    T('от ПЧ, 380 В', 506, 155, { size: 6 });
    sw(C2, 172, 196, 'qf', 'MCB2'); const k12 = sw(C2, 204, 228, 'km', 'KM12', 'l'); ln(C2, 196, C2, 204);
    interlock(k12, k11);
    ln(C1, 228, C1, 240); ln(C2, 228, C2, 240); ln(C2, 240, C1, 240); dot(CB, 240);
    ln(CB, 240, CB, 254); arrowDown(CB, 260);
    ln(520, 262, 680, 262, { w: 1.4 });                                     // шина 380 В
    // вентиляторы
    const F1 = 530;
    ln(F1, 262, F1, 272); sw(F1, 272, 296, 'qf', 'MCB3'); sw(F1, 304, 328, 'km', 'KM5, KM6'); ln(F1, 296, F1, 304);
    ln(F1, 328, F1, 338); box(F1 - 7, 338, F1 + 7, 346); T('FR1, FR2', F1 + 10, 344.5, { f: 'S', size: 6.6 }); ln(F1, 346, F1, 362);
    circ(F1, 374, 11); T('M', F1, 376.5, { a: 'c', f: 'S', size: 8.5 });
    T('Вентиляторы', F1 + 15, 372, { f: 'S' }); T('380 В AC', F1 + 15, 380.5);
    // цепи управления 220 В
    const F2 = 640;
    ln(F2, 262, F2, 278); circ(F2, 284, 5.5); circ(F2, 293, 5.5);
    T('T1', F2 - 9, 290, { a: 'r', f: 'S', size: 6.6 }); T('220 В цепи', F2 + 9, 286); T('управления', F2 + 9, 294);
    ln(F2, 298.5, F2, 310); box(F2 - 15, 310, F2 + 15, 324); T('AC/DC', F2, 319.5, { a: 'c', size: 6.4 });
    let yc = 324;
    if (s.ups) { ln(F2, yc, F2, yc + 10); box(F2 - 15, yc + 10, F2 + 15, yc + 24, { fill: FILL }); T('ИБП', F2, yc + 19.5, { a: 'c', f: 'S', size: 6.6 }); yc += 24; }
    ln(F2, yc, F2, yc + 10); box(F2 - 31, yc + 10, F2 + 31, yc + 30); T('Цепи управления', F2, yc + 22.5, { a: 'c', size: 6.4 });
  }

  /* Векторная схема из assets/schemes/ — вписывается в поле рисунка по центру */
  async function drawScheme(doc, page, bytes, [x0, y0, x1, y1]) {
    const sp = (await PDFDocument.load(bytes)).getPage(0), em = await doc.embedPage(sp);
    const pad = 8, aw = x1 - x0 - 2 * pad, ah = y1 - y0 - 2 * pad, w = sp.getWidth(), h = sp.getHeight();
    const k = Math.min(aw / w, ah / h, 1.7), dw = w * k, dh = h * k;
    const vx = x0 + pad + (aw - dw) / 2, vy = y0 + pad + (ah - dh) / 2;
    if (page.getRotation().angle % 360 === 90) page.drawPage(em, { x: vy + dh, y: vx, width: dw, height: dh, rotate: degrees(90) });
    else page.drawPage(em, { x: vx, y: page.getHeight() - vy - dh, width: dw, height: dh });
  }

  /* ================= Габаритный чертёж (стр. 10) ================= */
  const PDFJS_BASE = new URL(window.PDFJS_BASE || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/', document.baseURI).href;
  let pdfjsP = null;
  const loadPdfjs = () => pdfjsP || (pdfjsP = import(PDFJS_BASE + 'pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs'; return m;
  }));

  function findLayout(img, W, H) {
    const d = img.data, dark = new Uint8Array(W * H);
    for (let i = 0, j = 0; j < W * H; i += 4, j++) dark[j] = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11 < 170 ? 1 : 0;
    const D = (x, y) => dark[y * W + x];
    const run = (get, n) => {
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
    const L = Math.max(...lc.map(c => c.x)), R = Math.min(...rc.map(c => c.x));
    const span = r => r.s <= L + .03 * W && r.e >= R - .03 * W;
    const tr = rows.filter(r => r.y < .2 * H && span(r)), br = rows.filter(r => r.y > .8 * H && span(r));
    if (!tr.length || !br.length) return null;
    const T = Math.max(...tr.map(r => r.y)), B = Math.min(...br.map(r => r.y));
    const fw = R - L, fh = B - T;
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
    const A = [116, 105, 714, 411], aw = A[2] - A[0], ah = A[3] - A[1], H = page.getHeight();
    const fit = (w, h) => { const k = Math.min(aw / w, ah / h); return { k, dw: w * k, dh: h * k, X: A[0] + (aw - w * k) / 2, Y: A[1] + (ah - h * k) / 2 }; };

    if (/\.(png|jpe?g)$/i.test(url)) {
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

    let bbox, vw, vh;
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
    const f = fit(vw, vh), X = f.X, Y = H - f.Y - f.dh;
    const cw = rot % 180 ? f.dh : f.dw, ch = rot % 180 ? f.dw : f.dh;
    const o = { 0: [X, Y], 90: [X, Y + f.dh], 180: [X + f.dw, Y + f.dh], 270: [X + f.dw, Y] }[rot] || [X, Y];
    page.pushOperators(pushGraphicsState());
    if (lay && lay.tb) {
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
