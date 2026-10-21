/* Расчёт энергосбережения от частотного регулирования насосов и вентиляторов (energy.html).

   Q — относительный расход (0…1), hs — относительный статический напор (0…0,9).
   С ПЧ: рабочая точка на характеристике сети H = hs + (1 − hs)·Q²; мощность на валу ∝ Q·H (законы подобия),
         относительная скорость n ≈ √H. КПД механизма принят постоянным.
   Без ПЧ: типовые характеристики способов регулирования (доля мощности на валу при номинальном расходе).
   Электрическая мощность = мощность на валу / КПД двигателя (/ КПД ПЧ для варианта с ПЧ). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'esq.energy';

  const CONTROLS = {
    pump: [
      ['valve', 'Задвижка (дросселирование на напоре)', q => 0.45 + 0.55 * q],
      ['bypass', 'Перепуск (байпас) на всас', () => 1.0],
      ['coupling', 'Гидромуфта', null]
    ],
    fan: [
      ['damper', 'Заслонка (шибер) на выходе', q => 0.55 + 0.45 * q],
      ['vanes', 'Направляющий аппарат (ВНА)', q => 0.35 + 0.15 * q + 0.5 * q * q],
      ['coupling', 'Гидромуфта', null]
    ]
  };
  const CTL_NOTE = {
    valve: 'Насос работает на полной скорости, лишний напор срезается задвижкой.',
    bypass: 'Насос качает полный расход, излишек возвращается на всас — мощность почти не снижается.',
    damper: 'Вентилятор работает на полной скорости, расход снижается заслонкой.',
    vanes: 'Направляющий аппарат закручивает поток на входе — экономичнее заслонки, но хуже регулирования скоростью.',
    coupling: 'Скорость снижается проскальзыванием в муфте: потери скольжения пропорциональны снижению скорости.'
  };
  const PROFILE = {
    pump: [[100, 1000], [90, 1500], [80, 2000], [70, 2000], [60, 1000]],
    fan: [[100, 500], [90, 1000], [80, 2000], [70, 2000], [60, 1500], [50, 1000]]
  };
  const DEFAULTS = { mech: 'pump', ctl: 'valve', kw: 1000, volt: 'T060', load: 85, hst: 20, etaM: 95, tariff: 7.5, cost: '', etaV: 96.5, years: 10 };

  const num = (v, d = 0) => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : d; };
  const fmt = (x, d = 0) => isFinite(x) ? x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- модель ---------- */
  function shareVfd(q, hs) { return q * (hs + (1 - hs) * q * q); }                 // доля мощности на валу с ПЧ
  function shareNow(ctl, mech, q, hs) {
    if (ctl === 'coupling') { const n = Math.sqrt(hs + (1 - hs) * q * q); return shareVfd(q, hs) / Math.max(n, 0.2) + 0.02; }
    const c = CONTROLS[mech].find(x => x[0] === ctl);
    return c ? c[2](q) : 1;
  }
  function calc(st, rows) {
    const p100 = st.kw * st.load / 100, hs = st.mech === 'fan' ? 0 : st.hst / 100, eM = st.etaM / 100, eV = st.etaV / 100;
    const res = rows.filter(r => r.h > 0 && r.q > 0).map(r => {
      const q = Math.min(r.q, 120) / 100;
      const now = p100 * shareNow(st.ctl, st.mech, q, hs) / eM;
      const vfd = p100 * shareVfd(q, hs) / (eM * eV);
      return { q: r.q, h: r.h, now, vfd, dkw: now - vfd, dkwh: (now - vfd) * r.h };
    });
    const sum = k => res.reduce((a, r) => a + r[k], 0);
    const hours = sum('h'), eNow = res.reduce((a, r) => a + r.now * r.h, 0), eVfd = res.reduce((a, r) => a + r.vfd * r.h, 0);
    const save = eNow - eVfd, rub = save * st.tariff, cost = num(st.cost);
    return { res, hours, eNow, eVfd, save, rub, pct: eNow ? save / eNow * 100 : 0, cost, pay: cost && rub > 0 ? cost / rub : NaN, net: rub * st.years - cost };
  }

  /* ---------- состояние формы ---------- */
  const FIELDS = ['mech', 'ctl', 'kw', 'volt', 'load', 'hst', 'etaM', 'tariff', 'cost', 'etaV', 'years'];
  function readForm() {
    const st = {};
    FIELDS.forEach(f => { st[f] = ['mech', 'ctl', 'volt', 'cost'].includes(f) ? $(f).value : num($(f).value, DEFAULTS[f]); });
    return st;
  }
  function readRows() {
    return Array.from($('sched').querySelectorAll('tr')).map(tr => ({ q: num(tr.querySelector('.q').value), h: num(tr.querySelector('.h').value) }));
  }
  function fillCtl(mech, keep) {
    const sel = $('ctl');
    sel.innerHTML = CONTROLS[mech].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    if (keep && CONTROLS[mech].some(c => c[0] === keep)) sel.value = keep;
  }
  function addRow(q = '', h = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="number" class="q" min="10" max="120" step="1" value="${q}"></td>` +
      `<td><input type="number" class="h" min="0" max="8760" step="10" value="${h}"></td>` +
      '<td><button type="button" class="del" title="Удалить режим" aria-label="Удалить режим">×</button></td>';
    tr.querySelector('.del').onclick = () => { tr.remove(); update(); };
    $('sched').appendChild(tr);
  }
  function setRows(rows) { $('sched').innerHTML = ''; rows.forEach(([q, h]) => addRow(q, h)); }

  function load() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const st = Object.assign({}, DEFAULTS, saved && saved.st);
    const q = new URLSearchParams(location.search);                     // из конфигуратора: ?kw=…&v=…
    if (q.get('kw')) st.kw = num(q.get('kw'), st.kw);
    if (q.get('v')) st.volt = q.get('v');
    $('mech').value = st.mech; fillCtl(st.mech, st.ctl);
    FIELDS.forEach(f => { if (f !== 'mech' && f !== 'ctl') $(f).value = st[f]; });
    setRows(saved && saved.rows && saved.rows.length ? saved.rows : PROFILE[st.mech]);
  }
  function save(st, rows) { try { localStorage.setItem(KEY, JSON.stringify({ st, rows: rows.map(r => [r.q, r.h]) })); } catch (e) {} }

  /* ---------- вывод ---------- */
  function chart(res, ctlName) {
    if (!res.length) { $('chart').innerHTML = '<p class="muted">Добавьте хотя бы один режим работы.</p>'; return; }
    const W = 760, H = 260, L = 52, B = 34, T = 14, max = Math.max(...res.map(r => r.now), 1) * 1.08;
    const gw = (W - L - 10) / res.length, bw = Math.min(30, gw * .32), y = v => T + (H - T - B) * (1 - v / max);
    const step = Math.pow(10, Math.floor(Math.log10(max / 4))), tick = [1, 2, 2.5, 5, 10].map(k => k * step).find(t => max / t <= 6) || step * 10;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Мощность по режимам: сейчас и с ПЧ">`;
    for (let v = 0; v <= max; v += tick) s += `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${fmt(v)}</text>`;
    res.forEach((r, i) => {
      const cx = L + gw * i + gw / 2;
      s += `<rect x="${cx - bw - 2}" y="${y(r.now)}" width="${bw}" height="${y(0) - y(r.now)}" class="b-cur" rx="3"><title>${esc(ctlName)}: ${fmt(r.now)} кВт</title></rect>`;
      s += `<rect x="${cx + 2}" y="${y(r.vfd)}" width="${bw}" height="${y(0) - y(r.vfd)}" class="b-vfd" rx="3"><title>С ПЧ: ${fmt(r.vfd)} кВт</title></rect>`;
      s += `<text x="${cx}" y="${H - B + 18}" class="ax" text-anchor="middle">${fmt(r.q)} %</text>`;
    });
    s += `<text x="${L}" y="${T - 2}" class="ax">кВт</text></svg>`;
    $('chart').innerHTML = s;
  }

  function update() {
    const st = readForm(), rows = readRows(), r = calc(st, rows), ctlName = $('ctl').selectedOptions[0].text;
    save(st, rows);
    $('hoursTotal').textContent = 'Всего: ' + fmt(r.hours) + ' ч/год' + (r.hours > 8760 ? ' — больше, чем часов в году!' : '');
    $('hoursTotal').classList.toggle('warn', r.hours > 8760);
    $('ctlNote').textContent = CTL_NOTE[st.ctl] || '';
    $('hst').closest('.param').style.display = st.mech === 'fan' ? 'none' : '';
    $('rKwh').textContent = fmt(r.save / 1000) + ' тыс. кВт·ч/год';
    $('rRub').textContent = fmt(r.rub / 1e6, 2) + ' млн руб.';
    $('rPct').textContent = fmt(r.pct, 0) + ' %';
    $('rPay').textContent = isFinite(r.pay) ? (r.pay < 1 ? fmt(r.pay * 12, 0) + ' мес.' : fmt(r.pay, 1) + ' года') : (r.cost ? 'не окупается' : 'укажите стоимость ПЧ');
    $('rHorizonL').textContent = 'Чистая экономия за ' + st.years + ' ' + (st.years % 10 === 1 && st.years !== 11 ? 'год' : st.years % 10 >= 2 && st.years % 10 <= 4 && (st.years < 12 || st.years > 14) ? 'года' : 'лет');
    $('rHorizon').textContent = fmt(r.net / 1e6, 1) + ' млн руб.';
    $('lgCur').textContent = 'Сейчас: ' + ctlName.toLowerCase();
    chart(r.res, ctlName);
    $('resBody').innerHTML = r.res.map(x => `<tr><td>${fmt(x.q)} %</td><td>${fmt(x.h)}</td><td>${fmt(x.now)}</td><td>${fmt(x.vfd)}</td><td>${fmt(x.dkw)}</td><td>${fmt(x.dkwh / 1000, 1)}</td></tr>`).join('');
    $('resFoot').innerHTML = `<tr><td>Итого</td><td>${fmt(r.hours)}</td><td colspan="2">${fmt(r.eNow / 1000)} → ${fmt(r.eVfd / 1000)} тыс. кВт·ч</td><td></td><td>${fmt(r.save / 1000, 1)}</td></tr>`;
    const qs = new URLSearchParams({ mpKw: String(st.kw), v: st.volt, mpLoad: '0' });
    $('toConf').href = 'configurator_vv_pch.html?' + qs.toString();
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    $('mech').addEventListener('change', () => { fillCtl($('mech').value); setRows(PROFILE[$('mech').value]); update(); });
    document.querySelector('.form-col').addEventListener('input', update);
    document.querySelector('.form-col').addEventListener('change', update);
    $('addRow').onclick = () => { addRow(50, 500); update(); };
    $('reset').onclick = e => { e.preventDefault(); try { localStorage.removeItem(KEY); } catch (x) {} location.href = location.pathname; };
    update();
  });
  window.__energyCalc = calc;                                        // для автопроверки (tests/)
})();
