/* ТКП в Word (.docx) — для конфигураторов ПЧ (ESQ F ME800 / ME800-R) и УПП (ESQ F HVS).

   Берёт готовый PDF ТКП (его собирают tkp.js / tkp_upp.js) и данные комплектации и собирает документ Word:
   • редактируемым текстом — листы, которые обычно правят: таблица предложения (цены, доп. строки, итог, гарантия),
     описание с дополнительной комплектацией, расшифровка обозначения, таблица технических характеристик;
   • картинками во всю страницу в исходном оформлении — постоянные и графические листы (обложка, письмо, схемы,
     чертёж, такелаж, обслуживание, клиенты). Картинки рендерит pdf.js из того же PDF.

   Библиотека docx — assets/vendor/docx.iife.js (запасной вариант — CDN), pdf.js — assets/vendor/pdfjs. */
(function () {
  'use strict';
  const TEAL = '0A6972', ORANGE = 'F26928', INK = '231F20', MUTED = '6B787C', LINE = 'CFDFE1', HEADBG = 'E7F1F2', GRAY = 'D4D4D4';
  const FONT = 'Arial';
  const PX = { w: 794, h: 1123 };                                       // A4 в пикселях Word (96 dpi)
  const TW = { w: 11906, h: 16838 };                                    // A4 в twips

  /* ---------- загрузка библиотек ---------- */
  function loadScript(src) {
    return new Promise((ok, fail) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => fail(new Error('не загрузился ' + src)); document.head.appendChild(el); });
  }
  async function docxLib() {
    if (window.docx) return window.docx;
    try { await loadScript('assets/vendor/docx.iife.js'); } catch (e) { await loadScript('https://cdn.jsdelivr.net/npm/docx@9.6.1/dist/index.iife.js'); }
    if (!window.docx) throw new Error('библиотека docx не загрузилась');
    return window.docx;
  }
  let pdfjsP = null;
  function pdfjsLib() {
    return pdfjsP || (pdfjsP = (async () => {
      let err;
      for (const base of ['assets/vendor/pdfjs/', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/'].map(u => new URL(u, document.baseURI).href)) {
        try { const m = await import(base + 'pdf.min.mjs'); m.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs'; return m; } catch (e) { err = e; }
      }
      pdfjsP = null; throw err;
    })());
  }

  /* ---------- листы PDF → JPEG ---------- */
  async function renderPages(pdfBytes, indexes) {
    const pdfjs = await pdfjsLib();
    const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) }), pdf = await task.promise, out = {};
    for (const i of indexes) {
      const page = await pdf.getPage(i + 1), v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 150 / 72 });                // 150 dpi
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvas: cv, canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .88));
      out[i] = { data: new Uint8Array(await blob.arrayBuffer()), landscape: v1.width > v1.height };
    }
    (pdf.destroy ? pdf.destroy() : task.destroy());
    return out;
  }
  async function fetchImage(url) {
    const r = await fetch(url); if (!r.ok) throw new Error('нет файла ' + url);
    const buf = await r.arrayBuffer(), bmp = await createImageBitmap(new Blob([buf]));
    return { data: new Uint8Array(buf), w: bmp.width, h: bmp.height, type: /\.jpe?g$/i.test(url) ? 'jpg' : 'png' };
  }

  /* ---------- построители ---------- */
  function kit(D) {
    const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, VerticalAlign, ImageRun,
      Header, Footer, PageNumber, TabStopType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, PageOrientation } = D;
    const run = (text, o = {}) => new TextRun({ text: String(text), font: FONT, size: Math.round((o.size || 10) * 2), bold: !!o.bold, color: o.color || INK, superScript: !!o.sup, subScript: !!o.sub });
    const p = (text, o = {}) => new Paragraph({
      children: Array.isArray(text) ? text : [run(text, o)],
      alignment: o.align === 'c' ? AlignmentType.CENTER : o.align === 'r' ? AlignmentType.RIGHT : o.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      spacing: { before: Math.round((o.before || 0) * 20), after: Math.round((o.after ?? 4) * 20), line: o.line || 276 },
      indent: o.indent ? { firstLine: Math.round(o.indent * 20) } : o.hanging ? { left: Math.round(o.hanging * 20), hanging: Math.round(o.hanging * 20) } : undefined,
      keepNext: !!o.keepNext
    });
    const h = (text) => p(text, { size: 13, bold: true, color: ORANGE, after: 10, keepNext: true });
    const bord = c => ({ style: BorderStyle.SINGLE, size: 6, color: c });
    const borders = c => ({ top: bord(c), bottom: bord(c), left: bord(c), right: bord(c) });
    const td = (content, o = {}) => new TableCell({
      children: (Array.isArray(content) ? content : [content]).map(x => typeof x === 'string' || typeof x === 'number' ? p(x, { size: o.size || 9, align: o.align, bold: o.bold, color: o.color, after: 0 }) : x),
      width: o.w ? { size: o.w, type: WidthType.DXA } : undefined,
      columnSpan: o.span, rowSpan: o.rows,
      verticalAlign: o.top ? VerticalAlign.TOP : VerticalAlign.CENTER,
      shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      borders: o.noBorder ? { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } } : borders(o.line || TEAL),
      margins: { top: 70, bottom: 70, left: 100, right: 100 }
    });
    const table = (rows, widths) => new Table({ rows, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths });
    const tr = (cells, o = {}) => new TableRow({ children: cells, tableHeader: !!o.header, cantSplit: true });

    // секция «картинка во всю страницу»: без полей и колонтитулов
    const imagePage = img => ({
      properties: { page: { size: { width: TW.w, height: TW.h, orientation: img.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [] })] }) },
      children: [new Paragraph({ spacing: { after: 0, line: 240 }, children: [new ImageRun({
        type: 'jpg', data: img.data,
        transformation: img.landscape ? { width: PX.h, height: PX.w } : { width: PX.w, height: PX.h },
        floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
          wrap: { type: TextWrappingType.NONE }, behindDocument: true, allowOverlap: true }
      })] })]
    });
    // секция с текстом: шапка и подвал как у листов ТКП
    const textSection = (children, ui, pageNo) => ({                   // pageNo — номер листа, как в PDF (обложка — 0)
      properties: { page: { size: { width: TW.w, height: TW.h }, margin: { top: 1500, right: 1000, bottom: 1400, left: 1000, header: 450, footer: 350 },
        pageNumbers: pageNo != null ? { start: pageNo } : undefined } },
      headers: { default: new Header({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TW.w - 2000 }],
        children: [new ImageRun({ type: ui.logo.type, data: ui.logo.data, transformation: { width: Math.round(30 * ui.logo.w / ui.logo.h), height: 30 } }),
          new TextRun({ text: '\tТЕХНИКО-КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ   ', font: FONT, size: 20, color: TEAL, characterSpacing: 40 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20, color: TEAL })]
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new ImageRun({ type: ui.icons.type, data: ui.icons.data,
        transformation: { width: Math.min(600, Math.round(36 * ui.icons.w / ui.icons.h)), height: Math.round(Math.min(600, 36 * ui.icons.w / ui.icons.h) * ui.icons.h / ui.icons.w) } })] })] }) },
      children
    });
    return { run, p, h, td, tr, table, imagePage, textSection };
  }

  /* ---------- общие листы ---------- */
  function offerBlock(K, offer, title) {
    const W = [700, 4900, 1500, 2400];
    const head = K.tr(['№', 'Наименование', 'Кол-во', 'Стоимость за ед.'].map((t, i) => K.td(t, { w: W[i], align: 'c', color: TEAL, size: 10 })), { header: true });
    const rows = offer.rows.map((r, i) => K.tr([
      K.td(String(i + 1), { w: W[0], align: 'c', size: 10 }), K.td(r.name, { w: W[1], size: 10 }),
      K.td(r.qty + ' ' + (r.unit || 'шт'), { w: W[2], align: 'c', size: 10 }), K.td(r.price ? offer.money(r.price) : '', { w: W[3], align: 'c', size: 10 })]));
    return [K.h(title), K.table([head, ...rows], W), K.p(offer.total, { size: 10.6, before: 14, after: 6 }), K.p(offer.warranty, { size: 10.6, justify: true })];
  }
  function save(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const fileBase = mark => 'TKP_' + mark.replace(/А/g, 'A').replace(/ /g, '_');
  async function ui() { const [logo, icons] = await Promise.all([fetchImage('assets/ui/elkom.png'), fetchImage('assets/ui/icons.png')]); return { logo, icons }; }

  /* ================= ПЧ: ESQ F ME800 / ME800-R =================
     Листы шаблона: 0 обложка, 1 письмо, 2 содержание, 3 предложение, 4 описание, 5 расшифровка, 6–10 схемы и чертёж,
     11–12 влияние на сеть и форма напряжения, 13–15 характеристики, 16–17 такелаж, 18 обслуживание, 19 клиенты. */
  async function pch({ pdf, s, vals, cell, offer, desc, decode }) {
    const D = await docxLib(), K = kit(D);
    const IMG = [0, 1, 2, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18, 19];
    const [img, U, specs] = await Promise.all([renderPages(pdf, IMG), ui(), fetch('assets/tkp/pch_specs.json').then(r => r.json())]);

    // описание
    // описание — плотнее обычного текста, чтобы, как в PDF, уместиться на одном листе
    const ds = { size: 9.5, line: 250 }, dr = (t, o = {}) => K.run(t, { size: ds.size, ...o });
    const descChildren = [K.h(desc.title)];
    desc.paras.forEach(t => descChildren.push(K.p(t, { ...ds, justify: true, indent: 16, after: 2 })));
    descChildren.push(K.p(desc.head, { ...ds, bold: true, before: 3, after: 1, keepNext: true }));
    desc.bullets.forEach(t => descChildren.push(K.p([dr('•\t'), dr(t)], { ...ds, hanging: 12, after: 0 })));
    desc.tail.forEach(t => descChildren.push(K.p(t, { ...ds, justify: true, indent: 16, before: 3, after: 0 })));
    if (desc.extras.length) {
      descChildren.push(K.p(desc.extrasTitle, { ...ds, bold: true, color: TEAL, before: 6, after: 1, keepNext: true }));
      desc.extras.forEach(([head, rest]) => descChildren.push(K.p([dr('•\t', { color: TEAL }), dr(head, { bold: true }), dr(rest)], { ...ds, hanging: 12, after: 1 })));
    }

    // расшифровка
    // маркировка: части по очереди бирюзовым и оранжевым, номер позиции — маленьким индексом после части
    const markRuns = []; let k = 0;
    decode.segments.forEach(([t, n]) => {
      if (!n) { markRuns.push(K.run(t, { bold: true, size: 13 })); return; }
      markRuns.push(K.run(t, { bold: true, size: 13, color: k++ % 2 ? ORANGE : TEAL }), K.run(String(n), { size: 7, color: MUTED, sub: true }), K.run(' ', { size: 6 }));
    });
    const DW = [700, 4000, 5300];
    const decodeChildren = [K.h('Расшифровка обозначения'),
      K.p(markRuns, { align: 'c', after: 2 }),
      K.p('Маркировка преобразователя (цифра у каждой части — номер позиции в таблице)', { size: 8.5, align: 'c', color: MUTED, after: 10 }),
      K.table([K.tr(['Поз.', 'Параметр', 'Обозначение'].map((t, i) => K.td(t, { w: DW[i], align: 'c', bold: true, fill: GRAY, line: INK })), { header: true }),
        ...decode.rows.map((r, i) => K.tr([K.td(String(i + 1), { w: DW[0], align: 'c', bold: true, line: INK }), K.td(r[0], { w: DW[1], line: INK }), K.td(r[1], { w: DW[2], line: INK })]))], DW)];

    // характеристики: постоянный текст — из шаблона (assets/tkp/pch_specs.json), значения комплектации — те же, что в PDF
    const keyFor = (page, y0) => Object.keys(cell).find(k => cell[k][0] === page && Math.abs(cell[k][2] - y0) < 2.5);
    const valueOf = (page, c) => {
      const key = keyFor(page, c.y0);
      let t = key && key in vals ? vals[key] : c.text;
      if (/окружающего воздуха от/.test(t)) t = t.replace(/от [−-]?\+?\d+ °С до \+40 °С/, 'от ' + (s.isR ? '0' : '−5') + ' °С до +40 °С');
      if (/Защита срабатывает при уровне напряжения выше/.test(t)) t = t.replace(/выше \d+%/, 'выше 110%');
      return t;
    };
    const SW = [3600, 6300], specRows = [];
    for (const r of specs) {
      if (r.section) { specRows.push(K.tr([K.td(r.section, { span: 2, align: 'c', bold: true, fill: HEADBG, size: 10 })])); continue; }
      const cells = r.cells.map(c => valueOf(r.page, c)).map(t => t || '—');
      cells.forEach((t, i) => specRows.push(K.tr(i ? [K.td(t, { w: SW[1], align: 'c' })]
        : [K.td(r.label, { w: SW[0], align: 'c', rows: cells.length > 1 ? cells.length : undefined }), K.td(t, { w: SW[1], align: 'c' })])));
    }
    const specChildren = [K.h('5. Основные технические характеристики предлагаемого оборудования'), K.table(specRows, SW)];

    const sections = [];
    [0, 1, 2].forEach(i => sections.push(K.imagePage(img[i])));
    sections.push(K.textSection(offerBlock(K, offer, '1. Технико-коммерческое предложение'), U, 3));
    sections.push(K.textSection(descChildren, U, 4));
    sections.push(K.textSection(decodeChildren, U, 5));
    [6, 7, 8, 9, 10, 11, 12].forEach(i => sections.push(K.imagePage(img[i])));
    sections.push(K.textSection(specChildren, U, 13));
    [16, 17, 18, 19].forEach(i => sections.push(K.imagePage(img[i])));

    const doc = new D.Document({ creator: s.who || 'ООО «Элком»', title: 'ТКП ' + s.mark, styles: { default: { document: { run: { font: FONT, size: 20 } } } }, sections });
    save(await D.Packer.toBlob(doc), fileBase(s.mark) + '.docx');
  }

  /* ================= УПП: ESQ F HVS =================
     plan — порядок листов PDF (из tkp_upp.js); тексты — offer, desc (абзацы), tech (строки таблицы характеристик). */
  async function upp({ pdf, s, plan, offer, desc, tech }) {
    const D = await docxLib(), K = kit(D);
    const at = key => plan.findIndex(x => x[1] === key || x[0] === key);
    const iOffer = at('offer'), iDesc = at('desc'), tIdx = plan.map((x, i) => /^tech\d+$/.test(x[1] || '') ? i : -1).filter(i => i >= 0);
    const textIdx = new Set([iOffer, iDesc, ...tIdx]);
    const IMG = plan.map((x, i) => i).filter(i => !textIdx.has(i));
    const [img, U] = await Promise.all([renderPages(pdf, IMG), ui()]);

    const descChildren = [K.h(desc.title)];
    desc.blocks.forEach(b => {
      if (b.head) descChildren.push(K.p(b.head, { bold: true, before: 6, keepNext: true, color: b.teal ? TEAL : undefined }));
      (b.paras || []).forEach(t => descChildren.push(K.p(t, { justify: true, indent: 16 })));
      (b.bullets || []).forEach(t => descChildren.push(K.p(Array.isArray(t)                       // [заголовок полужирным, остальной текст]
        ? [K.run('•\t', { color: b.teal ? TEAL : INK }), K.run(t[0], { bold: true }), K.run(t[1])] : [K.run('•\t'), K.run(t)], { hanging: 12, after: 2 })));
    });

    const TW2 = [3600, 6300], techRows = [];
    tech.rows.forEach(r => {
      if (r.section) techRows.push(K.tr([K.td(r.section, { span: 2, align: 'c', bold: true, fill: HEADBG, size: 10 })]));
      else techRows.push(K.tr([K.td(r.label, { w: TW2[0], align: 'c' }), K.td(Array.isArray(r.value) ? r.value : (r.value || '—'), { w: TW2[1], align: 'c' })]));
    });

    const sections = [];
    let techDone = false;
    plan.forEach((x, i) => {
      if (i === iOffer) sections.push(K.textSection(offerBlock(K, offer, '1. Технико-коммерческое предложение'), U, i));
      else if (i === iDesc) sections.push(K.textSection(descChildren, U, i));
      else if (tIdx.includes(i)) { if (!techDone) { sections.push(K.textSection([K.h(tech.title), K.table(techRows, TW2)], U, i)); techDone = true; } }
      else sections.push(K.imagePage(img[i]));
    });
    const doc = new D.Document({ creator: s.who || 'ООО «Элком»', title: 'ТКП ' + s.mark, styles: { default: { document: { run: { font: FONT, size: 20 } } } }, sections });
    save(await D.Packer.toBlob(doc), fileBase(s.mark) + '.docx');
  }

  window.TkpDocx = { pch, upp };
})();
