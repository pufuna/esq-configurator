/* Сохранение конфигурации и ссылка на неё — общий модуль для конфигураторов ПЧ и УПП.

   • Форма (все select/input с id в .form-col и доп. строки таблицы ТКП) запоминается в браузере
     и восстанавливается при следующем открытии страницы.
   • «Скопировать ссылку» — адрес страницы с параметрами конфигурации (?cfg=1&voltage=…).
     В ссылку не попадают составитель, цена, количество и доп. строки ТКП — только сама конфигурация.
   • «Сбросить» — забыть сохранённое и открыть страницу с настройками по умолчанию.

   Значения восстанавливаются в порядке полей на странице с событием change —
   так срабатывают те же пересчёты, что и при ручном выборе (модель → напряжение → мощность → …). */
(function () {
  'use strict';
  const PRIVATE = ['tkpAuthor', 'tkpPrice', 'tkpQty'];             // не передаются по ссылке

  window.FormState = function (key) {
    const scope = document.querySelector('.form-col');
    if (!scope) return;
    const fields = () => Array.from(scope.querySelectorAll('select[id], input[id], textarea[id]'))
      .filter(el => !el.readOnly && el.type !== 'password');
    const store = {
      get() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
      set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* приватный режим и т. п. */ } },
      del() { try { localStorage.removeItem(key); } catch (e) {} }
    };

    function collect() {
      const st = { v: {} };
      fields().forEach(el => { st.v[el.id] = el.value; });
      if (window.getTkpExtras) st.extra = window.getTkpExtras();
      if (window.getTkpModels) st.models = window.getTkpModels();
      return st;
    }

    function apply(st) {
      if (!st || !st.v) return;
      fields().forEach(el => {
        if (!(el.id in st.v)) return;
        const val = String(st.v[el.id]);
        if (el.tagName === 'SELECT') {
          if (el.disabled || el.value === val) return;
          const opt = Array.from(el.options).find(o => o.value === val);
          if (!opt || opt.disabled) return;
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.value !== val) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));             // подсказки у полей (габариты, масса) пересчитываются
        }
      });
      if (window.updateNomenclature) window.updateNomenclature();          // маркировка зависит и от текстовых полей (выходное напряжение)
      if (Array.isArray(st.extra) && window.addExtraRow) {
        const box = document.getElementById('tkpExtras');
        if (box && !box.children.length) st.extra.forEach(r => window.addExtraRow(r, true));
      }
      if (Array.isArray(st.models) && window.addTkpModelRow) {
        const box = document.getElementById('tkpModels');
        if (box && !box.children.length) st.models.forEach(m => window.addTkpModelRow(m));
      }
    }

    // снимок конфигурации и её применение — для ТКП на несколько моделей (tkp.js). Применяется дважды:
    // поля зависят друг от друга (модель → напряжение → мощность → тип конденсаторов → пульсность …)
    window.FormStateSnapshot = () => collect().v;
    window.FormStateApply = v => {
      const was = restoring; restoring = true;
      try { apply({ v }); apply({ v }); } finally { restoring = was; }
    };

    let restoring = false, t = null;
    const save = () => { if (restoring) return; clearTimeout(t); t = setTimeout(() => store.set(collect()), 150); };

    // восстановление: ссылка (?cfg=1) → сохранённое в браузере
    const q = new URLSearchParams(location.search);
    restoring = true;
    try {
      if (q.get('cfg') === '1') {
        const v = {}; q.forEach((val, k) => { if (k !== 'cfg') v[k] = val; });
        const saved = store.get();                                    // составителя оставляем своего
        if (saved && saved.v) PRIVATE.forEach(id => { if (id in saved.v) v[id] = saved.v[id]; });
        apply({ v });
      } else apply(store.get());
    } finally { restoring = false; }

    scope.addEventListener('change', save);
    scope.addEventListener('input', save);
    scope.addEventListener('click', e => { if (e.target.closest('.ex-del, .add-row, .md-del, .md-add')) setTimeout(save, 0); });
    save();

    // ссылка на текущую конфигурацию (её же сохраняет реестр ТКП)
    window.FormStateLink = () => {
      const p = new URLSearchParams({ cfg: '1' });
      fields().forEach(el => { if (!PRIVATE.includes(el.id) && el.tagName === 'SELECT') p.set(el.id, el.value); });
      return location.origin + location.pathname + '?' + p.toString();
    };

    // кнопки в карточке «Итог»
    const btns = document.querySelector('.result-card .btns');
    if (!btns) return;
    const row = document.createElement('div');
    row.className = 'fs-row';
    row.innerHTML = '<a href="#" class="fs-link">Скопировать ссылку на конфигурацию</a><a href="#" class="fs-reset">Сбросить</a>';
    btns.appendChild(row);
    const st = document.createElement('style');
    st.textContent = '.fs-row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:2px;font-size:13px}' +
      '.fs-row a{color:var(--teal);text-decoration:none;font-weight:500}.fs-row a:hover{text-decoration:underline}.fs-row .fs-reset{color:var(--muted)}';
    document.head.appendChild(st);

    row.querySelector('.fs-link').addEventListener('click', async e => {
      e.preventDefault();
      const url = window.FormStateLink();
      const a = e.currentTarget, txt = a.textContent;
      try { await navigator.clipboard.writeText(url); a.textContent = 'Ссылка скопирована ✓'; }
      catch (err) { window.prompt('Ссылка на конфигурацию:', url); }
      setTimeout(() => { a.textContent = txt; }, 2000);
    });
    row.querySelector('.fs-reset').addEventListener('click', e => {
      e.preventDefault();
      if (!confirm('Сбросить конфигурацию и данные для ТКП к значениям по умолчанию?')) return;
      store.del();
      clearTimeout(t); restoring = true;                              // не пересохранять при уходе со страницы
      location.href = location.pathname;
    });
  };
})();
