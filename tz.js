/* Разбор ТЗ на ПЧ ESQ F ME800: чтение файлов → разбор (через облачную функцию) → проверка человеком → документы.
   Ключ API в браузер не попадает: всё идёт через облачную функцию, доступ к ней — по паролю сотрудника. */
(function () {
  'use strict';

  // ===== НАСТРОЙКИ =====
  const FUNCTION_URL = window.TZ_FUNCTION_URL || 'https://functions.yandexcloud.net/d4eplvhu1pvut5be24vd';   // адрес облачной функции, https://functions.yandexcloud.net/…
  const PDFJS_BASE = new URL(window.PDFJS_BASE || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/legacy/build/', document.baseURI).href;
  const CONFIGURATOR = 'configurator_vv_pch.html';
  const OCR_MAX_SIDE = 2000;         // px по длинной стороне страницы для распознавания
  const OCR_PARALLEL = 3;

  const ST = { OK: 'Соответствует', OPT: 'Соответствует (опция)', DEV: 'Отклонение', CHECK: 'Проверить', CTR: 'Договорное', NA: 'Не относится к ПЧ' };
  const ST_ORDER = ['DEV', 'CHECK', 'OPT', 'OK', 'CTR', 'NA'];
  const SEV = { OK: 0, OPT: 1, CHECK: 2, DEV: 3 };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  const state = { files: [], ocrPages: 0, result: null, rows: [], filter: null, sku: '', model: '', usage: null };

  // ===== СВЯЗЬ С ФУНКЦИЕЙ =====
  async function api(action, payload) {
    if (!FUNCTION_URL) throw new Error('Адрес облачной функции ещё не задан в tz.js (FUNCTION_URL)');
    const r = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },   // простой запрос — без preflight
      body: JSON.stringify(Object.assign({ password: $('pw').value || store.get('tzpw') || '', action }, payload || {})),
    });
    const raw = await r.text(); let j = null; try { j = JSON.parse(raw); } catch (e) {}
    if (!r.ok || !j || !j.ok) {
      if (j && j.error) throw new Error(j.error);
      const hint = r.status === 403 ? ' — функция не публичная или не создана её версия (Cloud Functions → Обзор → «Публичная функция»)'
        : r.status === 502 ? ' — функция упала при запуске: проверьте точку входа index.handler и что в архиве есть index.js и prompt.js' : '';
      throw new Error('Ошибка функции: HTTP ' + r.status + hint + (raw ? ' [' + raw.slice(0, 200) + ']' : ''));
    }
    return j;
  }

  // ===== 1. ДОСТУП =====
  if (store.get('tzpw')) { $('pw').value = store.get('tzpw'); $('authMsg').textContent = 'Пароль сохранён до закрытия браузера'; }
  $('btnLogin').onclick = async () => {
    const m = $('authMsg'); m.className = 'msg'; m.innerHTML = '<span class="spin"></span>Проверяю…';
    try { await api('ping'); store.set('tzpw', $('pw').value); m.className = 'msg ok'; m.textContent = 'Доступ есть'; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  };
  $('pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLogin').click(); });
  $('btnDiag').onclick = async () => {
    const o = $('diagOut'); o.classList.remove('hidden'); o.textContent = 'Проверяю… (до 30 с)';
    try {
      const j = await api('diag');
      o.textContent = 'Каталог: ' + j.folder + '\nКлюч: ' + j.key + '\n\n' +
        j.results.map(r => (String(r.status) === '200' ? '✅ ' : '❌ ') + r.test + ' → ' + r.status + (String(r.status) === '200' ? '' : '\n   ' + r.answer)).join('\n');
    } catch (e) { o.textContent = 'Ошибка: ' + e.message; }
  };

  // ===== 2. ФАЙЛЫ =====
  const drop = $('drop');
  drop.onclick = () => $('fileInput').click();
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  $('fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('btnClear').onclick = () => { state.files = []; renderFiles(); $('textBox').classList.add('hidden'); $('tzText').value = ''; $('readMsg').textContent = ''; updateAnalyzeBtn(); };

  function addFiles(list) {
    for (const f of list) if (!state.files.some(x => x.name === f.name && x.size === f.size)) state.files.push(f);
    renderFiles();
  }
  function kind(f) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx') return 'docx';
    if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
    if (['jpg', 'jpeg', 'png'].includes(ext)) return 'img';
    if (ext === 'txt') return 'txt';
    if (['doc', 'xls', 'rtf'].includes(ext)) return 'old';
    return 'unknown';
  }
  function renderFiles() {
    $('fileList').innerHTML = state.files.map((f, i) => {
      const k = kind(f), warn = k === 'old' ? 'старый формат — пересохраните в .docx / .xlsx' : k === 'unknown' ? 'формат не поддерживается' : (f.size / 1024 / 1024).toFixed(1) + ' МБ';
      return `<li><span>${esc(f.name)}</span><span>${esc(warn)} <a href="#" data-del="${i}">✕</a></span></li>`;
    }).join('');
    $('fileList').querySelectorAll('[data-del]').forEach(a => a.onclick = e => { e.preventDefault(); state.files.splice(+a.dataset.del, 1); renderFiles(); });
    $('btnRead').disabled = !state.files.some(f => !['old', 'unknown'].includes(kind(f)));
    $('btnClear').disabled = !state.files.length;
  }

  function progress(done, total) { const b = $('readBar'); b.style.display = total ? 'block' : 'none'; b.firstElementChild.style.width = (total ? Math.round(done / total * 100) : 0) + '%'; }

  $('btnRead').onclick = async () => {
    const btn = $('btnRead'); btn.disabled = true; state.ocrPages = 0;
    const m = $('readMsg'); m.className = 'msg';
    const parts = [], problems = [];
    try {
      for (const f of state.files) {
        const k = kind(f);
        if (k === 'old' || k === 'unknown') { problems.push(f.name + ': пропущен (' + (k === 'old' ? 'пересохраните в .docx/.xlsx' : 'формат не поддерживается') + ')'); continue; }
        m.innerHTML = '<span class="spin"></span>Читаю ' + esc(f.name) + '…';
        let t = '';
        if (k === 'pdf') t = await readPdf(f, (d, n, ocr) => { progress(d, n); m.innerHTML = '<span class="spin"></span>' + esc(f.name) + ': страница ' + d + ' из ' + n + (ocr ? ' (распознавание скана)' : ''); });
        else if (k === 'docx') t = await readDocx(f);
        else if (k === 'xlsx') t = await readXlsx(f);
        else if (k === 'img') { t = await ocrImage(await fileToImage(f)); state.ocrPages++; }
        else if (k === 'txt') t = await f.text();
        parts.push('=== Файл: ' + f.name + ' ===\n' + t.trim());
      }
      progress(0, 0);
      $('tzText').value = parts.join('\n\n');
      $('textBox').classList.remove('hidden'); $('textBox').open = false;
      updateTextStat();
      m.className = problems.length ? 'msg err' : 'msg ok';
      m.textContent = 'Готово: ' + $('tzText').value.length.toLocaleString('ru') + ' символов' +
        (state.ocrPages ? ', распознано страниц-сканов: ' + state.ocrPages + ' — сверьте цифры внимательнее' : '') +
        (problems.length ? '. ' + problems.join('; ') : '');
    } catch (e) { progress(0, 0); m.className = 'msg err'; m.textContent = 'Ошибка чтения: ' + e.message; }
    btn.disabled = false; updateAnalyzeBtn();
  };
  $('tzText').addEventListener('input', () => { updateTextStat(); updateAnalyzeBtn(); });
  function updateTextStat() { const n = $('tzText').value.length; $('textStat').textContent = n.toLocaleString('ru') + ' символов, ≈' + Math.round(n / 3).toLocaleString('ru') + ' токенов'; }
  function updateAnalyzeBtn() { $('btnAnalyze').disabled = $('tzText').value.trim().length < 200; }

  // --- PDF: текстовый слой, страницы без текста — на распознавание
  let pdfjsP = null;
  const loadPdfjs = () => pdfjsP || (pdfjsP = import(PDFJS_BASE + 'pdf.min.mjs').then(m => {
    m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs'; return m;
  }));
  async function readPdf(file, onPage) {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = pdf.numPages, out = new Array(n), scans = [];
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) { if (it.str !== undefined) { s += it.str; s += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : ''); } }
      s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (s.replace(/\s/g, '').length < 30) scans.push(i); else out[i - 1] = s;
      onPage(i, n, false);
    }
    let done = 0;
    const work = async () => {
      while (scans.length) {
        const i = scans.shift();
        const page = await pdf.getPage(i);
        const v1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(4, OCR_MAX_SIDE / Math.max(v1.width, v1.height)) });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        out[i - 1] = (await ocrImage(c)).trim() || '[страница ' + i + ': текст не распознан]';
        state.ocrPages++; done++;
        onPage(done, done + scans.length, true);
      }
    };
    if (scans.length) await Promise.all(Array.from({ length: Math.min(OCR_PARALLEL, scans.length) }, work));
    return out.map((t, i) => '[стр. ' + (i + 1) + ']\n' + t).join('\n\n');
  }

  function fileToImage(f) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Картинка не читается: ' + f.name)); img.src = URL.createObjectURL(f); });
  }
  async function ocrImage(src) {
    let c = src;
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const k = Math.min(1, OCR_MAX_SIDE / Math.max(w, h));
    if (!(src instanceof HTMLCanvasElement) || k < 1) {
      c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height);
    }
    let q = 0.85, b64 = '';
    do { b64 = c.toDataURL('image/jpeg', q).split(',')[1]; q -= 0.15; } while (b64.length > 3000000 && q > 0.3);
    return (await api('ocr', { image: b64, mime: 'JPEG' })).text || '';
  }

  // --- DOCX: абзацы и таблицы (ячейки через « | »)
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (n, name) => Array.from(n.childNodes).filter(c => c.localName === name);
  async function readDocx(f) {
    const zip = await JSZip.loadAsync(await f.arrayBuffer());
    const doc = xml(await zip.file('word/document.xml').async('string'));
    const body = doc.getElementsByTagNameNS('*', 'body')[0];
    const lines = [];
    const paraText = p => {
      let s = '';
      (function walk(n) { for (const c of n.childNodes) {
        if (c.localName === 't') s += c.textContent; else if (c.localName === 'tab') s += '\t';
        else if (c.localName === 'br' || c.localName === 'cr') s += '\n'; else if (c.childNodes && c.childNodes.length) walk(c);
      } })(p);
      return s;
    };
    const cellText = tc => { const a = []; blockWalk(tc, a); return a.join(' / ').replace(/\s+/g, ' ').trim(); };
    function blockWalk(n, acc) {
      for (const c of n.childNodes) {
        if (c.localName === 'p') { const t = paraText(c).trim(); if (t) acc.push(t); }
        else if (c.localName === 'tbl') {
          for (const tr of kids(c, 'tr')) { const cells = kids(tr, 'tc').map(cellText); if (cells.some(Boolean)) acc.push(cells.join(' | ')); }
        } else if (c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'customXml') blockWalk(c, acc);
      }
    }
    blockWalk(body, lines);
    return lines.join('\n');
  }

  // --- XLSX: видимые листы, строки — ячейки через « | »
  async function readXlsx(f) {
    const zip = await JSZip.loadAsync(await f.arrayBuffer());
    const wb = xml(await zip.file('xl/workbook.xml').async('string'));
    const rels = xml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    const relMap = {}; Array.from(rels.getElementsByTagNameNS('*', 'Relationship')).forEach(r => relMap[r.getAttribute('Id')] = r.getAttribute('Target'));
    let shared = [];
    const ss = zip.file('xl/sharedStrings.xml');
    if (ss) shared = Array.from(xml(await ss.async('string')).getElementsByTagNameNS('*', 'si')).map(si =>
      Array.from(si.getElementsByTagNameNS('*', 't')).map(t => t.textContent).join(''));
    const out = [];
    for (const sh of Array.from(wb.getElementsByTagNameNS('*', 'sheet'))) {
      if ((sh.getAttribute('state') || '') !== '' && sh.getAttribute('state') !== 'visible') continue;
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[rid] || ''; target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      const file = zip.file('xl/' + target); if (!file) continue;
      const sx = xml(await file.async('string'));
      const rows = [];
      for (const row of Array.from(sx.getElementsByTagNameNS('*', 'row'))) {
        const cells = [];
        for (const c of kids(row, 'c')) {
          const t = c.getAttribute('t'); let v = '';
          if (t === 'inlineStr') v = Array.from(c.getElementsByTagNameNS('*', 't')).map(x => x.textContent).join('');
          else { const ve = kids(c, 'v')[0]; v = ve ? ve.textContent : ''; if (t === 's') v = shared[+v] || ''; else if (t === 'b') v = v === '1' ? 'да' : 'нет'; }
          v = String(v).replace(/\s+/g, ' ').trim(); if (v) cells.push(v);
        }
        if (cells.length) rows.push(cells.join(' | '));
      }
      if (rows.length) out.push('--- Лист: ' + sh.getAttribute('name') + ' ---\n' + rows.join('\n'));
    }
    return out.join('\n\n');
  }

  // ===== 3. РАЗБОР =====
  const CHUNK = 14000;        // символов в одной части ТЗ
  const PARALLEL = 3;         // одновременных запросов
  function splitText(t) {
    const parts = []; let i = 0;
    while (i < t.length) {
      let end = Math.min(t.length, i + CHUNK);
      if (end < t.length) { const nl = t.lastIndexOf('\n', end); if (nl > i + CHUNK * 0.6) end = nl; }
      parts.push(t.slice(i, end)); i = end;
    }
    return parts;
  }
  async function runPool(tasks, n, onDone) {
    const res = new Array(tasks.length); let next = 0;
    const worker = async () => { while (next < tasks.length) { const k = next++; res[k] = await tasks[k](); onDone(); } };
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
    return res;
  }
  async function tryTwice(fn) {
    try { return { ok: true, j: await fn() }; }
    catch (e1) {
      if (/пароль|не с сайта|ключ/i.test(e1.message)) return { ok: false, err: e1.message };
      try { return { ok: true, j: await fn() }; } catch (e2) { return { ok: false, err: e2.message }; }
    }
  }

  $('btnAnalyze').onclick = async () => {
    const btn = $('btnAnalyze'), m = $('anMsg'); btn.disabled = true; m.className = 'msg';
    const text = $('tzText').value.trim();
    const parts = text.length <= CHUNK * 1.15 ? [text] : splitText(text);
    const single = parts.length === 1;
    let done = 0; const total = single ? 1 : parts.length + 1;
    const t0 = Date.now();
    const show = () => { m.innerHTML = '<span class="spin"></span>Идёт разбор ТЗ… ' + (single ? '' : 'готово частей ' + done + ' из ' + total + ' · ') + Math.round((Date.now() - t0) / 1000) + ' с'; };
    const tick = setInterval(show, 500); show();
    try {
      const tasks = single
        ? [() => tryTwice(() => api('extract', { text, mode: 'full' }))]
        : [() => tryTwice(() => api('extract', { text, mode: 'params' }))].concat(
            parts.map((p, i) => () => tryTwice(() => api('extract', { text: p, mode: 'reqs', part: (i + 1) + '/' + parts.length }))));
      const res = await runPool(tasks, PARALLEL, () => { done++; });
      clearInterval(tick);
      const failed = [];
      res.forEach((r, i) => { if (!r.ok) failed.push(single ? 'ТЗ' : i === 0 ? 'исходные данные' : 'часть ' + i + ' из ' + parts.length); });
      if (failed.length === res.length) throw new Error(res[0].err || 'Разбор не удался');
      const base = (res[0].ok && res[0].j.data) || {};
      const data = { document: base.document || {}, params: base.params || {}, params_src: base.params_src || {}, requirements: [], extra_positions: [] };
      const seen = new Set();
      res.forEach((r, i) => {
        if (!r.ok) {
          if (i > 0 || single) data.requirements.push({ clause: single ? '' : 'часть ' + i, requirement: 'Эта часть ТЗ не разобрана автоматически (' + r.err.slice(0, 160) + ')', proposal: '', status: 'CHECK', rule: '', comment: 'Проверьте эту часть текста вручную или повторите разбор', check: [] });
          return;
        }
        const d = r.j.data || {};
        for (const q of d.requirements || []) {
          const key = String(q.clause || '').trim() + '|' + String(q.requirement || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 70);
          if (seen.has(key)) continue; seen.add(key); data.requirements.push(q);
        }
        for (const x of d.extra_positions || []) if (x && !data.extra_positions.includes(x)) data.extra_positions.push(x);
        if (!single && i > 0 && !data.document.title && d.document && d.document.title) data.document = d.document;
      });
      state.model = res.filter(r => r.ok).map(r => r.j.model).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      loadResult(data);
      m.className = failed.length ? 'msg err' : 'msg ok';
      m.textContent = 'Готово за ' + Math.round((Date.now() - t0) / 1000) + ' с' + (failed.length ? '. Не разобрано: ' + failed.join(', ') + ' — см. строки «Проверить» в таблице' : '');
    } catch (e) { clearInterval(tick); m.className = 'msg err'; m.textContent = e.message; }
    btn.disabled = false;
  };

  function loadResult(data) {
    const d = data || {};
    state.result = d;
    const doc = d.document || {};
    $('docTitle').value = doc.title || ''; $('docCustomer').value = doc.customer || ''; $('docObject').value = doc.object || '';
    state.params = Object.assign({}, d.params || {});
    state.paramsSrc = d.params_src || {};
    state.rows = (d.requirements || []).map(r => ({
      clause: str(r.clause), requirement: str(r.requirement), proposal: str(r.proposal), comment: str(r.comment), client: str(r.client_note), rule: str(r.rule),
      modelStatus: ST[r.modelStatus] ? r.modelStatus : ST[r.status] ? r.status : 'CHECK', status: ST[r.status] ? r.status : 'CHECK', check: Array.isArray(r.check) ? r.check : [], userSet: !!r.userSet, auto: '',
    }));
    $('extraPos').value = (d.extra_positions || []).join('\n');
    if (d._ui) { if (d._ui.author) $('author').value = d._ui.author; }
    ['secResult', 'secReq', 'secOut'].forEach(id => $(id).classList.remove('hidden'));
    renderParams(); runChecks(); renderRows(); updateConfig();
    $('secResult').scrollIntoView({ behavior: 'smooth' });
  }
  const str = v => v == null ? '' : String(v);

  // ===== ИСХОДНЫЕ ДАННЫЕ =====
  const P = [
    ['voltage_kv', 'Напряжение, кВ', [['', '—'], ['6', '6'], ['10', '10']]],
    ['motor_power_kw', 'Мощность ЭД, кВт'], ['motor_current_a', 'Ток ЭД, А'],
    ['vfd_power_kw', 'Мощность ПЧ по ТЗ, кВт'], ['vfd_current_a', 'Ток ПЧ по ТЗ, А'], ['vfd_kva', 'Полная мощность ПЧ по ТЗ, кВА'],
    ['quantity', 'Количество, шт'],
    ['motor_type', 'Тип ЭД', [['', '—'], ['A', 'Асинхронный'], ['S', 'Синхронный']]],
    ['capacitors', 'Конденсаторы', [['', 'Авто (плёнка, если возможно)'], ['PF', 'Плёночные'], ['EL', 'Электролитические']]],
    ['winding', 'Обмотки трансформатора', [['', '—'], ['AL', 'Алюминий'], ['CU', 'Медь']]],
    ['cells_per_phase', 'Ячеек на фазу', [['', 'По умолчанию (6 кВ — 5, 10 кВ — 8)'], ['5', '5'], ['6', '6'], ['8', '8'], ['9', '9']]],
    ['bypass', 'Шкаф байпаса', [['', '—'], ['X', 'Нет'], ['A', 'Автоматический'], ['M', 'Ручной']]],
    ['reactor', 'Шкаф реактора', [['', '—'], ['false', 'Нет'], ['true', 'Да']]],
    ['ip_required', 'Требуемая IP (число)'],
    ['ups', 'ИБП', [['', '—'], ['false', 'Нет'], ['true', 'Да']]],
    ['cable_entry', 'Ввод кабелей', [['', '—'], ['D', 'Снизу'], ['T', 'Сверху']]],
    ['protocol', 'Протокол', [['', '—'], ['MR', 'Modbus RTU'], ['MT', 'Modbus TCP'], ['PB', 'ProfibusDP'], ['PN', 'ProfiNet'], ['CO', 'CanOpen'], ['EI', 'Ethernet/IP']]],
    ['cell_bypass', 'Байпас ячеек', [['', '—'], ['false', 'Нет'], ['true', 'Да']]],
    ['sync_transfer', 'Синхронный перевод на сеть', [['', '—'], ['false', 'Нет'], ['true', 'Да']]],
    ['di_do_needed', 'Нужно DI/DO, шт'],
  ];
  function renderParams() {
    const p = state.params;
    $('paramGrid').innerHTML = P.map(([k, label, opts]) => {
      const v = p[k] == null ? '' : String(p[k]);
      const src = state.paramsSrc[k] ? '<span class="src">п. ' + esc(state.paramsSrc[k]) + '</span>' : '';
      const ctl = opts ? `<select data-k="${k}">${opts.map(([ov, ot]) => `<option value="${ov}"${ov === v ? ' selected' : ''}>${esc(ot)}</option>`).join('')}</select>`
        : `<input type="number" step="any" data-k="${k}" value="${esc(v)}">`;
      return `<div class="field"><label>${esc(label)}</label>${ctl}${src}</div>`;
    }).join('');
    $('paramGrid').querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.k; let v = el.value;
      if (v === '') v = null; else if (v === 'true') v = true; else if (v === 'false') v = false; else if (el.type === 'number' || ['voltage_kv', 'cells_per_phase'].includes(k)) v = Number(v);
      state.params[k] = v; runChecks(); renderRows(); updateConfig();
    }));
    const n = $('paramNotes'); const notes = state.params.notes;
    n.classList.toggle('hidden', !notes); n.textContent = notes ? 'Заметки: ' + notes : '';
  }

  function filmAllowed(v, kw) { return v === 10 ? kw <= 1250 : kw <= 710; }
  function configParams() {
    const p = state.params, q = new URLSearchParams();
    const v = Number(p.voltage_kv) >= 8 ? 10 : 6;
    let kw = Math.max(Number(p.motor_power_kw) || 0, Number(p.vfd_power_kw) || 0);
    let a = Math.max(Number(p.motor_current_a) || 0, Number(p.vfd_current_a) || 0);
    if (p.vfd_kva) a = Math.max(a, Math.ceil(Number(p.vfd_kva) / (Math.sqrt(3) * v)));
    q.set('from', 'tz'); q.set('v', v === 10 ? 'T100' : 'T060');
    if (kw) q.set('kw', String(kw)); if (a) q.set('a', String(a));
    q.set('cap', p.capacitors || 'auto');
    const cells = Number(p.cells_per_phase) || (v === 10 ? 8 : 5);
    q.set('puls', String({ 5: 30, 6: 36, 8: 48, 9: 54 }[cells] || (v === 10 ? 48 : 30)));
    q.set('mat', p.winding || 'AL');
    q.set('byp', p.bypass || 'X');
    q.set('react', p.reactor ? 'R' : 'X');
    q.set('ip', Number(p.ip_required) > 31 ? '42' : '31');
    const io = Number(p.di_do_needed) || 0;
    q.set('exp', io > 20 ? '2E' : io > 12 ? 'E' : 'X');
    q.set('ups', p.ups ? 'U' : 'X');
    q.set('cab', p.cable_entry || 'D');
    q.set('pr', p.protocol || 'MR');
    q.set('cb', p.cell_bypass ? 'B' : 'N');
    q.set('mot', p.motor_type || 'A');
    q.set('sync', p.sync_transfer ? 'B' : 'X');
    if (p.quantity) q.set('qty', String(p.quantity));
    const t = $('docTitle').value.trim(); if (t) q.set('tz', t.slice(0, 120));
    return { q, v, kw };
  }
  function updateConfig() {
    const { q, v, kw } = configParams();
    const url = CONFIGURATOR + '?' + q.toString();
    $('btnConfig').href = url;
    const p = state.params;
    $('skuMsg').textContent = (Number(p.voltage_kv) && ![6, 10].includes(Math.round(Number(p.voltage_kv))) ? 'Напряжение ' + p.voltage_kv + ' кВ: подобрано на ' + v + ' кВ — проверьте. ' : '') +
      (!kw && !Number(p.motor_current_a) ? 'Мощность и ток ЭД не найдены — выберите модель в конфигураторе вручную.' : '');
    const fr = $('cfgFrame');
    state.sku = '';
    $('sku').textContent = 'подбор…';
    fr.onload = () => {
      try { const d = fr.contentDocument; const sku = d.getElementById('result').textContent.trim(); state.sku = sku; $('sku').textContent = sku;
        const cap = d.getElementById('capacitorType').value; state.cap = cap; runChecks(); renderRows(); }
      catch (e) { $('sku').textContent = 'маркировку покажет конфигуратор'; }
    };
    fr.src = url + '&embed=1';
  }

  // ===== ПЕРЕПРОВЕРКА ЧИСЕЛ ПО ПРАВИЛАМ (код главнее модели, но не главнее человека) =====
  function codeVerdict(key, val, ctx) {
    const x = Number(String(val).replace(',', '.').replace('−', '-'));
    if (!isFinite(x)) return null;
    const pct = x <= 1 ? x * 100 : x;
    switch (key) {
      case 'power_factor': { const pf = x > 1 ? x / 100 : x; return pf > 0.95 ? ['DEV', 'коэффициент мощности 0,95 (П1)'] : ['OK']; }
      case 'speed_accuracy_pct': return x < 0.5 ? ['DEV', 'точность скорости 0,5% (П12)'] : ['OK'];
      case 'thdi_pct': case 'thdu_pct': return x < 5 ? ['DEV', 'гармоники не более 5% (П13)'] : ['OK'];
      case 'ip': return x > 42 ? ['DEV', 'только IP31/IP42 (П22)'] : ['OK'];
      case 'freq_tol_pct': return Math.abs(x) > 5 ? ['DEV', 'частота сети ±5%'] : ['OK'];
      case 'efficiency_pct': { const lim = ctx.cap === 'EL' ? 96 : 97; return pct > lim ? ['DEV', 'КПД ' + lim + '% (П32)'] : ['OK']; }
      case 'overload_120_s': return x > 60 ? ['DEV', 'перегрузка 120% — 60 с (П23)'] : ['OK'];
      case 'overload_150_s': return x > 3 ? ['DEV', 'перегрузка 150% — 3 с (П23)'] : ['OK'];
      case 'cable_m': return x > 1000 ? ['DEV', 'кабель до 1000 м (П7)'] : ['OK'];
      case 'storage_min_c': return x < -20 ? ['DEV', 'хранение от −20 °С (П8)'] : ['OK'];
      case 'storage_max_c': return x > 70 ? ['DEV', 'хранение до +70 °С (П8)'] : ['OK'];
      case 'ambient_min_c': return x < 0 ? ['DEV', 'эксплуатация от 0 °С'] : ['OK'];
      case 'ambient_max_c': return x > 40 ? ['DEV', 'эксплуатация до +40 °С'] : ['OK'];
      case 'humidity_pct': return x > 95 ? ['DEV', 'влажность до 95%'] : ['OK'];
      case 'altitude_m': return x > 1000 ? ['DEV', 'высота до 1000 м без снижения характеристик'] : ['OK'];
      case 'fout_max_hz': return x > 120 ? ['DEV', 'выходная частота до 120 Гц (П2)'] : ['OK'];
      case 'seismic_msk': return x > 9 ? ['DEV', 'сейсмостойкость 9 баллов'] : ['OK'];
      case 'noise_db': return x < 79 ? ['DEV', 'шум 79 дБ (П21)'] : ['OK'];
      case 'warranty_months_commissioning': return x > 24 ? ['CHECK', 'гарантия стандартно 24 мес. с ввода (П9)'] : ['OK'];
      case 'warranty_months_delivery': return x > 36 ? ['CHECK', 'гарантия стандартно 36 мес. с поставки (П9)'] : ['OK'];
      case 'mtbf_h': return x > 100000 ? ['DEV', 'наработка на отказ 100 000 ч (П10)'] : ['OK'];
      case 'overhaul_h': return x > 150000 ? ['DEV', 'ресурс до КР 150 000 ч (П10)'] : ['OK'];
      case 'recovery_min': return x < 30 ? ['DEV', 'восстановление 30 мин (П10)'] : ['OK'];
      case 'ups_min': return x > 120 ? ['DEV', 'ИБП до 2 ч'] : ['OK'];
      case 'panel_inch': return x > 10 ? ['OPT', 'панель 12" — опция (П16)'] : ['OK'];
      default: return null;
    }
  }
  function runChecks() {
    const v = Number(state.params && state.params.voltage_kv) >= 8 ? 10 : 6;
    const kw = Math.max(Number(state.params && state.params.motor_power_kw) || 0, Number(state.params && state.params.vfd_power_kw) || 0);
    const ctx = { cap: state.cap || (state.params && state.params.capacitors) || (filmAllowed(v, kw) ? 'PF' : 'EL') };
    for (const r of state.rows) {
      if (r.userSet) continue;
      r.status = r.modelStatus; r.auto = '';
      if (!(r.status in SEV)) continue;
      let worst = null;
      for (const c of r.check || []) {
        const res = c && codeVerdict(c.key, c.value, ctx);
        if (res && res[0] !== 'OK' && (!worst || SEV[res[0]] > SEV[worst[0]])) worst = res;
      }
      if (worst && SEV[worst[0]] > SEV[r.status]) { r.status = worst[0]; r.auto = 'Проверка по числам: ' + worst[1]; }
    }
  }

  // ===== ТАБЛИЦА ТРЕБОВАНИЙ =====
  function counts() { const c = {}; ST_ORDER.forEach(s => c[s] = 0); state.rows.forEach(r => c[r.status]++); return c; }
  function renderChips() {
    const c = counts();
    $('chips').innerHTML = `<span class="chip${state.filter ? '' : ' on'}" data-f="">Все<b>${state.rows.length}</b></span>` +
      ST_ORDER.map(s => `<span class="chip s-${s}${state.filter === s ? ' on' : ''}" data-f="${s}">${ST[s]}<b>${c[s]}</b></span>`).join('');
    $('chips').querySelectorAll('.chip').forEach(ch => ch.onclick = () => { state.filter = ch.dataset.f || null; renderRows(); });
  }
  function renderRows() {
    renderChips();
    const opts = s => ST_ORDER.map(k => `<option value="${k}"${k === s ? ' selected' : ''}>${ST[k]}</option>`).join('');
    $('reqBody').innerHTML = state.rows.map((r, i) => (state.filter && r.status !== state.filter) ? '' : `
      <tr class="s-${r.status}" data-i="${i}">
        <td data-l="№">${i + 1}</td>
        <td class="c" data-l="Пункт ТЗ"><textarea data-f="clause" rows="1" style="min-height:30px;width:70px">${esc(r.clause)}</textarea></td>
        <td data-l="Требование ТЗ"><textarea data-f="requirement">${esc(r.requirement)}</textarea>${r.comment ? `<span class="inner" title="Внутренний комментарий — заказчик его не видит">${esc(r.comment)}</span>` : ''}</td>
        <td data-l="Предложение ESQ"><textarea data-f="proposal">${esc(r.proposal)}</textarea></td>
        <td data-l="Статус"><select data-f="status">${opts(r.status)}</select>${r.rule ? `<span class="rule">${esc(r.rule)}</span>` : ''}${r.auto ? `<span class="auto">${esc(r.auto)}</span>` : ''}${r.userSet ? '<span class="rule">изменено вручную</span>' : ''}</td>
        <td data-l="Примечание для заказчика"><textarea data-f="client">${esc(r.client)}</textarea></td>
      </tr>`).join('');
    $('reqBody').querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', () => {
      const r = state.rows[+el.closest('tr').dataset.i], f = el.dataset.f;
      r[f] = el.value;
      if (f === 'status') { r.userSet = true; r.auto = ''; renderRows(); }
    }));
  }
  $('btnAddRow').onclick = () => { state.rows.push({ clause: '', requirement: '', proposal: '', comment: '', client: '', rule: '', modelStatus: 'DEV', status: 'DEV', check: [], userSet: true, auto: '' }); state.filter = null; renderRows(); };

  // ===== ДОКУМЕНТЫ (.docx) =====
  function meta() {
    const { q } = configParams();
    return {
      title: $('docTitle').value.trim(), customer: $('docCustomer').value.trim(), object: $('docObject').value.trim(),
      sku: state.sku, qty: q.get('qty') || '1', author: $('author').value.trim(),
      extras: $('extraPos').value.split('\n').map(s => s.trim()).filter(Boolean),
    };
  }
  function dateRu() { return new Date().toLocaleDateString('ru-RU'); }

  function buildDocx(kindDoc, includeCheck) {
    const D = window.docx; if (!D) throw new Error('Библиотека docx не загрузилась — проверьте интернет');
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation, BorderStyle, ShadingType, VerticalAlign } = D;
    const m = meta();
    const FONT = 'Arial';
    const W = 14570;   // ширина поля A4 альбом при полях 2 см
    const run = (t, o) => new TextRun(Object.assign({ text: String(t == null ? '' : t), font: FONT, size: 20 }, o || {}));
    const para = (t, o, ro) => new Paragraph(Object.assign({ spacing: { after: 80 }, children: Array.isArray(t) ? t : [run(t, ro)] }, o || {}));
    const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (t, w, o) => new TableCell({
      width: { size: w, type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.TOP,
      shading: o && o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: String(t == null ? '' : t).split('\n').map(line => new Paragraph({ alignment: o && o.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [run(line, { bold: !!(o && o.bold), size: o && o.size || 18 })] })),
    });
    const table = (cols, rows) => new Table({
      width: { size: W, type: WidthType.DXA }, columnWidths: cols.map(c => c[1]),
      rows: [new TableRow({ tableHeader: true, children: cols.map(c => cell(c[0], c[1], { bold: true, fill: 'D9E1F2', center: true })) })]
        .concat(rows.map((r, i) => new TableRow({ cantSplit: true, children: cols.map((c, j) => cell(j === 0 ? i + 1 : r[j - 1], c[1], { center: j < 2 })) }))),
    });
    const children = [];
    const isDev = kindDoc === 'dev';
    children.push(para(isDev ? 'ЛИСТ НЕСООТВЕТСТВИЙ' : 'ЛИСТ СООТВЕТСТВИЯ ТРЕБОВАНИЯМ ТЗ', { alignment: AlignmentType.CENTER, spacing: { after: 60 } }, { bold: true, size: 28 }));
    if (m.title) children.push(para((isDev ? 'к техническому заданию: ' : '') + m.title, { alignment: AlignmentType.CENTER, spacing: { after: 200 } }, { size: 20 }));
    const info = [['Заказчик', m.customer], ['Объект', m.object],
      ['Оборудование', 'Высоковольтный преобразователь частоты ' + (m.sku || 'ESQ F ME800') + ', ' + m.qty + ' шт.'],
      ['Изготовитель', 'Shanghai Sigriner STEP Electric Co., Ltd (Китай)'], ['Поставщик', 'ООО «Элком»']];
    info.filter(x => x[1]).forEach(([k, v]) => children.push(para([run(k + ': ', { bold: true }), run(v)])));

    const rowsOf = s => state.rows.filter(r => r.status === s && (r.requirement || r.proposal));
    const c5 = [['№', 600], ['Пункт ТЗ', 1300], ['Требование ТЗ', 5000], ['Предлагаемый вариант', 4170], ['Примечание', 3500]];
    const asRow = r => [r.clause, r.requirement, r.proposal, r.client];
    let sec = 0;
    const section = (title, rows, empty) => {
      children.push(para(++sec + '. ' + title, { spacing: { before: 240, after: 120 } }, { bold: true, size: 22 }));
      if (rows.length) children.push(table(c5, rows.map(asRow))); else children.push(para(empty || '—'));
    };
    if (isDev) {
      section('Отклонения от требований ТЗ', rowsOf('DEV'), 'Отклонений от требований ТЗ нет.');
      if (includeCheck && rowsOf('CHECK').length) section('Требования, подлежащие уточнению', rowsOf('CHECK'));
      if ($('incOpt').checked) {
        const optRows = rowsOf('OPT');
        if (optRows.length || m.extras.length) {
          section('Требования, выполняемые опциями и отдельными позициями поставки', optRows);
          if (m.extras.length) { children.push(para('Отдельные позиции ТКП:', { spacing: { before: 120 } }, { bold: true }));
            m.extras.forEach(e => children.push(para('• ' + e))); }
        }
      }
      children.push(para('Остальные требования технического задания выполняются. Договорные условия (документация, услуги, ЗИП, испытания, сроки, гарантия) — согласно ТКП и договору поставки.', { spacing: { before: 240 } }));
    } else {
      const c6 = [['№', 600], ['Пункт ТЗ', 1200], ['Требование ТЗ', 4600], ['Предложение ESQ F ME800', 3800], ['Статус', 1500], ['Примечание', 2870]];
      const all = state.rows.filter(r => r.requirement || r.proposal);
      const fill = { OK: 'E2F0D9', OPT: 'DDEBF7', DEV: 'F8CBAD', CHECK: 'FFF2CC', CTR: 'EDEDED', NA: 'F7F7F7' };
      children.push(new Table({
        width: { size: W, type: WidthType.DXA }, columnWidths: c6.map(c => c[1]),
        rows: [new TableRow({ tableHeader: true, children: c6.map(c => cell(c[0], c[1], { bold: true, fill: 'D9E1F2', center: true })) })]
          .concat(all.map((r, i) => new TableRow({ cantSplit: true, children: [
            cell(i + 1, 600, { center: true }), cell(r.clause, 1200, { center: true }), cell(r.requirement, 4600), cell(r.proposal, 3800),
            cell(ST[r.status], 1500, { fill: fill[r.status], center: true }), cell(r.client, 2870)] }))),
      }));
      if (m.extras.length) { children.push(para('Отдельные позиции ТКП:', { spacing: { before: 200 } }, { bold: true })); m.extras.forEach(e => children.push(para('• ' + e))); }
    }
    children.push(para([run('Составил: ', { bold: true }), run((m.author || '____________________') + '          Дата: ' + dateRu())], { spacing: { before: 360 } }));
    children.push(para('Подпись: ____________________'));

    const doc = new Document({
      creator: 'ООО «Элком»', title: isDev ? 'Лист несоответствий' : 'Лист соответствия',
      styles: { default: { document: { run: { font: FONT, size: 20 } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1000, bottom: 1000, left: 1134, right: 1134 } } }, children }],
    });
    return Packer.toBlob(doc);
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  const baseName = () => (($('docTitle').value.trim() || 'ТЗ').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)).trim();

  $('btnDev').onclick = async () => {
    const m = $('outMsg'); m.className = 'msg';
    const nCheck = state.rows.filter(r => r.status === 'CHECK').length;
    let inc = false;
    if (nCheck) {
      inc = confirm('Осталось пунктов «Проверить»: ' + nCheck + '.\nЛучше решить их в таблице (Соответствует / Отклонение / …).\n\nOK — всё равно выгрузить, включив их разделом «Требования, подлежащие уточнению».\nОтмена — вернуться к таблице.');
      if (!inc) { state.filter = 'CHECK'; renderRows(); $('secReq').scrollIntoView({ behavior: 'smooth' }); return; }
    }
    try { download(await buildDocx('dev', inc), 'Лист несоответствий — ' + baseName() + '.docx'); m.className = 'msg ok'; m.textContent = 'Лист несоответствий сформирован'; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  };
  $('btnFull').onclick = async () => {
    try { download(await buildDocx('full'), 'Лист соответствия — ' + baseName() + '.docx'); }
    catch (e) { $('outMsg').className = 'msg err'; $('outMsg').textContent = e.message; }
  };

  // ===== СОХРАНЕНИЕ / ЗАГРУЗКА РАЗБОРА =====
  $('btnSave').onclick = () => {
    const data = {
      _format: 'esq-tz-1', _saved: new Date().toISOString(), _model: state.model,
      document: { title: $('docTitle').value, customer: $('docCustomer').value, object: $('docObject').value },
      params: state.params, params_src: state.paramsSrc,
      requirements: state.rows.map(r => ({ clause: r.clause, requirement: r.requirement, proposal: r.proposal, status: r.status, modelStatus: r.modelStatus, rule: r.rule, comment: r.comment, client_note: r.client, check: r.check, userSet: r.userSet })),
      extra_positions: $('extraPos').value.split('\n').map(s => s.trim()).filter(Boolean),
      _ui: { author: $('author').value }, _text: $('tzText').value,
    };
    download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'Разбор — ' + baseName() + '.json');
  };
  $('loadJson').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d._text) { $('tzText').value = d._text; $('textBox').classList.remove('hidden'); updateTextStat(); updateAnalyzeBtn(); }
      loadResult(d);
    } catch (err) { $('readMsg').className = 'msg err'; $('readMsg').textContent = 'Не удалось открыть разбор: ' + err.message; }
  };

  // для тестов
  window.__tz = { state, loadResult, readDocx, readXlsx, readPdf, codeVerdict, buildDocx, configParams };
})();
