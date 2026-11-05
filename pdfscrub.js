/* Очистка готового ТКП от скрытого содержимого (window.PdfScrub.scrub(doc) — перед doc.save()).

   Генераторы ТКП собирают листы из шаблонов и чертежей: старые надписи шаблона закрываются масками (отсечением),
   из чертежа берётся только вид, штамп и поля обрезаются. На листе этого не видно, но в файле оно остаётся
   (выделяется, копируется, извлекается программами). Здесь содержимое каждого листа разбирается,
   и всё, что гарантированно невидимо, удаляется:
     • за пределами листа (CropBox);
     • вне области отсечения (обрезка вида чертежа, BBox встроенного листа);
     • внутри «дыр» масок «лист минус зоны» (старые надписи шаблона);
     • под непрозрачными заливками, нарисованными позже («заплатки» поверх старых ячеек);
     • аннотации-ссылки без адреса, служебный слой Acrobat, неиспользуемые объекты.
   Видимое не трогается: если про элемент нельзя точно сказать, что он не виден, он остаётся.
   Удалённый текст заменяется сдвигом без букв ([-n] TJ) — положение следующих надписей не меняется. */
(function () {
  'use strict';
  const EPS = 0.5;                                                    // допуск, pt

  /* ---------- байты ⇄ строка (по байту на символ) ---------- */
  const b2s = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const s2b = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

  /* ---------- разбор потока содержимого ---------- */
  const WS = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const DELIM = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

  function tokenize(s) {
    const ops = []; let args = [], argStart = -1, i = 0; const n = s.length;
    const stack = [];                                                 // вложенные [ ] и << >>
    const push = v => { if (stack.length) stack[stack.length - 1].push(v); else args.push(v); };
    while (i < n) {
      const c = s.charCodeAt(i);
      if (WS(c)) { i++; continue; }
      if (c === 37) { while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++; continue; }   // % комментарий
      if (argStart < 0) argStart = i;
      if (c === 40) {                                                 // (строка)
        let depth = 1, j = i + 1, out = '';
        while (j < n && depth) {
          const ch = s[j];
          if (ch === '\\') {
            const nx = s[j + 1];
            const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
            if (nx in map) { out += map[nx]; j += 2; }
            else if (nx >= '0' && nx <= '7') { let k = j + 1, o = ''; while (k < j + 4 && s[k] >= '0' && s[k] <= '7') o += s[k++]; out += String.fromCharCode(parseInt(o, 8) & 255); j = k; }
            else if (nx === '\n') j += 2; else if (nx === '\r') j += s[j + 2] === '\n' ? 3 : 2; else { j += 1; }
            continue;
          }
          if (ch === '(') depth++; else if (ch === ')') { depth--; if (!depth) break; }
          out += ch; j++;
        }
        push({ str: out }); i = j + 1; continue;
      }
      if (c === 60 && s.charCodeAt(i + 1) === 60) { stack.push([]); stack[stack.length - 1].dict = true; i += 2; continue; }
      if (c === 62 && s.charCodeAt(i + 1) === 62) { const v = stack.pop(); push({ dict: v || [] }); i += 2; continue; }
      if (c === 60) { const j = s.indexOf('>', i); let h = s.slice(i + 1, j).replace(/[^0-9A-Fa-f]/g, ''); if (h.length % 2) h += '0'; let out = ''; for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.substr(k, 2), 16)); push({ str: out }); i = j + 1; continue; }
      if (c === 91) { stack.push([]); i++; continue; }
      if (c === 93) { const v = stack.pop(); push(v || []); i++; continue; }
      if (c === 47) { let j = i + 1; while (j < n && !WS(s.charCodeAt(j)) && !DELIM(s.charCodeAt(j))) j++; push({ name: s.slice(i + 1, j) }); i = j; continue; }
      let j = i; while (j < n && !WS(s.charCodeAt(j)) && !DELIM(s.charCodeAt(j))) j++;
      if (j === i) { i++; continue; }                                 // одиночный разделитель — пропуск
      const t = s.slice(i, j);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) { push(+t); i = j; continue; }
      if (t === 'true' || t === 'false' || t === 'null') { push(t); i = j; continue; }
      if (stack.length) { push(t); i = j; continue; }                 // слово внутри массива/словаря
      if (t === 'BI') {                                               // встроенная картинка: до «EI» после данных
        const id = s.indexOf('ID', j); let k = id + 3, e = -1;
        while (k < n) { e = s.indexOf('EI', k); if (e < 0) break; if (WS(s.charCodeAt(e - 1)) && (e + 2 >= n || WS(s.charCodeAt(e + 2)) || DELIM(s.charCodeAt(e + 2)))) break; k = e + 2; }
        const end = e < 0 ? n : e + 2;
        ops.push({ op: 'BI', args: [], start: argStart, end }); args = []; argStart = -1; i = end; continue;
      }
      ops.push({ op: t, args, start: argStart, end: j }); args = []; argStart = -1; i = j;
    }
    return ops;
  }

  /* ---------- геометрия ---------- */
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const tp = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function bboxOf(m, x0, y0, x1, y1) {
    const p = [tp(m, x0, y0), tp(m, x1, y0), tp(m, x0, y1), tp(m, x1, y1)];
    return [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1])), Math.max(...p.map(q => q[0])), Math.max(...p.map(q => q[1]))];
  }
  // осторожно: «внутри» — с запасом внутрь, «пересекается» — с запасом наружу (касание края = виден)
  const inside = (b, r) => b[0] >= r[0] - 0.05 && b[1] >= r[1] - 0.05 && b[2] <= r[2] + 0.05 && b[3] <= r[3] + 0.05;
  const overlap = (b, r) => b[0] <= r[2] + EPS && b[2] >= r[0] - EPS && b[1] <= r[3] + EPS && b[3] >= r[1] - EPS;
  const area = r => (r[2] - r[0]) * (r[3] - r[1]);

  /* Видим ли элемент с рамкой b при отсечениях clips. Отсечение:
     { keep: [рамки] } — видно только внутри объединения рамок (обычный клип, путь — по его рамке);
     { eo: [рамки] } — чётно-нечётный клип из прямоугольников («лист минус зоны» — маски шаблона, дыры в чертежах). */
  function hidden(b, clips) {
    if (!b || !isFinite(b[0])) return false;
    for (const c of clips) {
      if (c.keep) { if (!c.keep.some(r => overlap(b, r))) return true; continue; }
      // видно там, где элемент накрыт нечётным числом прямоугольников; скрыт — если целиком в «чётной» области и не задевает границ
      const test = x => { const full = c.eo.filter(r => inside(x, r)).length, part = c.eo.filter(r => overlap(x, r) && !inside(x, r)).length; return !part && full % 2 === 0; };
      if (test(b) || (b.core && test(b.core))) return true;             // текст: строка целиком или основная часть букв
    }
    return false;
  }

  /* Виден ли элемент с рамкой b целиком при отсечениях clips (строго: только если это точно так) */
  function shown(b, clips) {
    for (const c of clips) {
      if (c.keep) { if (c.approx || !c.keep.some(r => inside(b, r))) return false; continue; }
      const full = c.eo.filter(r => inside(b, r)).length, part = c.eo.filter(r => overlap(b, r) && !inside(b, r)).length;
      if (part || full % 2 === 0) return false;
    }
    return true;
  }

  /* ---------- шрифты: ширины глифов ---------- */
  function fontInfo(ctx, PL, ref) {
    const f = ctx.lookup(ref); if (!f) return null;
    const get = (d, k) => { const v = d.get(PL.PDFName.of(k)); return v instanceof PL.PDFRef ? ctx.lookup(v) : v; };
    const num = v => v && v.asNumber ? v.asNumber() : (typeof v === 'number' ? v : 0);
    const sub = get(f, 'Subtype'); const st = sub ? sub.toString() : '';    // '/Type0', '/TrueType', …
    if (st === '/Type0') {
      const df = get(f, 'DescendantFonts'), d = df && ctx.lookup(df.get(0)); if (!d) return null;
      const dw = num(get(d, 'DW')) || 1000, W = new Map(), w = get(d, 'W');
      if (w) for (let i = 0; i < w.size();) {
        const a = num(ctx.lookup(w.get(i))), b = ctx.lookup(w.get(i + 1));
        if (b instanceof PL.PDFArray) { for (let k = 0; k < b.size(); k++) W.set(a + k, num(ctx.lookup(b.get(k)))); i += 2; }
        else { const last = num(b), v = num(ctx.lookup(w.get(i + 2))); for (let k = a; k <= last && k - a < 70000; k++) W.set(k, v); i += 3; }
      }
      return { two: true, w: c => W.has(c) ? W.get(c) : dw, k: 0.001 };
    }
    const first = num(get(f, 'FirstChar')), ws = get(f, 'Widths'), fd = get(f, 'FontDescriptor'), miss = fd ? num(get(fd, 'MissingWidth')) : 0;
    const arr = []; if (ws) for (let i = 0; i < ws.size(); i++) arr.push(num(ctx.lookup(ws.get(i))));
    let k = 0.001; if (st === '/Type3') { const fm = get(f, 'FontMatrix'); k = fm ? num(ctx.lookup(fm.get(0))) : 0.001; }
    return { two: false, w: c => (c >= first && c - first < arr.length ? arr[c - first] : miss), k, t3: st === '/Type3' };
  }

  /* ---------- проход по содержимому ---------- */
  function Scrubber(PL, doc) {
    const ctx = doc.context, N = k => PL.PDFName.of(k);
    const look = v => (v instanceof PL.PDFRef ? ctx.lookup(v) : v);
    const fontCache = new Map(), formUse = new Map();               // форма → { ops, dead: Set|null, stream }
    let removed = 0;

    const readStream = st => {
      if (st instanceof PL.PDFRawStream) return b2s(PL.decodePDFRawStream(st).decode());
      if (st.getUnencodedContents) return b2s(st.getUnencodedContents());   // поток, созданный pdf-lib
      return null;
    };
    const resOf = (dict, fallback) => look(dict && dict.get(N('Resources'))) || fallback;
    const sub = (d, k) => { const r = d && look(d.get(N(k))); return r; };

    /* Анализ потока: возвращает Set индексов операторов, которые можно убрать, и замены для текста */
    function analyse(src, res, ctm0, clips0, onForm) {
      const ops = tokenize(src), dead = new Set(), repl = new Map();
      let g = { ctm: ctm0, clips: clips0, Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, fs: 0, rise: 0, lw: 1, opaque: true, pattern: false };
      // решения — в конце потока: элемент может закрыть непрозрачная заливка, нарисованная позже
      const pend = [], covers = [];
      const gstates = sub(res, 'ExtGState');
      const st = []; let Tm = null, Tlm = null, path = [], pathStart = -1, rects = [], curve = false, clipOp = null, nm = 0, bez = false;
      const fonts = sub(res, 'Font'), xobj = sub(res, 'XObject');
      const fontOf = name => {
        const ref = fonts && fonts.get(N(name)); if (!ref) return null;
        const key = ref instanceof PL.PDFRef ? ref.toString() : ref;
        if (!fontCache.has(key)) { let fi = null; try { fi = fontInfo(ctx, PL, ref); } catch (e) {} fontCache.set(key, fi); }
        return fontCache.get(key);
      };
      const addPt = (x, y) => { path.push(tp(g.ctm, x, y)); };
      const pathBox = () => { if (!path.length) return null; let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of path) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } const s = Math.hypot(g.ctm[0], g.ctm[1]) * g.lw / 2 + 0.5; return [a - s, b - s, c + s, d + s]; };
      const endPath = () => { path = []; rects = []; curve = false; pathStart = -1; clipOp = null; nm = 0; bez = false; };
      // прямоугольник, нарисованный ломаной (m l l l h — так рисует pdf-lib): рамка, если стороны по осям
      const polyRect = () => {
        if (nm !== 1 || bez || rects.length) return null;
        let pts = path.slice(); if (pts.length === 5 && Math.hypot(pts[4][0] - pts[0][0], pts[4][1] - pts[0][1]) < 0.01) pts.pop();
        if (pts.length !== 4) return null;
        const xs = [...new Set(pts.map(p_ => +p_[0].toFixed(2)))], ys = [...new Set(pts.map(p_ => +p_[1].toFixed(2)))];
        if (xs.length !== 2 || ys.length !== 2) return null;
        for (let k = 0; k < 4; k++) { const a = pts[k], b = pts[(k + 1) % 4]; if (Math.abs(a[0] - b[0]) > 0.01 && Math.abs(a[1] - b[1]) > 0.01) return null; }
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      };

      /* Текст: побуквенно. Скрытые буквы потом заменяются сдвигом в TJ, видимые остаются —
         положение следующих надписей не меняется. Возвращает описание для build() или null (не трогать). */
      const show = (items, pre) => {
        const fi = g.font; if (!fi || fi.t3 || !g.fs || !g.Th) return null;
        const step = fi.two ? 2 : 1, m = mul(mul([1, 0, 0, 1, 0, g.rise], Tm), g.ctm);
        let x = 0, unknown = false; const parts = [];
        for (const it of items) {
          if (typeof it === 'number') { x += -it / 1000 * g.fs * g.Th; parts.push(it); continue; }
          const t = it.str || '';
          for (let k = 0; k + step - 1 < t.length; k += step) {
            const bytes = t.substr(k, step), code = step === 2 ? (t.charCodeAt(k) << 8) | t.charCodeAt(k + 1) : t.charCodeAt(k);
            const gw = fi.w(code) * fi.k * g.fs * g.Th, adv = gw + (g.Tc + (!fi.two && code === 32 ? g.Tw : 0)) * g.Th;
            let box = null, clipHide = false;
            if (gw > 0) {
              box = bboxOf(m, x, -0.24 * g.fs, x + gw, 0.82 * g.fs);          // от низа «у» до верха «Й»
              box.core = bboxOf(m, x, -0.02 * g.fs, x + gw, 0.76 * g.fs);     // строчные без выносных, прописные, цифры
              clipHide = hidden(box, g.clips);
            } else if (code !== 32) unknown = true;
            parts.push({ bytes, adv, box, clipHide });
            x += adv;
          }
        }
        Tm = mul([1, 0, 0, 1, x, 0], Tm);
        if (unknown || !parts.some(p_ => typeof p_ !== 'number')) return null;
        return { parts, pre, kf: 1000 / (g.fs * g.Th) };
      };
      const buildText = (t, hideOf) => {
        const out = []; let run = '', anyHidden = false;
        for (const p_ of t.parts) {
          if (typeof p_ === 'number') { if (run) { out.push({ str: run }); run = ''; } out.push(p_); continue; }
          if (p_.box && hideOf(p_)) { anyHidden = true; if (run) { out.push({ str: run }); run = ''; } out.push(-p_.adv * t.kf); }
          else run += p_.bytes;
        }
        if (run) out.push({ str: run });
        if (!anyHidden) return null;
        const merged = []; for (const v of out) { if (typeof v === 'number' && typeof merged[merged.length - 1] === 'number') merged[merged.length - 1] += v; else merged.push(v); }
        const hex = s_ => '<' + Array.from(s_, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>';
        const body = merged.filter(v => typeof v !== 'number' || Math.abs(v) > 1e-6).map(v => typeof v === 'number' ? (+v.toFixed(3)).toString() : hex(v.str)).join(' ');
        return t.pre + '[' + body + '] TJ';
      };

      for (let i = 0; i < ops.length; i++) {
        const { op, args } = ops[i], A = args;
        switch (op) {
          case 'q': st.push(Object.assign({}, g)); break;
          case 'gs': {
            const d = gstates && A[0] && A[0].name ? look(gstates.get(N(A[0].name))) : null;
            if (d && d.get) {
              const ca = look(d.get(N('ca'))), sm = d.get(N('SMask')), bm = d.get(N('BM'));
              if (ca && ca.asNumber && ca.asNumber() < 1) g.opaque = false; else if (ca) g.opaque = true;
              if (sm && sm.toString() !== '/None') g.opaque = false;
              if (bm && !['/Normal', '/Compatible'].includes(bm.toString())) g.opaque = false;
            }
            break;
          }
          case 'cs': g.pattern = !!(A[0] && A[0].name === 'Pattern'); break;
          case 'scn': if (A.length && A[A.length - 1] && A[A.length - 1].name) g.pattern = true; break;
          case 'rg': case 'g': case 'k': g.pattern = false; break;
          case 'Q': if (st.length) g = st.pop(); break;
          case 'cm': if (A.length === 6) g.ctm = mul(A, g.ctm); break;
          case 'w': g.lw = +A[0] || 0; break;
          // ---- путь ----
          case 'm': case 'l': if (pathStart < 0) pathStart = i; addPt(A[0], A[1]); if (op === 'l') curve = true; else nm++; break;
          case 'c': if (pathStart < 0) pathStart = i; addPt(A[0], A[1]); addPt(A[2], A[3]); addPt(A[4], A[5]); curve = bez = true; break;
          case 'v': case 'y': if (pathStart < 0) pathStart = i; addPt(A[0], A[1]); addPt(A[2], A[3]); curve = bez = true; break;
          case 're': {
            if (pathStart < 0) pathStart = i;
            const [x, y, w, h] = A; addPt(x, y); addPt(x + w, y + h); addPt(x, y + h); addPt(x + w, y);
            rects.push(bboxOf(g.ctm, Math.min(x, x + w), Math.min(y, y + h), Math.max(x, x + w), Math.max(y, y + h)));
            break;
          }
          case 'h': break;
          case 'W': case 'W*': clipOp = op; break;
          case 'n': case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': {
            if (clipOp) {
              let c;
              if (!curve && rects.length > 1 && clipOp === 'W*') {
                c = { eo: rects.slice() };                                // чёт-нечет из прямоугольников (маски «лист минус зоны»)
              } else if (!curve && rects.length) c = { keep: rects.slice() };
              else { const b = pathBox(); c = b ? { keep: [b], approx: true } : null; }   // кривая — по рамке (видимая часть не больше)
              if (c) g.clips = g.clips.concat([c]);
            } else if (op !== 'n' && pathStart >= 0) {
              const box = pathBox(), at = ++SEQ.n;
              pend.push({ seq: at, box, clip: hidden(box, g.clips), ops: [pathStart, i] });
              // непрозрачный прямоугольник с заливкой — закрывает то, что нарисовано под ним
              const axis = (Math.abs(g.ctm[1]) < 1e-6 && Math.abs(g.ctm[2]) < 1e-6) || (Math.abs(g.ctm[0]) < 1e-6 && Math.abs(g.ctm[3]) < 1e-6);   // без поворота на произвольный угол
              const rr = !curve && rects.length === 1 ? rects[0] : polyRect();
              if (axis && rr && !['S', 's'].includes(op) && g.opaque && !g.pattern && rr[2] - rr[0] > 1 && rr[3] - rr[1] > 1) covers.push({ seq: at, r: rr, clips: g.clips });
            }
            endPath(); break;
          }
          // ---- текст ----
          case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm; break;
          case 'ET': Tm = Tlm = null; break;
          case 'Tc': g.Tc = +A[0] || 0; break;
          case 'Tw': g.Tw = +A[0] || 0; break;
          case 'Tz': g.Th = (+A[0] || 0) / 100; break;
          case 'TL': g.TL = +A[0] || 0; break;
          case 'Ts': g.rise = +A[0] || 0; break;
          case 'Tf': g.font = A[0] && A[0].name ? fontOf(A[0].name) : null; g.fs = +A[1] || 0; break;
          case 'Tm': if (A.length === 6) { Tm = A.slice(); Tlm = Tm; } break;
          case 'Td': if (Tlm) { Tlm = mul([1, 0, 0, 1, A[0], A[1]], Tlm); Tm = Tlm; } break;
          case 'TD': if (Tlm) { g.TL = -A[1]; Tlm = mul([1, 0, 0, 1, A[0], A[1]], Tlm); Tm = Tlm; } break;
          case 'T*': if (Tlm) { Tlm = mul([1, 0, 0, 1, 0, -g.TL], Tlm); Tm = Tlm; } break;
          case "'": case '"': case 'Tj': case 'TJ': {
            if (!Tm) break;
            let pre = '';
            if (op === '"') { g.Tw = +A[0] || 0; g.Tc = +A[1] || 0; pre = A[0] + ' Tw ' + A[1] + ' Tc '; }
            if (op === "'" || op === '"') { Tlm = mul([1, 0, 0, 1, 0, -g.TL], Tlm); Tm = Tlm; pre += 'T* '; }
            const arg = A[A.length - 1];
            const items = op === 'TJ' ? (Array.isArray(arg) ? arg : []) : [{ str: arg && arg.str != null ? arg.str : '' }];
            const t = show(items, pre);
            if (t) pend.push({ seq: ++SEQ.n, text: t, i });
            break;
          }
          // ---- картинки и формы ----
          case 'BI': { const box = bboxOf(g.ctm, 0, 0, 1, 1); pend.push({ seq: ++SEQ.n, box, clip: hidden(box, g.clips), ops: [i, i] }); break; }
          case 'sh': { const k = g.clips.find(c => c.keep); if (g.clips.length && hidden(k ? k.keep[0] : null, g.clips.filter(c => c !== k))) dead.add(i); break; }
          case 'Do': {
            const ref = xobj && A[0] && A[0].name ? xobj.get(N(A[0].name)) : null, xo = look(ref);
            if (!xo || !xo.dict) break;
            const stp = xo.dict.get(N('Subtype')); const kind = stp ? stp.toString() : '';
            if (kind === '/Image') { const box = bboxOf(g.ctm, 0, 0, 1, 1); pend.push({ seq: ++SEQ.n, box, clip: hidden(box, g.clips), ops: [i, i] }); }
            else if (kind === '/Form') {
              const mt = look(xo.dict.get(N('Matrix'))), bb = look(xo.dict.get(N('BBox')));
              const m = mt ? mt.asArray().map(v => look(v).asNumber()) : [1, 0, 0, 1, 0, 0];
              const fctm = mul(m, g.ctm);
              let clips = g.clips;
              if (bb) { const b = bb.asArray().map(v => look(v).asNumber()); const box = bboxOf(fctm, Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])); if (hidden(box, g.clips)) { dead.add(i); break; } clips = clips.concat([{ keep: [box] }]); }
              SEQ.n++; onForm(ref, xo, resOf(xo.dict, res), fctm, clips);
            }
            break;
          }
          default: break;
        }
      }
      COVERS.push(...covers);
      // решение — после разбора всего листа (finish): заливки, нарисованные позже, известны полностью
      const finish = () => {
        // закрыт, если целиком под прямоугольником заливки и заливка в этом месте точно видна (её отсечения)
        const covered = (at, b) => !!b && COVERS.some(c => c.seq > at && inside(b, c.r) && shown(b, c.clips));
        for (const p_ of pend) {
          if (p_.text) { const r = buildText(p_.text, gl => gl.clipHide || covered(p_.seq, gl.box)); if (r != null) repl.set(p_.i, r); continue; }
          if (p_.clip || covered(p_.seq, p_.box)) for (let k = p_.ops[0]; k <= p_.ops[1]; k++) dead.add(k);
        }
      };
      return { ops, dead, repl, finish };
    }

    const SEQ = { n: 0 }, COVERS = [], FORMS = [];                 // порядок рисования на листе, «заплатки», разборы форм
    const streamUse = new Map();                                     // поток листа → { src, ch: «начало:конец» → замена }
    function rebuildByOffsets(src, ch) {
      const list = [...ch].map(([k, v]) => { const [a_, b_] = k.split(':').map(Number); return [a_, b_, v]; }).sort((x, y) => x[0] - y[0]);
      let out = '', pos = 0;
      for (const [a_, b_, v] of list) { if (a_ < pos) continue; out += src.slice(pos, a_) + v + ' '; pos = b_; removed++; }
      return out + src.slice(pos);
    }
    function rebuild(src, a) {
      if (!a.dead.size && !a.repl.size) return null;
      let out = '', pos = 0;
      a.ops.forEach((o, i) => {
        if (a.dead.has(i)) { out += src.slice(pos, o.start) + ' '; pos = o.end; removed++; }
        else if (a.repl.has(i)) { out += src.slice(pos, o.start) + a.repl.get(i) + ' '; pos = o.end; removed++; }
      });
      return out + src.slice(pos);
    }

    function visitForm(ref, xo, res, ctm, clips) {
      const key = ref instanceof PL.PDFRef ? ref.toString() : null; if (!key) return;
      let u = formUse.get(key);
      if (!u) { const src = readStream(xo); if (src == null) { formUse.set(key, { skip: true }); return; } u = { ref, xo, src, res, dead: null, repl: null, depth: 0 }; formUse.set(key, u); }
      if (u.skip || u.depth > 8) return;
      u.depth++;
      const a = analyse(u.src, res, ctm, clips, visitForm);
      u.depth--;
      FORMS.push({ u, a });                                          // решение — после разбора листа (см. scrubPage)
    }

    function scrubPage(page) {
      const node = page.node;
      node.normalize && node.normalize();
      const cb = page.getCropBox ? page.getCropBox() : page.getMediaBox();
      const pageClip = [{ keep: [[cb.x, cb.y, cb.x + cb.width, cb.y + cb.height]] }];
      const contents = look(node.get(N('Contents')));
      const list = contents instanceof PL.PDFArray ? contents.asArray() : contents ? [node.get(N('Contents'))] : [];
      const streams = list.map(r => ({ ref: r, st: look(r) })).filter(x => x.st);
      const srcs = streams.map(x => readStream(x.st));
      if (srcs.some(s => s == null)) return;
      // потоки листа — одно целое (q в одном, Q в другом): разбираем вместе, разделив переводами строки
      const joined = srcs.join('\n');
      SEQ.n = 0; COVERS.length = 0; FORMS.length = 0;
      const a = analyse(joined, node.Resources ? node.Resources() : look(node.get(N('Resources'))), [1, 0, 0, 1, 0, 0], pageClip, visitForm);
      a.finish();
      // формы: форма может стоять в нескольких местах — убираем только то, что не видно нигде
      for (const { u, a: fa } of FORMS) {
        fa.finish();
        if (!u.dead) { u.dead = fa.dead; u.repl = fa.repl; u.ops = fa.ops; }
        else {
          u.dead = new Set([...u.dead].filter(k => fa.dead.has(k)));
          for (const k of [...u.repl.keys()]) if (fa.repl.get(k) !== u.repl.get(k)) u.repl.delete(k);
        }
      }
      // правки — обратно в исходные потоки: поток может стоять на нескольких листах (общий чертёж),
      // поэтому в нём остаются только правки, верные для всех листов (как у форм)
      const bounds = []; let off = 0; for (const t of srcs) { bounds.push([off, off + t.length]); off += t.length + 1; }
      const per = streams.map(() => new Map());
      a.ops.forEach((o, i) => {
        if (!a.dead.has(i) && !a.repl.has(i)) return;
        const k = bounds.findIndex(([b0, b1]) => o.start >= b0 && o.end <= b1); if (k < 0) return;   // оператор на стыке потоков — не трогаем
        per[k].set((o.start - bounds[k][0]) + ':' + (o.end - bounds[k][0]), a.dead.has(i) ? '' : a.repl.get(i));
      });
      streams.forEach((x, k) => {
        if (!(x.ref instanceof PL.PDFRef)) return;
        const key = x.ref.toString(), prev = streamUse.get(key);
        if (!prev) streamUse.set(key, { ref: x.ref, st: x.st, src: srcs[k], ch: per[k] });
        else for (const [ck, v] of [...prev.ch]) if (per[k].get(ck) !== v) prev.ch.delete(ck);
      });
      // ссылки без адреса и действия — невидимые «мёртвые» области
      const ann = look(node.get(N('Annots')));
      if (ann instanceof PL.PDFArray) {
        const keep = ann.asArray().filter(r => {
          const d = look(r); if (!d || !d.get) return true;
          const t = d.get(N('Subtype')); if (!t || t.toString() !== '/Link') return true;
          const A = look(d.get(N('A'))), D = look(d.get(N('Dest'))) || (A && A.get(N('S')) && A.get(N('S')).toString() === '/GoTo' ? look(A.get(N('D'))) : null);
          if (D instanceof PL.PDFArray) { const tgt = D.get(0); return tgt instanceof PL.PDFRef && pageRefs.has(tgt.toString()); }   // переход на лист этого документа
          if (D) return false;                                         // именованные назначения в ТКП не используются
          return !!(A && A.get(N('S')));                               // внешняя ссылка (URI) — остаётся
        });
        if (keep.length !== ann.size()) { removed += ann.size() - keep.length; if (keep.length) node.set(N('Annots'), ctx.obj(keep)); else node.delete(N('Annots')); }
      }
    }

    const pageRefs = new Set(doc.getPages().map(p => p.ref.toString()));

    /* Сборка мусора: в файле остаётся только то, на что ссылается документ (старые потоки, страницы шаблона,
       подтянутые ссылками оглавления при копировании листов, и т. п. — удаляются) */
    function collect() {
      const seen = new Set(), todo = [];
      const t = ctx.trailerInfo; [t.Root, t.Info, t.Encrypt].forEach(r => r && todo.push(r));
      while (todo.length) {
        const v = todo.pop();
        if (v instanceof PL.PDFRef) { const k = v.toString(); if (seen.has(k)) continue; seen.add(k); const o = ctx.lookup(v); if (o) todo.push(o); continue; }
        if (v instanceof PL.PDFDict) { for (const [, x] of v.entries()) todo.push(x); continue; }
        if (v instanceof PL.PDFArray) { for (const x of v.asArray()) todo.push(x); continue; }
        if (v && v.dict instanceof PL.PDFDict) todo.push(v.dict);
      }
      let n = 0;
      for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) { ctx.delete(ref); n++; }
      return n;
    }

    return {
      run() {
        for (const p of doc.getPages()) { try { scrubPage(p); } catch (e) { console.warn('Очистка листа пропущена:', e); } }
        for (const u of streamUse.values()) {
          if (!u.ch.size) continue;
          const ns = ctx.flateStream(s2b(rebuildByOffsets(u.src, u.ch)));
          ctx.assign(u.ref, ns);
        }
        for (const u of formUse.values()) {
          if (u.skip || !u.dead) continue;
          const out = rebuild(u.src, u); if (out == null) continue;
          const ns = ctx.flateStream(s2b(out), {}); const d = u.xo.dict;
          for (const [k, v] of d.entries()) { const key = k.toString(); if (key !== '/Length' && key !== '/Filter' && key !== '/DecodeParms') ns.dict.set(k, v); }
          ctx.assign(u.ref, ns);
        }
        const orphans = collect();
        return { removed, orphans };
      }
    };
  }

  /* В каталоге — служебные слои Acrobat (Fill & Sign): не нужны */
  function cleanCatalog(PL, doc) {
    const cat = doc.catalog; ['OCProperties', '_FillSignInfo'].forEach(k => cat.delete(PL.PDFName.of(k)));
  }

  window.PdfScrub = {
    async scrub(doc) {
      const PL = window.PDFLib; if (!PL || !PL.decodePDFRawStream) return 0;
      if (doc.flush) await doc.flush();                               // встроенные листы (embedPage) — в файл сейчас, чтобы их тоже почистить
      cleanCatalog(PL, doc);
      const r = Scrubber(PL, doc).run();
      window.__scrubStat = r;                                         // для автопроверки
      return r;
    },
    _tokenize: tokenize
  };
})();
