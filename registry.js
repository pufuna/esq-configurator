/* Реестр выданных ТКП.

   Каждое успешно сформированное ТКП (PDF или Word) записывается генераторами tkp.js / tkp_upp.js:
   дата, составитель, изделие, маркировка, количество, цены, доп. позиции, формат и ссылка на конфигурацию.

   • Всегда — в этом браузере (localStorage, до 2000 записей).
   • Если задан адрес функции общего реестра (REGISTRY_FUNCTION_URL ниже или window.REGISTRY_URL) —
     запись отправляется и туда (функция — cloud/registry). Если связи нет, запись остаётся «не отправленной»
     и уходит при следующем открытии любой страницы сайта с реестром. */
(function () {
  'use strict';
  /* ↓↓↓ адрес функции общего реестра (https://functions.yandexcloud.net/…); пусто — реестр только в браузере */
  const REGISTRY_FUNCTION_URL = 'https://functions.yandexcloud.net/d4evqb70lqivk4dvvq4d';

  const URL_ = window.REGISTRY_URL || REGISTRY_FUNCTION_URL;
  const KEY = 'esq.registry', MAX = 2000;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); return true; } catch (e) { return false; } };

  async function api(body) {
    if (!URL_) throw new Error('общий реестр не подключён');
    const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.ok) { const err = new Error((j && j.error) || ('ошибка ' + r.status)); err.status = r.status; throw err; }
    return j;
  }
  const strip = e => { const c = Object.assign({}, e); delete c.sent; return c; };
  function markSent(ids) { const set = new Set(ids); write(read().map(e => set.has(e.id) ? Object.assign(e, { sent: true }) : e)); }

  async function send(entry) {
    try { await api({ action: 'registry_add', entry: strip(entry) }); markSent([entry.id]); return true; }
    catch (e) { console.warn('Реестр: запись не отправлена, повторю позже —', e.message); return false; }
  }
  function add(e) {
    const entry = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString() }, e, { sent: false });
    const list = read(); list.push(entry); write(list);
    if (URL_) send(entry);
    return entry;
  }
  // дослать то, что не ушло (без связи, сайт закрыли раньше ответа и т. п.)
  async function flush() {
    if (!URL_) return 0;
    let n = 0;
    for (const e of read().filter(x => x.sent === false).slice(-50)) if (await send(e)) n++;
    return n;
  }

  // общий реестр (нужен пароль сотрудника)
  const shared = {
    on: !!URL_,
    ping: password => api({ action: 'ping', password }),
    list: (password, days) => api({ action: 'registry_list', password, days }).then(j => j.entries),
    del: (password, e) => api({ action: 'registry_delete', password, id: e.id, at: e.at }),
    async import(password, entries, progress) {                         // пачками, чтобы запрос не был слишком большим
      let added = 0;
      for (let i = 0; i < entries.length; i += 100) {
        added += (await api({ action: 'registry_import', password, entries: entries.slice(i, i + 100).map(strip) })).added;
        if (progress) progress(Math.min(i + 100, entries.length), entries.length);
      }
      return added;
    }
  };

  // ссылка на текущую конфигурацию (formstate.js) — чтобы из реестра открыть то же самое
  const link = () => (window.FormStateLink ? window.FormStateLink() : location.href);

  /* Ссылки «Реестр выданных ТКП» (a.reg-link) скрыты у всех, кроме тех, кто входил в реестр с паролем в этом браузере.
     Это только видимость: сам реестр без пароля не открывается (registry.html, облачная функция). */
  const ACCESS = 'esq.regAccess';
  function access(on) {
    if (on !== undefined) { try { on ? localStorage.setItem(ACCESS, '1') : localStorage.removeItem(ACCESS); } catch (e) {} }
    let ok = false; try { ok = localStorage.getItem(ACCESS) === '1'; } catch (e) {}
    document.querySelectorAll('a.reg-link').forEach(a => { a.hidden = !ok; });
    return ok;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => access()); else access();

  window.TkpRegistry = { add, read, write, link, flush, markSent, shared, access, KEY };
  if (URL_) window.addEventListener('load', () => setTimeout(flush, 1500));
})();
