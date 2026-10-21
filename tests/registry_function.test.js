/* Проверка облачной функции реестра (cloud/registry/index.js) на локальном макете Object Storage.
   Запуск: node tests/registry_function.test.js */
'use strict';
const http = require('http'), assert = require('assert');

// макет S3: PUT / GET / DELETE объекта и ListObjectsV2 (страницы по max-keys); проверяет заголовок Authorization
const store = new Map();
const srv = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer TEST-TOKEN') { res.writeHead(403); return res.end('no auth'); }
  const u = new URL(req.url, 'http://x'), [, bucket, ...rest] = u.pathname.split('/'), key = decodeURIComponent(rest.join('/'));
  if (bucket !== 'esq-reg') { res.writeHead(404); return res.end('NoSuchBucket'); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.method === 'PUT') { store.set(key, body); res.writeHead(200); return res.end(); }
    if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && key) { if (!store.has(key)) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(store.get(key)); }
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const p = u.searchParams.get('prefix') || '', max = +u.searchParams.get('max-keys') || 1000, from = +(u.searchParams.get('continuation-token') || 0);
      const all = [...store.keys()].filter(k => k.startsWith(p)).sort(), page = all.slice(from, from + max), more = from + max < all.length;
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<ListBucketResult>${page.map(k => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + max}</NextContinuationToken>` : ''}</ListBucketResult>`);
    }
    res.writeHead(400); res.end();
  });
});

(async () => {
  await new Promise(r => srv.listen(0, r));
  Object.assign(process.env, { S3_ENDPOINT: 'http://127.0.0.1:' + srv.address().port, BUCKET: 'esq-reg', REGISTRY_PASSWORD: 'secret' });
  const { handler } = require('../cloud/registry/index.js');
  const call = async (body, b64) => {
    const raw = JSON.stringify(body);
    const r = await handler({ httpMethod: 'POST', body: b64 ? Buffer.from(raw).toString('base64') : raw, isBase64Encoded: !!b64 }, { token: { access_token: 'TEST-TOKEN' } });
    return { code: r.statusCode, ...JSON.parse(r.body) };
  };
  let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok  ', m); };

  ok((await call({ action: 'ping', password: 'secret' })).ok, 'пароль принимается');
  ok((await call({ action: 'ping', password: 'nope' })).code === 403, 'неверный пароль отклоняется');
  const e1 = { id: 'abc123', at: new Date().toISOString(), product: 'ВВ ПЧ', mark: 'ESQ F ME800-R-1000P120AT060AL30XXX31XXDMRAX-EB', who: 'Иванов И.И.', qty: 1, price: 30000000,
    total: 30900000, extra: [{ name: 'Комплект ЗИП', qty: 1, unit: 'компл.', price: 900000 }], fmt: 'PDF', link: 'https://x/?cfg=1', evil: '<script>' };
  ok((await call({ action: 'registry_add', entry: e1 }, true)).ok, 'запись добавляется (тело в base64, как присылает шлюз)');
  ok((await call({ action: 'registry_add', entry: e1 })).ok && store.size === 1, 'повторная отправка той же записи не создаёт дубль');
  ok((await call({ action: 'registry_add', entry: { id: 'x' } })).code === 400, 'запись без маркировки отклоняется');
  ok((await call({ action: 'registry_list', password: 'nope' })).code === 403, 'список без пароля не выдаётся');
  let L = await call({ action: 'registry_list', password: 'secret', days: 30 });
  ok(L.ok && L.entries.length === 1 && L.entries[0].extra[0].name === 'Комплект ЗИП' && !('evil' in L.entries[0]), 'список: запись на месте, лишние поля отброшены');

  const old = Array.from({ length: 1205 }, (_, i) => ({ id: 'old' + i, at: new Date(Date.UTC(2025, i % 12, 1 + (i % 27), 9)).toISOString(), product: 'ВВ УПП', mark: 'ESQ F HVS06-075', qty: 1, fmt: 'PDF' }));
  let added = 0;
  for (let i = 0; i < old.length; i += 500) added += (await call({ action: 'registry_import', password: 'secret', entries: old.slice(i, i + 500) })).added;
  ok(added === 1205, 'импорт 1205 записей пачками по 500');
  L = await call({ action: 'registry_list', password: 'secret', days: 0 });
  ok(L.entries.length === 1206 && L.entries[0].at <= L.entries[1205].at, 'весь реестр (больше 1000 объектов — постраничный список), по дате');
  L = await call({ action: 'registry_list', password: 'secret', days: 30 });
  ok(L.entries.length === 1, 'фильтр «последние 30 дней»');
  ok((await call({ action: 'registry_delete', password: 'secret', id: 'abc123', at: e1.at })).ok, 'удаление');
  L = await call({ action: 'registry_list', password: 'secret', days: 30 });
  ok(L.entries.length === 0, 'после удаления записи нет');
  const r = await handler({ httpMethod: 'OPTIONS' }, {});
  ok(r.statusCode === 204 && r.headers['Access-Control-Allow-Origin'], 'CORS для браузера');
  console.log(`\nфункция реестра: ${n} проверок пройдено`);
  srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
