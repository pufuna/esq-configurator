/* Генератор ТКП для конфигуратора УПП ESQ F HVS — в оформлении нового ТКП на ПЧ.

   Листы берутся из assets/upp/shell.pdf (собирается tools/build_upp_shell.js):
     0 обложка, 1 письмо, 2 содержание, 3 предложение, 4 лист с заголовком, 5 пустой лист, 6 лист-чертёж с рамкой и штампом,
     7 «Наши клиенты» — из шаблона ТКП на ПЧ; 8–16 — исходные листы (эскиз E, техописание, рисунки ПЧ, чертежи из DWG), из них вырезаются (вектором) чертежи.
   Однолинейные схемы и рис. 1, 3 рисуются кодом (drawScheme, figLift, figInstall).
   Всё, что относится к УПП, дописывается здесь шрифтом Inter (контуры из assets/upp/glyphs.json: L, R, S),
   поэтому текст выглядит как в ТКП на ПЧ. ISOCPEUR (iso) — только для правок надписей внутри старых схем.
   Ненужное содержимое листов-заготовок не закрывается белым, а вырезается отсечением (маски).

   Координаты — pt от левого верхнего угла листа «как его видит человек». */
(function () {
  'use strict';
  const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rectangle, clipEvenOdd, endPath } = window.PDFLib;
  const WHITE = rgb(1, 1, 1), DARK = rgb(35 / 255, 31 / 255, 33 / 255), TEAL = rgb(10 / 255, 105 / 255, 114 / 255),
    ORANGE = rgb(242 / 255, 105 / 255, 40 / 255), LINE = rgb(12 / 255, 106 / 255, 115 / 255), BAND = rgb(.0392, .412, .447),
    HEAD = rgb(212 / 255, 212 / 255, 212 / 255), TEAL5 = rgb(3 / 255, 91 / 255, 110 / 255), OR5 = rgb(243 / 255, 95 / 255, 39 / 255),
    PALE = rgb(.92, .955, .96);
  const money = x => { const [a, b] = x.toFixed(2).replace(/\.00$/, '').split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (b ? ',' + b : ''); };
  const PKG = { STD: 'стандартная', E: 'с вакуумным выключателем', S: 'с выкатными тиристорными блоками', IK: 'с вводным разъединителем' };
  const PROTO = { MR: 'Modbus RTU', MT: 'Modbus TCP', PB: 'Profibus DP', PN: 'ProfiNet', CO: 'CANopen', EI: 'EtherNet/IP' };
  const IFACE = { MT: 'Ethernet', PN: 'Ethernet', EI: 'Ethernet', CO: 'CAN', PB: 'RS-485 (Profibus)' };
  const CTL = { AC220: 'AC 220 В ±15%', DC220: 'DC 220 В ±15%' };
  const SH = { cover: 0, letter: 1, contents: 2, offer: 3, titled: 4, plain: 5, frame: 6, clients: 7, oDraw: 8, oScheme: 9, tdConn: 10, tdInst: 11, lift: 12, fork: 13, gabSTD1000: 14, gabSTD1200: 15, gabIK: 16 };
  // рамка листов с заголовком / пустых (скруглённая) и зона текста в ней
  const FR = { x0: 45.5, x1: 567, top: 82.5, bot: 741.5 }, TX0 = 58.6, TX1 = 554;

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
    const slots = new Map();
    const slot = p => {
      if (slots.has(p)) return slots.get(p);
      p.node.normalize();
      const arr = p.node.Contents();
      const pre = doc.context.register(doc.context.stream(' ')), post = doc.context.register(doc.context.stream(' '));
      arr.insert(0, pre); arr.push(post);
      const sl = { p, pre, post, zones: [] }; slots.set(p, sl); return sl;
    };
    pages.forEach(slot);
    return {
      add(p, x0, y0, x1, y1) { slot(p).zones.push([x0, y0, x1, y1]); },
      apply() {
        for (const sl of slots.values()) {
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

  /* ================= Содержимое, общее для всех комплектаций ================= */
  const DESC_PARAS = [
    'Высоковольтные устройства плавного пуска (УПП) серии ESQ F HVS предназначены для плавного безударного пуска высоковольтных асинхронных и синхронных электродвигателей во всех областях применения, где не требуется регулирование скорости вращения.',
    'Устройство широко применяется в производстве стройматериалов, химической промышленности, металлургии, сталелитейной и бумажной промышленности и т.д.',
    'Может использоваться на разных нагрузках — включая насосы, вентиляторы, компрессоры, дробилки, мешалки, конвейерные ленты и т.д.'];
  const DESC_ALLOW = [
    'Осуществлять плавное нарастание и снижение напряжения в течение заданного времени при пуске и останове двигателя с контролем тока и момента.',
    'Значительно уменьшить пусковые токи двигателей.',
    'В сетях с ограниченной мощностью короткого замыкания резко уменьшить провалы напряжения сети при пуске двигателей.',
    'Существенно снизить при пуске электродинамические усилия на обмотки двигателя и ударные механические воздействия на механизмы.'];
  const DESC_IS = [
    ['Простота установки и эксплуатации', ' — готовая система управления пуском и защиты двигателя: для работы достаточно подключить питающий и моторный кабели.'],
    ['Встроенный вакуумный байпасный контактор', ' — не требуется дополнительный шкаф для переключения двигателя на сеть после разгона.'],
    ['Аварийный прямой пуск', ' — при неисправности УПП вакуумный контактор может выполнить прямой пуск двигателя, чтобы обеспечить непрерывность производства.'],
    ['Интерфейс RS-485 и протокол Modbus RTU', ' в стандартной комплектации, возможность добавить другие протоколы передачи данных для интеграции в систему управления.'],
    ['Самодиагностика', ' при подаче питания, журнал аварий и счётчик количества пусков.'],
    ['Большой набор защитных функций', ' и электромагнитная блокировка дверей высоковольтной части.'],
    ['Встроенная система обогрева шкафа', ' — поддержание рабочей температуры в холодный период.']];
  const DESC_TAIL = [
    'Основным управляющим элементом системы является микропроцессор, который управляет открытием силовых тиристоров для снижения напряжения на двигателе, а затем плавно увеличивает напряжение и ток двигателя, повышая его крутящий момент, пока двигатель не разгонится до номинальных оборотов. Это снижает пусковой ток, нагрузку на сеть и на сам двигатель, а также механическую нагрузку на приводные механизмы.',
    'После разгона двигателя до номинальной скорости выходное реле УПП замыкает высоковольтный вакуумный байпасный контактор, и двигатель работает непосредственно от сети — без тепловых потерь на тиристорах.'];
  const WARRANTY = 'Гарантийный срок на устройство плавного пуска составляет 24 месяца со дня начала эксплуатации при условии гарантийной наработки 10 000 ч., но не более 36 месяцев с даты продажи при условии соблюдения Покупателем правил эксплуатации изделия, изложенных в инструкции по эксплуатации. Информация о ценах, содержащихся в данном документе, является конфиденциальной и действительна только при заказе оборудования и услуг. Данное предложение носит информационный характер и не является публичной офертой (согласно ст. 435 ГК РФ).';

  function extrasList(s) {
    const L = [];
    if (s.pkg === 'E') L.push(['Исполнение с вакуумным выключателем', ' — встроенный вводной вакуумный выключатель: включение и отключение питания, защита и измерения на стороне сети; однолинейная схема — п. 2.1.']);
    if (s.pkg === 'S') L.push(['Выкатные тиристорные блоки', ' — быстрая замена силовых модулей при обслуживании.']);
    if (s.pkg === 'IK') L.push(['Вводной разъединитель', ' в составе УПП — видимый разрыв цепи питания при обслуживании; однолинейная схема — п. 2.1.']);
    if (s.ctl === 'DC220') L.push(['Питание цепей управления', ' от сети постоянного тока =220 В ±15%.']);
    if (s.ip !== 'IP40') L.push(['Степень защиты ' + s.ip, ' (стандарт — IP40).']);
    if (s.proto !== 'MR') L.push(['Протокол связи ' + PROTO[s.proto], ' — дополнительно к Modbus RTU (RS-485).']);
    const more = [];
    if (s.motor === 'S') more.push('пуск синхронного двигателя');
    if (s.cable === 'T') more.push('ввод и вывод кабелей сверху');
    if (s.srv === '1') more.push('одностороннее обслуживание');
    if (more.length === 1) L.push([more[0][0].toUpperCase() + more[0].slice(1), '.']);
    else if (more.length) L.push(['Также', ': ' + more.join('; ') + '.']);
    return L;
  }

  /* Строки таблицы характеристик: [параметр, значение | [значения]] или ['§', заголовок раздела] */
  function techRows(s) {
    const pr = s.proto === 'MR' ? 'Modbus RTU' : 'Modbus RTU; ' + PROTO[s.proto];
    return [
      ['Наименование', s.mark],
      ['Мощность двигателя', s.P + ' кВт'],
      ['Номинальный ток', s.I + ' А'],
      ['Номинальное напряжение сети', (s.kv === 10 ? '10000' : '6000') + ' В ±15%'],
      ['Частота сети', '50/60 Гц ±2 Гц'],
      ['Тип нагрузки', s.motor === 'S' ? 'Трёхфазный синхронный двигатель' : 'Трёхфазный асинхронный двигатель с короткозамкнутым ротором'],
      ['Комплектация', PKG[s.pkg][0].toUpperCase() + PKG[s.pkg].slice(1)],
      ['Последовательность фаз', 'Любая (контроль чередования включается параметром)'],
      ['Силовая цепь', 'Последовательно-параллельно включённые тиристоры (12, 18, 24 или 30 шт. в зависимости от модели и напряжения)'],
      ['Байпасный контактор', 'Встроенный вакуумный, с возможностью прямого пуска'],
      ['Питание цепей управления', CTL[s.ctl] || CTL.AC220],
      ['Защита от перенапряжений', 'Снабберные RC-цепи dU/dt'],
      ['Пусковой ток', '1,5–5,0 Ie (уставка ограничения тока 100–500% Ie)'],
      ['Режимы пуска', ['Линейное или ускоренное изменение напряжения, ограничение тока, пуск с постоянным напряжением (30–80% Ue, 0–30 с)',
        'Скачок напряжения (Kickstart): 20–100% Ue, 0–5 с']],
      ['Режимы останова', 'Выбегом; плавный останов 0–60 с до 20–60% Ue'],
      ['Частота пусков', '1–6 пусков в час с интервалом не менее 10 мин (в зависимости от мощности и условий пуска)'],
      ['Охлаждение', 'Естественное воздушное'],
      ['Тепловыделение', ['При пуске — 0,8–1% мощности УПП', 'После пуска (байпас) — 300–500 Вт']],
      ['§', 'Функции защиты'],
      ['Обрыв фазы', 'Обрыв любой фазы питания при пуске или в работе'],
      ['Перегрузка по току в работе', '100–500% Ie, задержка 0–10 с'],
      ['Небаланс тока фаз', '20–100%, задержка 0–10 с'],
      ['Тепловая перегрузка', 'Классы 10A, 10, 20, 30 или выкл.; тепловая модель сохраняется при отключении питания'],
      ['Недогрузка', '50–100% Ie, задержка 0–10 с'],
      ['Заклинивание ротора', '5–10 Ie'],
      ['Затянутый пуск', '10–120 с'],
      ['Повышенное напряжение', 'Срабатывание при 120% Ue'],
      ['Пониженное напряжение', 'Срабатывание при 70% Ue'],
      ['Чередование фаз', 'Контроль включается / отключается параметром'],
      ['Замыкание на землю', 'Срабатывание при превышении тока утечки заданного значения'],
      ['Защита тиристоров', 'КЗ тиристоров, самоподжиг (BOD), RC-цепи и выравнивание напряжения'],
      ['§', 'Управление и связь'],
      ['Режимы управления', 'Местный (панель), дистанционный (сухие контакты), от АСУ ТП, по интерфейсу связи'],
      ['Протокол передачи данных', pr],
      ['Интерфейс связи', s.proto === 'MR' || !IFACE[s.proto] ? 'RS-485' : 'RS-485; ' + IFACE[s.proto]],
      ['Подключение к сети', 'До 32 устройств в одной линии (адреса 1–32)'],
      ['Дискретные входы', 'Пуск, стоп, внешняя авария, готовность, пуск/стоп от АСУ ТП'],
      ['Релейные выходы', 'Готовность, работа, останов, авария, байпас, аварийное отключение вышестоящего выключателя'],
      ['Аналоговый выход', '4–20 мА, пропорционально среднему току (0–2 Ie или 0–4 Ie)'],
      ['Пульт управления', 'Сенсорный ЖК-дисплей; языки: русский, английский'],
      ['Индикация', 'Трёхфазное напряжение сети и трёхфазный ток главной цепи'],
      ['Журнал аварий', 'Последние 1000 аварийных сообщений'],
      ['Счётчики', 'Количество пусков, наработка'],
      ['§', 'Условия эксплуатации'],
      ['Место установки', 'В помещении; без прямых солнечных лучей, токопроводящей пыли, агрессивных и горючих газов, масляного и соляного тумана, капель воды'],
      ['Температура окружающей среды', 'От −20 °С до +50 °С'],
      ['Относительная влажность', '5–95%, без образования конденсата'],
      ['Высота над уровнем моря', 'До 1500 м (выше — со снижением номинальных характеристик)'],
      ['Степень защиты', s.ip],
      ['Габариты (Ш×Г×В)', s.dims ? s.dims + ' мм' : ''],
      ['Масса', s.massKg + ' кг'],
      ['Вид обслуживания', s.srv === '1' ? 'Одностороннее' : 'Двухстороннее'],
      ['Ввод и вывод кабелей', s.cable === 'T' ? 'Сверху' : 'Снизу']
    ];
  }

  async function generate(ev) {
    if (ev) ev.preventDefault();
    const btn = ev && ev.currentTarget; if (btn) btn.style.opacity = .6;
    try {
      const s = window.uppState();
      const get = u => fetch(u).then(r => { if (!r.ok) throw new Error('Не найден файл ' + u); return r; });
      const [shellBuf, GL] = await Promise.all([get('assets/upp/shell.pdf').then(r => r.arrayBuffer()), get('assets/upp/glyphs.json').then(r => r.json())]);
      const shell = await PDFDocument.load(shellBuf);
      const F = makeFonts(GL);
      if (!F.L || !F.R || !F.S) throw new Error('в assets/upp/glyphs.json нет шрифта Inter (L, R, S) — пересоберите его: node tools/build_upp_shell.js');

      /* ---------- текстовые помощники ---------- */
      const W = (str, f, size) => F[f].width(String(str), size);
      const putOn = (p, str, vx, vy, size, o = {}) => {
        str = String(str); if (!str) return 0;
        const f = F[o.f || 'L'], w0 = f.width(str, size);
        let hs = 1; if (o.maxW && w0 > o.maxW) hs = o.maxW / w0;
        const w = w0 * hs, r = p.getRotation().angle, H = p.getHeight(), th = r * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
        const off = o.a === 'c' ? -w / 2 : o.a === 'r' ? -w : 0;
        let ux = r === 90 ? vy : vx, uy = r === 90 ? vx : H - vy;
        ux += off * cs; uy += off * sn;
        p.pushOperators(pushGraphicsState(), concatTransformationMatrix(cs * hs, sn * hs, -sn, cs, ux, uy));
        p.drawSvgPath(f.path(str), { x: 0, y: 0, scale: size / f.upm, color: o.c || DARK, borderWidth: 0 });
        p.pushOperators(popGraphicsState());
        return w;
      };
      const wrap = (str, f, size, maxW) => {
        const out = []; let cur = '';
        for (const w of String(str).split(' ')) { const t = cur ? cur + ' ' + w : w; if (W(t, f, size) > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
        out.push(cur); return out;
      };
      /* абзац с выравниванием по ширине; top — верх строки; возвращает низ абзаца */
      const para = (p, x0, x1, top, str, o = {}) => {
        const f = o.f || 'L', size = o.size || 9.4, lead = o.lead || size * 1.37, ind = o.indent || 0, c = o.c || DARK;
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
            let xx = xs; for (const w of ln) { if (p) putOn(p, w, xx, y, size, { f, c }); xx += W(w, f, size) + gap; }
          } else if (p) putOn(p, ln.join(' '), xs, y, size, { f, c });
          y += lead;
        });
        return y - lead + size * .3;
      };

      /* ---------- план листов ---------- */
      const rows = techRows(s);
      const tPages = layoutTable(rows, null, W, wrap).pages;     // сколько листов займёт таблица
      const plan = [['cover'], ['letter'], ['contents'], ['offer'], ['titled', 'desc'], ['plain', 'decode'],
        ['frame', 'scheme'], ['frame', 'conn'], ['frame', 'draw']];
      for (let i = 0; i < tPages; i++) plan.push([i ? 'plain' : 'titled', 'tech' + i]);
      plan.push(['titled', 'tr1'], ['plain', 'tr2'], ['titled', 'srv'], ['clients']);
      const at = key => plan.findIndex(x => x[1] === key || x[0] === key);

      const doc = await PDFDocument.create();
      const copied = await doc.copyPages(shell, plan.map(x => SH[x[0]]));
      copied.forEach(p => doc.addPage(p));
      const pg = doc.getPages();
      const M = prepareMasks(doc, pg);
      const put = (i, ...a) => putOn(pg[i], ...a);

      /* номера листов в шапке (у листов из шаблона ПЧ они свои) */
      plan.forEach(([kind], i) => {
        if (['titled', 'plain'].includes(kind)) { M.add(pg[i], 532, 44.5, 562, 60); put(i, String(i), 535.0, 57.0, 12.7, { f: 'R', c: TEAL }); }
        else if (kind === 'frame') { M.add(pg[i], 535, 44.6, 549.8, 55.4); put(i, String(i), 542.4, 53.75, 10.65, { f: 'R', c: TEAL, a: 'c' }); }
        else if (kind === 'clients') { M.add(pg[i], 532, 42, 562, 57.5); put(i, String(i), 535.0, 54.5, 12.7, { f: 'R', c: TEAL }); }
      });
      const title = (i, str) => {                                   // оранжевый заголовок раздела на листе с заголовком
        M.add(pg[i], 52, 104, 562, 130.5); put(i, str, TX0, 122, 13, { f: 'S', c: ORANGE, maxW: TX1 - TX0 });
      };
      const frameTitle = (i, str) => { M.add(pg[i], 84, 127, 520, 150); put(i, str, 302.2, 144.25, 14.8, { f: 'R', c: TEAL, a: 'c', maxW: 420 }); };
      const stamp = i => put(i, s.mark, 348.75, 713.0, 9, { f: 'R', a: 'c', maxW: 296 });

      /* ---------- обложка ---------- */
      pg[0].drawRectangle({ x: 36, y: pg[0].getHeight() - 708, width: 300, height: 26, color: BAND, borderWidth: 0 });   // «Преобразователь частоты» — на цветной плашке
      put(0, 'Устройство плавного пуска', 39.2, 699.8, 20, { f: 'R', c: WHITE });
      put(0, s.mark, 38.6, 727.5, 15.5, { f: 'R', c: WHITE, maxW: 518 });
      if (s.who) put(0, s.who, 37.6 + W('Составил:', 'R', 12.5) + 7, 758.7, 12.5, { f: 'R', c: WHITE, maxW: 330 });
      put(0, new Date().toLocaleDateString('ru-RU'), 443.5 + W('ДАТА:', 'R', 12.5) + 6, 758.7, 12.5, { f: 'R', c: WHITE });
      try {
        const png = await doc.embedPng(await get('assets/upp/cover_upp.png').then(r => r.arrayBuffer()));
        M.add(pg[0], 20, 194.2, 279, 513.6);                                   // фото шкафа ПЧ из шаблона
        const h = 300, w = h * png.width / png.height;
        pg[0].drawImage(png, { x: 149.5 - w / 2, y: pg[0].getHeight() - 202 - h, width: w, height: h });
      } catch (e) { console.warn('Фото УПП для обложки не найдено', e); }

      /* ---------- содержание ---------- */
      M.add(pg[2], 60, 158, 553, 600);
      const toc = [['1. Технико-коммерческое предложение', at('offer')], ['2. Описание устройства плавного пуска', at('desc')],
        ['2.1 Однолинейная схема', at('scheme')], ['2.2 Схема внешних подключений', at('conn')], ['2.3 Габаритный эскиз', at('draw')],
        ['3. Основные технические характеристики предлагаемого оборудования', at('tech0')], ['4. Транспортировка и хранение', at('tr1')],
        ['5. Условия эксплуатации', at('tr2')], ['6. Техническое обслуживание', at('srv')], ['7. Наши клиенты', at('clients')]];
      toc.forEach(([t, n], k) => {
        const y = 174.0 + k * 28.95, num = String(n), nw = W(num, 'L', 9.6), tw = put(2, t, 74, y, 9.6);
        const x0 = 74 + tw + 4, x1 = 535 - nw - 4, dw = W('.', 'L', 9.6), cnt = Math.max(0, Math.floor((x1 - x0) / dw));
        put(2, '.'.repeat(cnt), x1 - cnt * dw, y, 9.6);
        put(2, num, 535, y, 9.6, { a: 'r' });
      });

      /* ---------- предложение ---------- */
      wrap(s.name, 'L', 9.6, 240).forEach((l, i) => put(3, l, 102.4, 162.5 + i * 12.3, 9.6));
      put(3, s.qty + ' шт', 375.85, 243, 10.2, { a: 'c' });
      if (s.price) put(3, money(s.price), 470.9, 243, 10.2, { a: 'c' });
      put(3, 'Всего позиций: 1, на сумму ' + (s.price ? money(s.price * s.qty) : '______________') + ' рублей, включая НДС 22 %', 58.6, 361.5, 10.6);
      M.add(pg[3], 55, 369, 553, 482);                                          // гарантия — про преобразователь (рамка листа — x 557,9)
      para(pg[3], 58.6, 537, 373.4, WARRANTY, { size: 9.6, lead: 15.5 });

      /* ---------- описание ---------- */
      const iDesc = at('desc');
      title(iDesc, '2. Описание устройства плавного пуска');
      drawDescription(pg[iDesc], s, para, putOn, W);

      /* ---------- расшифровка обозначения и модельный ряд ---------- */
      drawDecode(pg[at('decode')], s, putOn, W, wrap);

      /* ---------- листы-чертежи ---------- */
      const iS = at('scheme'), iC = at('conn'), iD = at('draw');
      frameTitle(iS, '2.1 Однолинейная схема'); frameTitle(iC, '2.2 Схема внешних подключений'); frameTitle(iD, '2.3 Габаритный эскиз');
      [iS, iC, iD].forEach(stamp);
      const ZONE = [92, 160, 512, 684];
      // однолинейная схема — рисуется кодом по исполнению (стандарт/S, E, IK)
      { const gs = makeG(pg[iS], putOn, 302 - 217.5 * 1.1, 172, 1.1); gs.setW(W); drawScheme(gs, s); }
      // схема внешних подключений — из технического описания ESQ F HVS (рис. 9)
      // при питании =220 В подпись «Питание AC 220 В (L, N)» на схеме заменяется
      const dc = s.ctl === 'DC220';
      const mc = await placeCrop(doc, shell.getPage(SH.tdConn), [50, 214, 384, 488], pg[iC], ZONE,
        { max: 1.3, holes: [[300, 290, 340.6, 326]].concat(dc ? [[80, 345, 148, 354.5]] : []) });
      { // к двигателю приходят три провода U, V, W (на рисунке техописания они сходились в один)
        const o = mc(0, 0), gc = makeG(pg[iC], putOn, o[0], o[1], mc.k), cx = 352.8, cy = 308.7, R = 12.6;
        [[296.2, -30], [308.3, 0], [320.3, 30]].forEach(([yy, a]) => {
          const ex = cx - R * Math.cos(a * Math.PI / 180), ey = cy + R * Math.sin(a * Math.PI / 180);
          gc.poly([[299, yy], [a ? ex - 9 : ex, yy], [ex, ey]], { open: true, w: 1.2, c: DARK });
        });
      }
      if (dc) { const q = mc(147.0, 351.6); putOn(pg[iC], 'Питание DC 220 В (+, −)', q[0], q[1], 5.6 * mc.k, { f: 'L', a: 'r' }); }
      // габаритный эскиз по исполнению: стандарт и S — шкаф 1000 или 1200, E — свой, IK — свой; нет чертежа — лист пустой, как у ПЧ
      if (s.drawing) {
        let yb;
        if (s.drawing === 'E') {
          const m2 = await placeCrop(doc, shell.getPage(SH.oDraw), [93, 200, 518, 512], pg[iD], [92, 170, 512, 600], { max: 1.0 });
          yb = m2(0, 512)[1] + 34;
        } else {
          // листы из DWG широкие: виды спереди и сбоку — верхним рядом, вид сверху — под ними (так чертёж крупнее)
          const VIEWS = { STD1000: [[25, 0, 332, 218], [363, 30, 539, 148]], STD1200: [[2, 0, 342, 210], [359, 32, 540, 168]], IK: [[2, 0, 349, 214], [393, 12, 543, 137]] };
          const sp = shell.getPage(SH['gab' + s.drawing]), [r1, r2] = VIEWS[s.drawing];
          const h1 = r1[3] - r1[1], h2 = r2[3] - r2[1], GAP = 26;
          const k = Math.min(420 / (r1[2] - r1[0]), 420 / (r2[2] - r2[0]), (400 - GAP) / (h1 + h2), 1.4);
          const top = 175;
          await placeCrop(doc, sp, r1, pg[iD], [92, top, 512, top + h1 * k], { max: k });
          await placeCrop(doc, sp, r2, pg[iD], [92, top + h1 * k + GAP, 512, top + (h1 + h2) * k + GAP], { max: k });
          yb = top + (h1 + h2) * k + GAP + 34;
        }
        put(iD, 'Габариты (Ш×Г×В): ' + s.dims + ' мм', 302.2, yb, 10, { a: 'c' });
        put(iD, 'Масса — ' + s.massKg + ' кг', 302.2, yb + 16, 10, { a: 'c' });
      }

      /* ---------- технические характеристики ---------- */
      const i0 = at('tech0');
      title(i0, '3. Основные технические характеристики предлагаемого оборудования');
      layoutTable(rows, pg.slice(i0, i0 + tPages), W, wrap, putOn);

      /* ---------- транспортировка, условия эксплуатации, обслуживание ---------- */
      const i1 = at('tr1'), i2 = at('tr2'), i3 = at('srv');
      title(i1, '4. Транспортировка и хранение');
      await drawTransport(doc, shell, pg[i1], pg[i2], s, para, putOn, W);
      title(i3, '6. Техническое обслуживание');
      let y = para(pg[i3], TX0, TX1, 136, 'Шкаф устанавливается на раму из стального швеллера над кабельным каналом глубиной не менее 1000 мм. ' +
        (s.srv === '1' ? 'Обслуживание устройства плавного пуска — одностороннее (с передней стороны); перед шкафом необходимо оставить проход не менее 1200 мм.'
          : 'Обслуживание — двухстороннее: перед шкафом и за шкафом необходимо оставить проходы не менее 1200 мм.'), { indent: 18 });
      y = para(pg[i3], TX0, TX1, y + 4, 'Тиристоры имеют большой срок службы и не требуют обслуживания в течение нескольких лет; модули каждой фазы заменяются по отдельности. ' +
        'Перед подачей высокого напряжения систему управления можно проверить пониженным напряжением 380 В. Заземляющие проводники блоков управления подключены к медной шине заземления в нижней части шкафа.', { indent: 18 });
      { const k3 = Math.min(1.35, (TX1 - TX0) / 340, (690 - y - 40) / 198), g3 = makeG(pg[i3], putOn, 306 - 170 * k3 + 4 * k3, y + 22 - 20 * k3, k3);
        g3.setW(W); figInstall(g3, s.srv === '1'); y = y + 22 + 198 * k3 + 10; }
      putOn(pg[i3], 'Рис. 3. Установка УПП: кабельный канал и проходы обслуживания, мм', 306, y, 8.6, { a: 'c' });

      /* ---------- «Наши клиенты» ---------- */
      const iK = at('clients');
      M.add(pg[iK], 54, 104, 330, 127); put(iK, '7. Наши клиенты', 59.2, 120.0, 13, { f: 'S', c: ORANGE });

      M.apply();
      if (s.noDrawing) alert('Напоминание: для ' + s.mark + ' габаритный эскиз в ТКП не вставляется — лист эскиза останется пустым' +
        (s.dims ? '' : ', строка «Габариты» тоже') + '. Приложите эскиз к ТКП отдельно.');
      const out = await doc.save({ useObjectStreams: true });
      const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url;
      link.download = 'TKP_' + s.mark.replace(/ /g, '_') + '.pdf';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { console.error(e); alert('Не удалось сформировать ТКП: ' + e.message); }
    finally { if (btn) btn.style.opacity = 1; }
  }

  /* ================= Вставка фрагмента листа (вектором) =================
     box — область исходного листа «как его видит человек», zone — куда вписать на листе ТКП.
     holes — области исходного листа, которые нужно скрыть (надписи под замену).
     Возвращает функцию пересчёта точки исходного листа в координаты листа ТКП (и масштаб map.k). */
  async function placeCrop(doc, srcPage, box, dst, zone, o = {}) {
    const [sx0, sy0, sx1, sy1] = box, sw = sx1 - sx0, sh = sy1 - sy0;
    const zw = zone[2] - zone[0], zh = zone[3] - zone[1];
    const k = Math.min(zw / sw, zh / sh, o.max || 99);
    const DX = zone[0] + (zw - sw * k) / 2, DY = zone[1] + (zh - sh * k) / 2, Hd = dst.getHeight(), rd = dst.getRotation().angle % 360;
    const r = srcPage.getRotation().angle % 360, Hs = srcPage.getHeight();
    const bb = r === 90 ? { left: sy0, right: sy1, bottom: sx0, top: sx1 } : { left: sx0, right: sx1, bottom: Hs - sy1, top: Hs - sy0 };
    const em = await doc.embedPage(srcPage, bb);
    const map = (x, y) => [DX + (x - sx0) * k, DY + (y - sy0) * k];
    map.k = k;
    // прямоугольник «как видит человек» → координаты листа ТКП (у листов-чертежей /Rotate 90)
    const vrect = (X0, Y0, X1, Y1) => rd === 90 ? rectangle(Y0, X0, Y1 - Y0, X1 - X0) : rectangle(X0, Hd - Y1, X1 - X0, Y1 - Y0);
    dst.pushOperators(pushGraphicsState());
    if (o.holes && o.holes.length) {
      const ops = [rectangle(0, 0, dst.getWidth(), Hd)];
      for (const [a, b, c, d] of o.holes) { const p = map(a, b), q = map(c, d); ops.push(vrect(p[0], p[1], q[0], q[1])); }
      dst.pushOperators(...ops, clipEvenOdd(), endPath());
    }
    // (u, v) — координаты вырезки исходного листа без поворота; матрица переводит их сразу в координаты листа ТКП
    const m = r === 90
      ? (rd === 90 ? [k, 0, 0, k, DY, DX] : [0, -k, k, 0, DX, Hd - DY])
      : (rd === 90 ? [0, k, -k, 0, DY + sh * k, DX] : [k, 0, 0, k, DX, Hd - DY - sh * k]);
    dst.pushOperators(concatTransformationMatrix(...m));
    dst.drawPage(em, { x: 0, y: 0, width: bb.right - bb.left, height: bb.top - bb.bottom });
    dst.pushOperators(popGraphicsState());
    return map;
  }


  /* ================= Рисунки, нарисованные кодом (вектор) =================
     Локальные координаты рисунка (сверху вниз) → лист: X = ox + x*k, Y = oy + y*k. Надписи — Inter, размер в pt листа. */
  const GREY = rgb(.55, .58, .6), FILL = rgb(.93, .95, .96), SOIL = rgb(.45, .45, .45);
  function makeG(p, put, ox, oy, k) {
    const H = p.getHeight(), X = x => ox + x * k, Y = y => oy + y * k, rot = p.getRotation().angle % 360 === 90;
    const path = (d, o = {}) => {
      if (rot) p.pushOperators(pushGraphicsState(), concatTransformationMatrix(0, 1, -1, 0, H, 0));   // лист-чертёж повёрнут на 90°
      p.drawSvgPath(d, { x: 0, y: H, borderColor: o.c || (o.fill && !o.stroke ? undefined : DARK), borderWidth: o.fill && !o.stroke ? 0 : (o.w || .8), color: o.fill, borderDashArray: o.dash, borderLineCap: o.cap });
      if (rot) p.pushOperators(popGraphicsState());
    };
    const g = {
      k, X, Y,
      line: (x0, y0, x1, y1, o = {}) => path(`M ${X(x0)} ${Y(y0)} L ${X(x1)} ${Y(y1)}`, o),
      poly: (pts, o = {}) => path('M ' + pts.map(([x, y]) => X(x) + ' ' + Y(y)).join(' L ') + (o.open ? '' : ' Z'), o),
      rect: (x, y, w, h, o = {}) => g.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o),
      circle: (cx, cy, r, o = {}) => { const R = r * k, a = X(cx), b = Y(cy);
        path(`M ${a - R} ${b} A ${R} ${R} 0 1 0 ${a + R} ${b} A ${R} ${R} 0 1 0 ${a - R} ${b} Z`, o); },
      text: (str, x, y, size, o = {}) => put(p, str, X(x), Y(y), size, o),
      // штриховка прямоугольника линиями под 45°
      hatch: (x0, y0, x1, y1, step, o = {}) => {
        for (let c = x0 - (y1 - y0); c < x1; c += step) {
          let ax = c, ay = y1, bx = c + (y1 - y0), by = y0;
          if (ax < x0) { ay -= x0 - ax; ax = x0; }
          if (bx > x1) { by += bx - x1; bx = x1; }
          if (ay > y0 && by < y1 && ax < bx) g.line(ax, ay, bx, by, { w: o.w || .35, c: o.c || SOIL });
        }
      },
      arrow: (x, y, dx, dy, o = {}) => { const L = 4 / k, W2 = 1.4 / k, n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
        g.poly([[x, y], [x - ux * L - uy * W2, y - uy * L + ux * W2], [x - ux * L + uy * W2, y - uy * L - ux * W2]], { fill: o.c || TEAL }); },
      // размер: линия со стрелками и текст по середине
      dim: (x0, y0, x1, y1, str, o = {}) => {
        const c = o.c || TEAL; g.line(x0, y0, x1, y1, { c, w: .6 }); g.arrow(x0, y0, x0 - x1, y0 - y1, { c }); g.arrow(x1, y1, x1 - x0, y1 - y0, { c });
        if (y0 === y1) g.text(str, (x0 + x1) / 2, y0 - 3 / k, o.size || 7.4, { f: 'S', c, a: 'c' });
        else g.text(str, x0 + (o.side === 'r' ? 4 / k : -4 / k), (y0 + y1) / 2 + 2.5 / k, o.size || 7.4, { f: 'S', c, a: o.side === 'r' ? 'l' : 'r' });
      },
      // выноска с подписью
      lead: (x0, y0, x1, y1, str, o = {}) => { g.circle(x0, y0, .9 / k, { fill: DARK }); g.line(x0, y0, x1, y1, { w: .5 }); const r = o.a === 'r';
        const z = o.size || 7.6; g.line(x1, y1, x1 + (r ? -1 : 1) * (W(str) * z / 7.6 / k + 2 / k), y1, { w: .5 }); g.text(str, x1 + (r ? -1 : 1) * 1 / k, y1 - 2 / k, z, { f: 'R', a: r ? 'r' : 'l' }); }
    };
    let W = s => 0; g.setW = f => { W = s => f(s, 'R', 7.6); };
    return g;
  }
  // фасад шкафа УПП: отсек управления с дисплеем, высоковольтный отсек, отсек ввода
  function cabFront(g, x, y, w, h) {
    g.rect(x, y, w, h, { fill: FILL, stroke: true, w: .9 });
    g.line(x, y + h * .3, x + w, y + h * .3, { w: .6 }); g.line(x, y + h * .64, x + w * .78, y + h * .64, { w: .6 });
    g.line(x + w * .78, y + h * .3, x + w * .78, y + h, { w: .6 });
    g.rect(x + w * .3, y + h * .09, w * .24, h * .075, { fill: rgb(.75, .85, .88), stroke: true, w: .5 });
    for (let i = 0; i < 5; i++) g.circle(x + w * (.16 + i * .12), y + h * .045, w * .022, { w: .4 });
    for (let i = 0; i < 4; i++) g.circle(x + w * (.22 + i * .13), y + h * .23, w * .022, { w: .4 });
    g.rect(x + w * .68, y + h * .1, w * .12, h * .05, { w: .4 });
    g.rect(x + w * .33, y + h * .38, w * .12, h * .07, { w: .5 });
    g.rect(x + w * .3, y + h * .8, w * .24, h * .055, { w: .5 });
    g.rect(x + w * .86, y + h * .45, w * .04, h * .12, { w: .5 });
    g.rect(x + w * .66, y + h * .7, w * .05, h * .035, { w: .4 });
  }
  // Рис. 1 — подъём УПП на стропах (локальная область 250×236)
  function figLift(g) {
    const cx = 130, top = 84, bot = 222, cw = 62;
    g.line(cx, 0, cx, 12, { w: 2.2 });
    g.poly([[cx, 12], [cx, 22], [cx - 1.5, 26], [cx - 5, 27.5], [cx - 9, 26], [cx - 10.5, 22]], { open: true, w: 2 });
    const ax = cx - 5, ay = 27, L = cx - 22, R = cx + 22;
    const hit = xb => ax + (xb - ax) * (top - ay) / (bot + 3 - ay);
    g.line(ax, ay, L, bot + 3, { w: 1.3, c: rgb(.25, .27, .3) }); g.line(ax, ay, R, bot + 3, { w: 1.3, c: rgb(.25, .27, .3) });
    cabFront(g, cx - cw / 2, top, cw, bot - top);
    g.line(ax, ay, L, bot + 3, { w: 1.3, c: rgb(.25, .27, .3) }); g.line(ax, ay, R, bot + 3, { w: 1.3, c: rgb(.25, .27, .3) });
    for (const xb of [L, R]) g.rect(hit(xb) - 5, top - 3, 10, 4.5, { fill: ORANGE, stroke: true, w: .4 });
    g.rect(cx - cw / 2 - 2, bot, cw + 4, 7, { fill: rgb(.85, .87, .88), stroke: true, w: .6 });
    for (const xb of [L, R]) g.rect(xb - 6, bot + 1.5, 12, 4.5, { fill: ORANGE, stroke: true, w: .4 });
    g.line(70, bot + 7, 190, bot + 7, { w: .8 }); g.hatch(70, bot + 7, 190, bot + 12, 3);
    g.line(cx - cw / 2 - 2, top, 82, top, { c: TEAL, w: .4, dash: [2, 1.5] }); g.line(ax - 4, ay, 82, ay, { c: TEAL, w: .4, dash: [2, 1.5] });
    g.dim(86, ay, 86, top, 'не менее 1,2 м');
    { const yy = (ay + top) / 2; g.lead(ax + (R - ax) * (yy - ay) / (bot + 3 - ay), yy, 172, 40, 'Строп (трос, цепь)'); }
    g.lead(hit(R) + 4, top - 1, 172, 72, 'Защитная пластина');
    g.lead(cx + cw / 2 - 4, (top + bot) / 2, 172, 140, 'УПП');
    g.lead(R + 5, bot + 4, 172, 200, 'Проём под стропы');
  }
  // Рис. 3 — установка УПП: вид сбоку и вид спереди (локальная область 340×214), без размеров самого шкафа
  function figInstall(g, oneSide) {
    const fl = 150, tr = 40;
    // вид сбоку
    const c0 = 100, c1 = 160, wl = oneSide ? 166 : 210;
    g.hatch(20, fl, 104, fl + tr + 8, 3.2); g.hatch(150, fl, oneSide ? 186 : 230, fl + tr + 8, 3.2); g.hatch(104, fl + tr, 150, fl + tr + 8, 3.2);
    g.line(20, fl, 104, fl, { w: .9 }); g.line(150, fl, oneSide ? 186 : 230, fl, { w: .9 });
    g.poly([[104, fl], [104, fl + tr], [150, fl + tr], [150, fl]], { open: true, w: .9 });
    for (const [x0, x1] of [[34, 44], [wl, wl + 10]]) { g.rect(x0, 40, x1 - x0, fl - 40, { w: .7 }); g.hatch(x0, 40, x1, fl, 3, { c: GREY }); }
    g.rect(c0, 54, c1 - c0, fl - 6 - 54, { fill: FILL, stroke: true, w: .9 });
    g.line(c0 + 4, 60, c0 + 4, fl - 10, { w: .4 }); g.line(c1 - 4, 60, c1 - 4, fl - 10, { w: .4 });
    g.text('УПП', (c0 + c1) / 2, 104, 8, { f: 'S', a: 'c' });
    g.rect(c0 - 2, fl - 6, c1 - c0 + 4, 6, { fill: rgb(.35, .38, .4) });
    g.line(44, 34, 44, 28, { c: TEAL, w: .4 }); g.line(c0, 52, c0, 28, { c: TEAL, w: .4, dash: [2, 1.5] });
    g.dim(44, 31, c0, 31, '≥1200');
    if (!oneSide) { g.line(c1, 52, c1, 28, { c: TEAL, w: .4, dash: [2, 1.5] }); g.line(wl, 34, wl, 28, { c: TEAL, w: .4 }); g.dim(c1, 31, wl, 31, '≥1200'); }
    g.dim(112, fl + 1, 112, fl + tr - 1, '≥1000', { side: 'r' });
    { // подпись в две строки — помещается в проходе при любом масштабе
      const k = g.k; g.circle(c0 + 2, fl - 3, .9 / k, { fill: DARK }); g.line(c0 + 2, fl - 3, 92, 124, { w: .5 }); g.line(92, 124, 92 - 34 / k, 124, { w: .5 });
      g.text('Стальной', 91, 124 - 11 / k, 7.2, { f: 'R', a: 'r' }); g.text('швеллер', 91, 124 - 2 / k, 7.2, { f: 'R', a: 'r' }); }
    g.text('Вид сбоку', 125, 212, 8.2, { f: 'S', a: 'c' });
    // вид спереди
    const fx = 262, fw = 40;
    g.hatch(236, fl, 270, fl + tr + 8, 3.2); g.hatch(298, fl, 332, fl + tr + 8, 3.2); g.hatch(270, fl + tr, 298, fl + tr + 8, 3.2);
    g.line(236, fl, 270, fl, { w: .9 }); g.line(298, fl, 332, fl, { w: .9 });
    g.poly([[270, fl], [270, fl + tr], [298, fl + tr], [298, fl]], { open: true, w: .9 });
    cabFront(g, fx, 54, fw, fl - 6 - 54);
    g.rect(fx - 2, fl - 6, fw + 4, 6, { fill: rgb(.35, .38, .4) });
    g.text('Вид спереди', fx + fw / 2, 212, 8.2, { f: 'S', a: 'c' });
  }


  /* ================= Однолинейная схема (рисуется кодом) =================
     Локальная область 420×524 (зона листа-чертежа). Состав по исполнению:
     стандарт и S — указатель напряжения, TV1–TV2, тиристорный блок, байпас KM, ОПН, TAa/TAc;
     IK — то же + вводной разъединитель QS; E — выкатной вакуумный выключатель QF, TA 1S/2S, указатель, блок, KM, ОПН, TA0. */
  function drawScheme(g, s) {
    const E = s.pkg === 'E', IK = s.pkg === 'IK', X0 = 190, LW = 1.1, kv = s.kv + ' кВ';
    const ln = (x0, y0, x1, y1, o = {}) => g.line(x0, y0, x1, y1, { w: LW, ...o });
    const dot = (x, y) => g.circle(x, y, 2.1, { fill: DARK });
    const lbl = (str, x, y, o = {}) => g.text(str, x, y, o.size || 9.6, { f: o.f || 'S', a: o.a || 'l', c: o.c || DARK });
    const note = (str, x, y, a = 'l') => g.text(str, x, y, 7.4, { f: 'L', a, c: GREY });
    const ground = (x, y) => { ln(x, y, x, y + 6); g.line(x - 8, y + 6, x + 8, y + 6, { w: 1.2 }); g.line(x - 5, y + 9, x + 5, y + 9, { w: 1 }); g.line(x - 2.2, y + 12, x + 2.2, y + 12, { w: .9 }); };
    // коммутационный аппарат: подвижный контакт — наклонная линия; вид неподвижного контакта: QS — черта, QF — крест, KM — полукруг
    const sw = (x, y0, y1, kind) => {
      const yb = y1 - 6;
      ln(x, y0, x, y0 + 6); ln(x, yb, x, y1);
      g.line(x, yb, x - 11, y0 + (kind === 'KM' ? 12 : 8), { w: 1.3 });
      if (kind === 'QS') g.line(x - 5, y0 + 6, x + 5, y0 + 6, { w: 1.2 });
      if (kind === 'QF') { g.line(x - 4, y0 + 2, x + 4, y0 + 10, { w: 1.1 }); g.line(x - 4, y0 + 10, x + 4, y0 + 2, { w: 1.1 }); }
      if (kind === 'KM') { const r = 4, c = y0 + 6 + r;        // контакт контактора (ГОСТ 2.755) — полуокружность на конце неподвижного контакта
        g.poly(Array.from({ length: 13 }, (_, i) => { const a = Math.PI + Math.PI * i / 12; return [x + r * Math.cos(a), c + r * Math.sin(a)]; }), { open: true, w: 1.1 }); }
    };
    // три фазы — три засечки поперёк линии
    const tri = (x, y) => { for (const d of [-4, 0, 4]) g.line(x - 5, y + d + 3, x + 5, y + d - 3, { w: .9 }); };
    const plug = (x, y, up) => { const d = up ? -1 : 1; g.poly([[x - 5, y - 4 * d], [x, y + 1 * d], [x + 5, y - 4 * d]], { open: true, w: 1.1 }); g.poly([[x - 5, y + 1 * d], [x, y + 6 * d], [x + 5, y + 1 * d]], { open: true, w: 1.1 }); };
    // трансформатор тока на линии: окружность и вывод вторичной обмотки с двумя засечками
    const ct = (x, y, r = 8) => { g.circle(x, y, r, { w: 1, fill: WHITE, stroke: true }); g.line(x + r, y, x + r + 13, y, { w: .8 });
      g.line(x + r + 5, y + 3, x + r + 8, y - 3, { w: .8 }); g.line(x + r + 8.5, y + 3, x + r + 11.5, y - 3, { w: .8 }); };
    const fuse = (x, y) => { g.rect(x - 4.5, y, 9, 22, { w: 1, fill: WHITE, stroke: true }); ln(x, y, x, y + 22, { w: .8 }); };
    const tv = (x, y) => { g.circle(x, y, 8, { w: 1, fill: WHITE, stroke: true }); g.circle(x, y + 11, 8, { w: 1, fill: WHITE, stroke: true }); g.circle(x, y, 8, { w: 1 }); };
    const indicator = (x, y) => {                       // ёмкостный указатель напряжения: конденсатор + лампа
      ln(x, y, x, y + 12); g.line(x - 7, y + 12, x + 7, y + 12, { w: 1.3 }); g.line(x - 7, y + 16, x + 7, y + 16, { w: 1.3 }); ln(x, y + 16, x, y + 24);
      g.circle(x, y + 31, 7, { w: 1, fill: WHITE, stroke: true }); g.line(x - 5, y + 26, x + 5, y + 36, { w: .8 }); g.line(x - 5, y + 36, x + 5, y + 26, { w: .8 });
      ln(x, y + 38, x, y + 42); ground(x, y + 42);
    };
    const arrester = (x, y) => { ln(x, y, x, y + 8); g.rect(x - 6, y + 8, 12, 26, { w: 1, fill: WHITE, stroke: true }); ln(x, y + 8, x, y + 26, { w: .8 });
      g.poly([[x - 3.5, y + 22], [x + 3.5, y + 22], [x, y + 30]], { fill: DARK }); ln(x, y + 34, x, y + 40); ground(x, y + 40); };
    const thyr = (x, y, up) => {                        // тиристор: треугольник, черта и управляющий электрод
      const d = up ? -1 : 1;
      g.poly([[x - 6, y - 5 * d], [x + 6, y - 5 * d], [x, y + 5 * d]], { fill: DARK });
      g.line(x - 7, y + 5 * d, x + 7, y + 5 * d, { w: 1.2 }); g.line(x + (up ? -3 : 3), y + 2 * d, x + (up ? -9 : 9), y + 8 * d, { w: .8 });
    };
    const block = (x, y0, y1) => {                      // тиристорный блок: встречно-параллельные тиристоры и RC-цепь
      const bx0 = x - 46, bx1 = x + 46, m = (y0 + y1) / 2;
      g.rect(bx0, y0, bx1 - bx0, y1 - y0, { w: 1.1, fill: PALE, stroke: true });
      const r0 = y0 + 12, r1 = y1 - 12, xs = [x - 30, x - 10, x + 10, x + 30];
      ln(x, y0, x, r0); ln(x, r1, x, y1); g.line(xs[0], r0, xs[3], r0, { w: 1 }); g.line(xs[0], r1, xs[3], r1, { w: 1 });
      for (const xx of xs) ln(xx, r0, xx, r1, { w: .9 });
      thyr(xs[0], m, false); thyr(xs[3], m, true);
      g.rect(xs[1] - 4, m - 9, 8, 18, { w: .9, fill: WHITE, stroke: true });               // R
      g.line(xs[2] - 6, m - 14, xs[2] + 6, m - 14, { w: 1.1 }); g.line(xs[2] - 6, m - 10, xs[2] + 6, m - 10, { w: 1.1 });   // C
      g.rect(xs[2] - 4, m - 4, 8, 16, { w: .9, fill: WHITE, stroke: true });               // R
      g.line(xs[2], m - 14, xs[2], m - 10, { w: 0, c: WHITE });
    };

    let y = 0;
    // ввод
    if (E) {
      g.line(X0 - 70, 18, X0 + 70, 18, { w: 2.4 }); lbl('Сборные шины РУ ' + kv, X0 + 76, 21.5, { f: 'R', size: 8.6 });
      dot(X0, 18); y = 18;
      ln(X0, y, X0, 40); tri(X0, 27); plug(X0, 44, true); ln(X0, 50, X0, 56); sw(X0, 56, 92, 'QF'); ln(X0, 92, X0, 98); plug(X0, 102, false);
      lbl('QF', X0 - 34, 80); note('выкатной вакуумный', X0 + 14, 70); note('выключатель', X0 + 14, 79);
      y = 110;
      ln(X0, y, X0, 166); ct(X0, 126); ct(X0, 148);
      lbl('TA', X0 - 46, 141); g.text('1S', X0 - 20, 129, 7.4, { f: 'R', a: 'r' }); g.text('2S', X0 - 20, 151, 7.4, { f: 'R', a: 'r' });
      y = 172;
    } else {
      g.text('От ячейки РУ ' + kv, X0, 8, 8.6, { f: 'R', a: 'c' });
      g.poly([[X0 - 4, 14], [X0 + 4, 14], [X0, 22]], { fill: DARK }); ln(X0, 22, X0, IK ? 40 : 62); tri(X0, IK ? 30 : 38);
      if (IK) { sw(X0, 40, 76, 'QS'); lbl('QS', X0 - 34, 64); note('вводной', X0 + 14, 58); note('разъединитель', X0 + 14, 67); ln(X0, 76, X0, 92); y = 92; }
      else y = 62;
      // напряжение сети: указатель (слева), TV1–TV2 через предохранитель (справа)
      dot(X0, y); ln(X0, y, X0 - 92, y); ln(X0 - 92, y, X0 - 92, y + 8); indicator(X0 - 92, y + 8);
      note('указатель', X0 - 104, y + 36, 'r'); note('напряжения', X0 - 104, y + 45, 'r');
      const yt = y + 24, XT = X0 + 150; dot(X0, yt); ln(X0, yt, XT, yt); ln(XT, yt, XT, yt + 8); fuse(XT, yt + 8); ln(XT, yt + 30, XT, yt + 38);
      tv(XT, yt + 46); lbl('FU', XT - 12, yt + 22, { a: 'r' }); lbl('TV1–TV2', XT - 12, yt + 56, { a: 'r' });
      ln(X0, y, X0, y + 72); y += 72;
    }
    // тиристорный блок и байпас
    const yA = y + 10, yB0 = yA + 22, yB1 = yB0 + 92, yC = yB1 + 24, XB = X0 + 92;
    ln(X0, y, X0, yA); dot(X0, yA); ln(X0, yA, XB, yA); ln(X0, yA, X0, yB0);
    block(X0, yB0, yB1); ln(X0, yB1, X0, yC); dot(X0, yC);
    g.text('Тиристорный блок', X0 - 52, yB1 - 4, 7.4, { f: 'L', a: 'r', c: GREY });
    ln(XB, yA, XB, yA + 30); sw(XB, yA + 30, yA + 76, 'KM'); ln(XB, yA + 76, XB, yC); ln(XB, yC, X0, yC);
    lbl('KM', XB + 10, yA + 58); note('байпасный вакуумный', XB + 10, yA + 70); note('контактор', XB + 10, yA + 79);
    // E: указатель напряжения после ТТ — слева
    if (E) { ln(X0, yA, X0 - 92, yA); ln(X0 - 92, yA, X0 - 92, yA + 8); indicator(X0 - 92, yA + 8); note('указатель', X0 - 104, yA + 36, 'r'); note('напряжения', X0 - 104, yA + 45, 'r'); }
    // ОПН на стороне двигателя
    const yD = yC + 22; ln(X0, yC, X0, yD); dot(X0, yD); ln(X0, yD, X0 - 92, yD); arrester(X0 - 92, yD);
    lbl('FV', X0 - 80, yD + 25); note('ОПН', X0 - 80, yD + 35);
    // трансформаторы тока
    let yE = yD + 26;
    if (E) { ln(X0, yD, X0, yE + 30); ct(X0, yE + 12, 10); lbl('TA0', X0 - 48, yE + 15.5); note('ТТ нулевой', X0 + 36, yE + 10); note('последовательности', X0 + 36, yE + 19); yE += 30; }
    else { ln(X0, yD, X0, yE + 48); ct(X0, yE + 12); ct(X0, yE + 34); lbl('TAa', X0 + 36, yE + 15.5); lbl('TAc', X0 + 36, yE + 37.5); yE += 48; }
    // двигатель
    ln(X0, yE, X0, yE + 16); tri(X0, yE + 7);
    g.circle(X0, yE + 34, 18, { w: 1.3, fill: WHITE, stroke: true }); g.text('M', X0, yE + 36, 12, { f: 'S', a: 'c' }); g.text('3~', X0, yE + 46, 7, { f: 'R', a: 'c' });
    note('электродвигатель ' + kv, X0 + 26, yE + 37);
    // граница поставки УПП
    const top = E ? 35 : (IK ? 38 : 52), bot = yD + (E ? 70 : 90);
    g.rect(X0 - 160, top, 375, bot - top, { c: TEAL, w: .8, dash: [5, 3] });
    g.text(s.mark, X0 + 211, bot - 6, 8.2, { f: 'S', a: 'r', c: TEAL });
    return bot;
  }

  /* ================= Таблица характеристик (оформление как в ТКП на ПЧ) =================
     Без pages — только считает, сколько листов займёт. Первый лист — под заголовком (таблица с y 128,7),
     следующие — от верха рамки. */
  function layoutTable(rows, pages, W, wrap, put) {
    const FS = 8.6, LD = FS * 1.24, PAD = 4.5, C0 = FR.x0, C1 = 244.8, C2 = FR.x1, MINH = 18;
    const lines = (str, w) => str ? wrap(str, 'L', FS, w - 2 * PAD) : [''];
    const hOf = n => Math.max(MINH, (n - 1) * LD + FS * .72 + 2 * 6.2);
    const meas = rows.map(([a, b]) => {
      if (a === '§') return { sec: b, h: 21 };
      const L = lines(a, C1 - C0), vals = (Array.isArray(b) ? b : [b]).map(v => lines(v, C2 - C1)), vh = vals.map(v => hOf(v.length));
      return { L, vals, vh, h: Math.max(hOf(L.length), vh.reduce((x, y) => x + y, 0)) };
    });
    let page = 0, y = 128.7;
    const P = () => pages && pages[page];
    const hline = (x0, x1, yy) => P() && P().drawLine({ start: { x: x0, y: P().getHeight() - yy }, end: { x: x1, y: P().getHeight() - yy }, thickness: .7, color: LINE });
    const vline = (x, y0, y1) => P() && P().drawLine({ start: { x, y: P().getHeight() - y0 }, end: { x, y: P().getHeight() - y1 }, thickness: .55, color: LINE });
    const text = (ls, cx, top, h, f = 'L') => {
      if (!P()) return;
      const th = (ls.length - 1) * LD + FS * .72; let yy = top + h / 2 - th / 2 + FS * .72;
      for (const l of ls) { put(P(), l, cx, yy, FS, { f, a: 'c' }); yy += LD; }
    };
    if (P()) hline(C0, C2, y);
    for (const r of meas) {
      if (y + r.h > FR.bot - 1) { page++; y = FR.top; }
      if (r.sec) { text([r.sec], (C0 + C2) / 2, y, r.h, 'S'); y += r.h; if (y < FR.bot - 3) hline(C0, C2, y); continue; }
      text(r.L, (C0 + C1) / 2, y, r.h);
      let vy = y;
      r.vals.forEach((v, k) => {
        const h = k === r.vals.length - 1 ? y + r.h - vy : r.vh[k];
        text(v, (C1 + C2) / 2, vy, h); vy += h;
        if (k < r.vals.length - 1) hline(C1, C2, vy);
      });
      vline(C1, y, y + r.h);
      y += r.h;
      if (y < FR.bot - 3) hline(C0, C2, y);
    }
    return { pages: page + 1 };
  }

  /* ================= Описание ================= */
  function drawDescription(p, s, para, put, W) {
    const X0 = 56, X1 = 548, TOP = 133, BOTTOM = 728, ex = extrasList(s);
    const layout = (size, dry) => {
      const lead = size * 1.37, o = { size, lead }, gap = size * .45, P = dry ? null : p;
      const bullet = (head, rest, y, c) => {
        if (P) put(P, '•', X0 + 4, y + size * .95, size, { c: c || DARK });
        if (!head) return para(P, X0 + 15, X1, y, rest, { ...o, justify: false });
        const hw = W(head, 'S', size);
        if (P) put(P, head, X0 + 15, y + size * .95, size, { f: 'S' });
        const glue = /^ /.test(rest) ? W(' ', 'L', size) : 0, restTxt = rest.replace(/^ /, '');
        if (restTxt === '.') { if (P) put(P, '.', X0 + 15 + hw, y + size * .95, size); return y + size * 1.25; }
        return para(P, X0 + 15, X1, y, restTxt, { ...o, indent: hw + glue, justify: false });
      };
      let y = TOP;
      for (const t of DESC_PARAS) y = para(P, X0, X1, y, t, { ...o, indent: 22 }) + gap;
      y += gap;
      if (P) put(P, 'ВВ УПП типа ESQ F HVS позволяют:', X0 + 22, y + size * .95, size, { f: 'S' });
      y += lead + 1;
      for (const b of DESC_ALLOW) y = bullet('', b, y) + size * .18;
      y += gap * 1.5;
      if (P) put(P, 'ВВ УПП типа ESQ F HVS — это:', X0 + 22, y + size * .95, size, { f: 'S' });
      y += lead + 1;
      for (const [h, r] of DESC_IS) y = bullet(h, r, y) + size * .3;
      y += gap * 1.5;
      if (P) put(P, 'Принцип работы', X0 + 22, y + size * .95, size, { f: 'S' });
      y += lead + 1;
      for (const t of DESC_TAIL) y = para(P, X0, X1, y, t, { ...o, indent: 22 }) + gap;
      if (ex.length) {
        y += gap * 1.5;
        if (P) put(P, 'Дополнительная комплектация в данном предложении:', X0 + 22, y + size * .95, size, { f: 'S', c: TEAL });
        y += lead + 1;
        for (const [h, r] of ex) y = bullet(h, r, y, TEAL) + size * .3;
      }
      return y;
    };
    let size = 9.6;
    while (size > 7.2 && layout(size, true) > BOTTOM) size -= .1;
    layout(size, false);
  }

  /* ================= Расшифровка обозначения + модельный ряд ================= */
  function drawDecode(p, s, put, W, wrap) {
    const H = p.getHeight(), X0 = 58, X1 = 554;
    put(p, 'Расшифровка обозначения', X0, 122, 13, { f: 'S', c: ORANGE });
    const v = s.kv === 10 ? '10' : '06', cur = String(s.I).padStart(3, '0');
    const seg = [['ESQ F HVS', 1], [v, 2], ['–'], [cur, 3]];
    if (s.pkg !== 'STD') seg.push(['–'], [s.pkg, 4]);
    const fw = (t, z) => W(t, 'S', z), gap = .3;
    const w1 = seg.reduce((a, [t]) => a + fw(t, 1), 0) + gap * (seg.length - 1);
    const z = Math.min(26, (X1 - X0 - 4) / w1), base = 172;
    let x = X0 + ((X1 - X0) - w1 * z) / 2, k = 0;
    for (const [t, n] of seg) {
      const w = fw(t, z);
      if (!n) { put(p, t, x, base, z, { f: 'S' }); x += w + gap * z; continue; }
      const c = k++ % 2 ? OR5 : TEAL5;
      put(p, t, x, base, z, { f: 'S', c });
      const uy = base + z * .2, cx = x + w / 2;
      p.drawRectangle({ x, y: H - uy - z * .1, width: w, height: z * .1, color: c, borderWidth: 0 });
      p.drawLine({ start: { x: cx, y: H - uy - z * .1 }, end: { x: cx, y: H - uy - z * .5 }, thickness: .6, color: DARK });
      put(p, String(n), cx, uy + z * 1.0, z * .42, { f: 'R', a: 'c' });
      x += w + gap * z;
    }
    put(p, 'Маркировка устройства плавного пуска', (X0 + X1) / 2, base + z * 1.85, 8.5, { a: 'c' });

    const rows = [['Серия высоковольтных устройств плавного пуска', 'ESQ F HVS'],
      ['Номинальное напряжение УПП', v + ' — ' + s.kv + ' кВ'],
      ['Номинальный ток УПП, А (три цифры)', cur + ' — ' + s.I + ' А (двигатель до ' + s.P + ' кВт)'],
      ['Исполнение', s.pkg === 'STD' ? 'без буквы — стандартное' : s.pkg + ' — ' + PKG[s.pkg]]];
    const FS = 8.4, LH = 10.6, PAD = 3.6, line = (x0, y0, x1, y1) => p.drawLine({ start: { x: x0, y: H - y0 }, end: { x: x1, y: H - y1 }, thickness: .6, color: DARK });
    const table = (y, cols, head, body, hl) => {
      const hh = 16, top = y;
      p.drawRectangle({ x: cols[0], y: H - y - hh, width: cols[cols.length - 1] - cols[0], height: hh, color: HEAD, borderWidth: 0 });
      head.forEach((t, i) => put(p, t, (cols[i] + cols[i + 1]) / 2, y + hh / 2 + FS * .36, FS, { f: 'S', a: 'c', maxW: cols[i + 1] - cols[i] - 4 }));
      line(cols[0], y, cols[cols.length - 1], y); y += hh; line(cols[0], y, cols[cols.length - 1], y);
      body.forEach((r, ri) => {
        const L = r.map((t, i) => wrap(t, 'L', FS, cols[i + 1] - cols[i] - 2 * PAD)), n = Math.max(...L.map(l => l.length)), h = n * LH + 2 * PAD - 1;
        if (hl === ri) p.drawRectangle({ x: cols[0], y: H - y - h, width: cols[cols.length - 1] - cols[0], height: h, color: PALE, borderWidth: 0 });
        L.forEach((ls, i) => {
          const ty = y + PAD + FS * .82 + (n - ls.length) * LH / 2, center = i === 0 || r.length > 2;
          ls.forEach((t, j) => put(p, t, center ? (cols[i] + cols[i + 1]) / 2 : cols[i] + PAD, ty + j * LH, FS, { f: hl === ri ? 'S' : 'L', a: center ? 'c' : 'l' }));
        });
        y += h; line(cols[0], y, cols[cols.length - 1], y);
      });
      cols.forEach(cx => line(cx, top, cx, y));
      return y;
    };
    let y = table(base + z * 2.6, [X0, X0 + 40, X0 + 236, X1], ['Поз.', 'Параметр', 'Обозначение'], rows.map((r, i) => [String(i + 1), ...r]));

    // модельный ряд выбранного напряжения; выбранная модель выделена
    const list = (window.UPP_MODELS && window.UPP_MODELS[v]) || [];
    if (list.length) {
      y += 26;
      put(p, 'Модельный ряд ESQ F HVS на ' + s.kv + ' кВ', X0, y, 11, { f: 'S', c: TEAL });
      // габариты — по техописанию (разд. 7.2) и чертежам исполнений
      const dims = I => I >= 600 ? 'по запросу' : s.pkg === 'IK' ? '1200×1700×2300'
        : s.pkg === 'E' ? (I <= (v === '06' ? 150 : 130) ? '1000×1500×2300' : 'по запросу') : I >= 400 ? '1200×1700×2300' : '1000×1500×2300';
      const suf = s.pkg === 'STD' ? '' : '-' + s.pkg;
      const body = list.map(([I, P]) => ['ESQ F HVS' + v + '-' + String(I).padStart(3, '0') + suf, P + ' кВт', I + ' А', dims(I)]);
      const sel = list.findIndex(([I]) => I === s.I);
      // если не помещается — уменьшаем шаг строк
      table(y + 8, [X0, X0 + 150, X0 + 260, X0 + 350, X1], ['Модель', 'Мощность двигателя', 'Номинальный ток', 'Габариты (Ш×Г×В), мм'], body, sel);
    }
  }

  /* ================= Транспортировка, условия эксплуатации ================= */
  async function drawTransport(doc, shell, p1, p2, s, para, put, W) {
    const X0 = TX0, X1 = TX1, z = 9.4, o = { size: z };
    const h2 = (p, t, y) => { put(p, t, X0, y + z * .95, 9.6, { f: 'S' }); return y + 15; };
    const dash = (p, t, y) => { put(p, '–', X0 + 4, y + z * .95, z); return para(p, X0 + 15, X1, y, t, { ...o, justify: false }) + 2; };
    let y = 134;
    y = h2(p1, '4.1 Осмотр при приёмке', y);
    y = para(p1, X0, X1, y, 'Правильная процедура проверки при приёмке оборудования:', { ...o, indent: 18 }) + 3;
    y = dash(p1, 'проверьте накладную отгрузки и убедитесь в комплектности оборудования;', y);
    y = dash(p1, 'проверьте продукт на предмет наличия повреждений, нанесённых при транспортировке, при их наличии претензии следует направлять в транспортную компанию.', y) + 4;
    y = para(p1, X0, X1, y, 'Примечание: в зависимости от габаритов, структуры и типа УПП блоки могут иметь деревянные подставки, которые убирают в процессе установки.', { ...o, indent: 18 }) + 10;
    y = h2(p1, '4.2 Разгрузка, погрузка, перемещение', y);
    y = para(p1, X0, X1, y, 'Перед началом перемещения необходимо правильно оценить вес оборудования. Поскольку конфигурация конкретного устройства плавного пуска зависит от предъявляемых пользователем требований, его точный вес может варьироваться в зависимости от номинальных значений и параметров оборудования. Размеры и вес системы указаны на заводской упаковке. Для удобства погрузки-разгрузки отверстие для вилочного погрузчика находится в нижней части корпуса шкафа.', { ...o, indent: 18 }) + 3;
    y = para(p1, X0, X1, y, 'При транспортировке используют:', { ...o, indent: 18 });
    y = para(p1, X0, X1, y, 'а) кран или цепной блок для подъёма;', o);
    y = para(p1, X0, X1, y, 'б) вилочный погрузчик.', o) + 12;
    // «ОПАСНО!» — знак как в ТКП на ПЧ
    const H = p1.getHeight(), cx = X0 + 9, cy = y + 9, r = 9;
    p1.drawSvgPath(`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`, { x: 0, y: H, borderColor: DARK, borderWidth: 1.1 });
    put(p1, '!', cx, cy + 4, 11, { f: 'S', a: 'c' });
    put(p1, 'ОПАСНО!', X0 + 26, cy + 4.2, 11, { f: 'S' });
    y += 26;
    y = para(p1, X0, X1, y, 'Запрещено перемещать шкаф УПП за верхнюю часть корпуса и поднимать шкаф за рым-болт. Стропу следует продеть через нижнее отверстие. Ключевые параметры — длина и прочность строп. Стропы должны быть достаточно длинными, чтобы обеспечить минимальное расстояние 1,2 м между подъёмным крюком и верхней частью шкафа во избежание деформации шкафа. Если длины стропы недостаточно, необходимо добавить ребро жёсткости. При подъёме стропа должна проходить через соответствующее отверстие для вилочного погрузчика. Ось гака подъёмного механизма по возможности должна находиться как можно ближе к центру тяжести УПП.', { ...o, indent: 18 });
    const k1 = Math.min(1.25, (712 - y - 26) / 236), g1 = makeG(p1, put, 306 - 135 * k1, y + 12, k1);
    g1.setW(W); figLift(g1);
    put(p1, 'Рис. 1. Вид спереди при подъёме', 306, y + 12 + 236 * k1 + 10, 8.6, { a: 'c' });

    y = 100;
    y = para(p2, X0, X1, y, 'Вилочный автопогрузчик должен иметь соответствующую грузоподъёмность, а длина его вил должна превышать ширину шкафа. В случае если длина корпуса шкафа превышает допустимую, задействуют два вилочных погрузчика.', { ...o, indent: 18 });
    const m2 = await placeCrop(doc, shell.getPage(SH.fork), [62, 186, 504, 414], p2, [X0, y + 10, X1, 385], { max: 1.0, holes: [[413, 211, 494, 227]] });
    { const q = m2(414.3, 222.4); put(p2, 'УПП, вид сбоку', q[0], q[1], 10.2 * m2.k, { f: 'S' }); }
    y = m2(0, 414)[1] + 15;
    put(p2, 'Рис. 2. Перемещение УПП при помощи автопогрузчика', 306, y, 8.6, { a: 'c' });
    y += 10;
    for (const t of ['При перемещении вилочным автопогрузчиком не допускайте повреждения стен шкафа. Для этого между грузом и кареткой вставьте деревянный отбойник. Центр тяжести стандартного шкафа УПП находится возле средней линии между передней и задней панелями.',
      'Во избежание повреждения оборудования во время транспортировки, хранения и установки не допускается попадание воды в УПП. Применяемое подъёмное оборудование должно соответствовать требованиям по грузоподъёмности. Подъём, спуск и перемещение УПП следует выполнять медленно и аккуратно. Перемещение, транспортировку и размещение оборудования следует проводить на ровной горизонтальной площадке.',
      'Запрещается установка и эксплуатация УПП в случае повреждения его элементов.',
      'При монтаже и эксплуатации оборудования всегда устанавливайте закреплённое на месте защитное ограждение со знаком «Опасно! Высокое напряжение!». Не допускайте попадания в УПП посторонних предметов.'])
      y = para(p2, X0, X1, y, t, { ...o, indent: 18 }) + 2;
    y += 14;
    put(p2, '5. Условия эксплуатации', X0, y + 13, 13, { f: 'S', c: ORANGE });
    y += 24;
    for (const t of ['установка в помещении; без прямых солнечных лучей, токопроводящей пыли, агрессивных и горючих газов, масляного и соляного тумана, капель воды;',
      'температура окружающего воздуха — от минус 20 °С до плюс 50 °С;', 'относительная влажность — 5–95%, без образования конденсата;',
      'высота над уровнем моря — до 1500 м (выше — со снижением номинальных характеристик);', 'степень защиты оболочки — ' + s.ip + '.'])
      y = dash(p2, t, y);
  }

  window.downloadTKP = generate;
  window.UPP_DRAW = { makeFonts, makeG, figInstall, figLift, drawScheme };   // для tools/pdf_figs.js (замена рисунков в ТО и РЭ)
})();
