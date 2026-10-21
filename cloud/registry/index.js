/* Общий реестр выданных ТКП — облачная функция Yandex Cloud Functions (среда Node.js 18 и новее).
   Развёртывание — cloud/registry/README.md.

   Хранение: бакет Object Storage, одна запись — один JSON-объект e/ГГГГ-ММ/<дата>_<id>.json.
   Повторная отправка той же записи перезаписывает тот же объект, поэтому дублей не бывает.
   Доступ к бакету — служебным токеном функции (сервисному аккаунту функции нужна роль storage.editor);
   ключи доступа и сторонние библиотеки не нужны.

   Переменные окружения функции:
     BUCKET             — имя бакета (обязательно);
     REGISTRY_PASSWORD  — пароль сотрудника для просмотра, удаления и импорта (обязательно);
     ALLOW_ORIGIN       — с какого сайта разрешены запросы, например https://pufuna.github.io (по умолчанию — с любого).

   Запрос — POST, тело JSON { action, ... }:
     ping            { password }                  → { ok }               проверка пароля
     registry_add    { entry }                     → { ok, id }           запись о скачанном ТКП (без пароля — пишет сам сайт)
     registry_list   { password, days? }           → { ok, entries }      список; days — за сколько последних дней (0 — за всё время)
     registry_delete { password, id, at }          → { ok }
     registry_import { password, entries: [...] }  → { ok, added }        перенос записей из браузеров (до 500 за раз) */
'use strict';

const S3 = process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net';   // S3_ENDPOINT — только для автотеста
const MAX_BODY = 200 * 1024;                        // одна запись — меньше 10 КБ; импорт — до 200 КБ за запрос
const FIELDS = { product: 40, model: 40, mark: 120, who: 80, fmt: 10, link: 1500 };

function reply(code, obj) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(obj)
  };
}

// запись приводим к известному виду: только нужные поля, ограниченной длины — в реестр не попадёт ничего лишнего
function clean(e) {
  if (!e || typeof e !== 'object') return null;
  const at = new Date(e.at || Date.now());
  if (isNaN(at)) return null;
  const out = {
    id: String(e.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24) || Date.now().toString(36),
    at: at.toISOString()
  };
  for (const [k, n] of Object.entries(FIELDS)) out[k] = String(e[k] ?? '').slice(0, n);
  for (const k of ['kv', 'P', 'I', 'qty', 'price', 'total']) { const v = Number(e[k]); out[k] = isFinite(v) ? v : 0; }
  out.extra = (Array.isArray(e.extra) ? e.extra : []).slice(0, 30).map(x => ({
    name: String(x && x.name || '').slice(0, 300), qty: Number(x && x.qty) || 1,
    unit: String(x && x.unit || 'шт').slice(0, 20), price: Number(x && x.price) || 0
  }));
  if (!out.mark) return null;
  return out;
}
const keyOf = e => `e/${e.at.slice(0, 7)}/${e.at.replace(/[:.]/g, '-')}_${e.id}.json`;

/* ---------- Object Storage (S3 API) с IAM-токеном функции ---------- */
function s3(token) {
  const bucket = process.env.BUCKET;
  const call = async (method, path, body) => {
    const r = await fetch(`${S3}/${bucket}${path}`, {
      method, body,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
    });
    if (!r.ok && !(method === 'DELETE' && r.status === 404)) throw new Error(`Object Storage: ${method} ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  return {
    put: (key, obj) => call('PUT', '/' + key, JSON.stringify(obj)),
    get: async key => JSON.parse(await (await call('GET', '/' + key)).text()),
    del: key => call('DELETE', '/' + key),
    async list(prefix) {                                            // все ключи с префиксом (ListObjectsV2, страницами по 1000)
      const keys = []; let token = '';
      for (;;) {
        const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
        if (token) q.set('continuation-token', token);
        const xml = await (await call('GET', '/?' + q.toString())).text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
        const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
        if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) break;
        token = next[1].replace(/&amp;/g, '&');
      }
      return keys;
    }
  };
}

// префиксы месяцев за последние days дней (0 — весь реестр)
function monthPrefixes(days) {
  if (!days) return ['e/'];
  const out = [], now = new Date(), from = new Date(now.getTime() - days * 864e5);
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= now; d.setUTCMonth(d.getUTCMonth() + 1))
    out.push('e/' + d.toISOString().slice(0, 7) + '/');
  return out;
}
async function pool(items, n, fn) {                                 // не больше n запросов одновременно
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } }
  }));
  return out;
}

module.exports.handler = async function (event, context) {
  if ((event.httpMethod || '').toUpperCase() === 'OPTIONS') return reply(204, {});
  if (!process.env.BUCKET || !process.env.REGISTRY_PASSWORD) return reply(500, { ok: false, error: 'Функция не настроена: задайте BUCKET и REGISTRY_PASSWORD' });
  const token = context && context.token && context.token.access_token;
  if (!token) return reply(500, { ok: false, error: 'У функции нет сервисного аккаунта — назначьте его в настройках версии' });

  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > MAX_BODY) return reply(413, { ok: false, error: 'Слишком большой запрос' });
  let q; try { q = JSON.parse(raw || '{}'); } catch (e) { return reply(400, { ok: false, error: 'Тело запроса — не JSON' }); }

  const authed = q.password && q.password === process.env.REGISTRY_PASSWORD;
  const need = () => reply(403, { ok: false, error: 'Неверный пароль' });
  const st = s3(token);
  try {
    switch (q.action) {
      case 'ping':
        return authed ? reply(200, { ok: true }) : need();

      case 'registry_add': {
        const e = clean(q.entry);
        if (!e) return reply(400, { ok: false, error: 'Пустая или неверная запись' });
        await st.put(keyOf(e), e);
        return reply(200, { ok: true, id: e.id });
      }

      case 'registry_list': {
        if (!authed) return need();
        const days = Math.max(0, Math.min(3650, Number(q.days) || 0));
        const keys = (await Promise.all(monthPrefixes(days).map(p => st.list(p)))).flat();
        const entries = (await pool(keys, 32, k => st.get(k))).filter(Boolean)
          .filter(e => !days || new Date(e.at) >= new Date(Date.now() - days * 864e5))
          .sort((a, b) => (a.at < b.at ? -1 : 1));
        return reply(200, { ok: true, entries });
      }

      case 'registry_delete': {
        if (!authed) return need();
        const e = clean({ id: q.id, at: q.at, mark: 'x' });
        if (!e || !q.id) return reply(400, { ok: false, error: 'Нужны id и at записи' });
        await st.del(keyOf(e));
        return reply(200, { ok: true });
      }

      case 'registry_import': {
        if (!authed) return need();
        const list = (Array.isArray(q.entries) ? q.entries : []).slice(0, 500).map(clean).filter(Boolean);
        const done = await pool(list, 16, e => st.put(keyOf(e), e).then(() => 1));
        return reply(200, { ok: true, added: done.filter(Boolean).length });
      }

      default:
        return reply(400, { ok: false, error: 'Неизвестное действие: ' + q.action });
    }
  } catch (err) {
    console.error(err);
    return reply(502, { ok: false, error: String(err.message || err) });
  }
};
