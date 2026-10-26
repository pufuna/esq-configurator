/* Проверка облачной функции реестра (cloud/registry/index.js) на локальном макете Object Storage.
   Запуск: node tests/registry_function.test.js */
'use strict';
const http = require('http'), assert = require('assert');

// макет S3: PUT / GET / DELETE объекта и ListObjectsV2 (страницы по max-keys); проверяет заголовок Authorization
const store = new Map();
let gets = 0;                                                       // сколько объектов прочитано поштучно
const srv = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer TEST-TOKEN') { res.writeHead(403); return res.end('no auth'); }
  const u = new URL(req.url, 'http://x'), [, bucket, ...rest] = u.pathname.split('/'), key = decodeURIComponent(rest.join('/'));
  if (bucket !== 'esq-reg') { res.writeHead(404); return res.end('NoSuchBucket'); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.method === 'PUT') { store.set(key, body); res.writeHead(200); return res.end(); }
    if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && key) { gets++; if (!store.has(key)) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(store.get(key)); }
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
  const call = async (body, b64, ip) => {
    const raw = JSON.stringify(body);
    const r = await handler({ httpMethod: 'POST', body: b64 ? Buffer.from(raw).toString('base64') : raw, isBase64Encoded: !!b64,
      requestContext: { identity: { sourceIp: ip || '10.0.0.1' } } }, { token: { access_token: 'TEST-TOKEN' } });
    return { code: r.statusCode, ...JSON.parse(r.body) };
  };
  let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok  ', m); };

  ok((await call({ action: 'ping', password: 'secret' })).ok, 'пароль принимается');
  ok((await call({ action: 'ping', password: 'nope' })).code === 403, 'неверный пароль отклоняется');
  const e1 = { id: 'abc123', at: new Date().toISOString(), product: 'ВВ ПЧ', mark: 'ESQ F ME800-R-1000P120AT060AL30XXX31XXDMRAX-EB', who: 'Иванов И.И.', qty: 1, price: 30000000,
    total: 30900000, extra: [{ name: 'Комплект ЗИП', qty: 1, unit: 'компл.', price: 900000 }], fmt: 'PDF', link: 'https://x/?cfg=1', evil: '<script>' };
  ok((await call({ action: 'registry_add', entry: e1 }, true)).ok, 'запись добавляется (тело в base64, как присылает шлюз)');
  ok((await call({ action: 'registry_add', entry: e1 })).ok && [...store.keys()].filter(k => k.startsWith('e/')).length === 1, 'повторная отправка той же записи не создаёт дубль');
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

  // ---- работа всей компании: подбор пароля, общий внешний адрес офиса, одновременные запросы, большой реестр ----
  const office = '203.0.113.7', other = '198.51.100.20';
  let codes = [];
  for (let i = 0; i < 9; i++) codes.push((await call({ action: 'ping', password: 'typo' + i }, false, office)).code);
  ok(codes.every(c => c === 403), '9 неверных паролей подряд — ещё не блокировка (опечатки коллег за одним адресом офиса)');
  ok((await call({ action: 'ping', password: 'secret' }, false, office)).ok, 'верный пароль сбрасывает счётчик ошибок');
  codes = [];
  for (let i = 0; i < 10; i++) codes.push((await call({ action: 'ping', password: 'guess' + i }, false, office)).code);
  ok(codes.slice(0, 9).every(c => c === 403) && codes[9] === 429, '10-й неверный пароль за 15 минут — адрес заблокирован');
  let B = await call({ action: 'registry_list', password: 'secret' }, false, office);
  ok(B.code === 429 && /15 мин/.test(B.error), 'во время блокировки не пускает даже с верным паролем: ' + B.error);
  ok((await call({ action: 'ping', password: 'secret' }, false, other)).ok, 'другой адрес блокировка не задевает');
  ok((await call({ action: 'registry_add', entry: { id: 'lk1', mark: 'ESQ F HVS06-075', who: 'Петров П.П.' } }, false, office)).ok,
    'запись о скачанном ТКП проходит и при блокировке (сайт пишет реестр без пароля)');
  const ak = [...store.keys()].find(k => k.startsWith('a/'));
  ok(ak && !store.get(ak).includes(office), 'адрес в счётчике не хранится — только хэш');
  const expireLocks = () => { for (const k of store.keys()) if (k.startsWith('a/')) { const x = JSON.parse(store.get(k)); x.until = Date.now() - 1; store.set(k, JSON.stringify(x)); } };
  expireLocks();                                                    // прошло 15 минут
  ok((await call({ action: 'ping', password: 'secret' }, false, office)).ok, 'после окончания блокировки верный пароль снова принимается');
  for (let i = 0; i < 10; i++) await call({ action: 'ping', password: 'x' + i }, false, other);
  expireLocks();
  codes = [];
  for (let i = 0; i < 10; i++) codes.push((await call({ action: 'ping', password: 'y' + i }, false, other)).code);
  B = await call({ action: 'ping', password: 'secret' }, false, other);
  ok(codes[9] === 429 && /30 мин/.test(B.error), 'повторный подбор — блокировка вдвое дольше: ' + B.error);

  const managers = ['Иванов И.И.', 'Петров П.П.', 'Сидоров С.С.', 'Кузнецова А.В.', 'Смирнов Д.А.'];
  const burst = Array.from({ length: 60 }, (_, i) => ({ id: 'burst' + i, at: new Date().toISOString(), product: i % 2 ? 'ВВ ПЧ' : 'ВВ УПП',
    mark: 'ESQ F HVS06-0' + (50 + i), who: managers[i % managers.length], qty: 1, price: 1e6 + i, fmt: 'PDF' }));
  const res = await Promise.all(burst.map((e, i) => call({ action: 'registry_add', entry: e }, false, '10.1.0.' + (i % managers.length))));
  L = await call({ action: 'registry_list', password: 'secret', days: 30 }, false, '10.9.9.9');
  ok(res.every(x => x.ok) && burst.every(e => L.entries.some(x => x.id === e.id)), '60 ТКП от 5 менеджеров одновременно — все в реестре');
  const lists = await Promise.all(Array.from({ length: 8 }, () => call({ action: 'registry_list', password: 'secret', days: 0 }, false, '10.9.9.9')));
  ok(lists.every(x => x.ok && x.entries.length === lists[0].entries.length) && new Set(lists[0].entries.map(e => e.id)).size === lists[0].entries.length,
    '8 сотрудников открывают реестр одновременно — у всех одинаковый список без дублей (' + lists[0].entries.length + ' записей)');
  gets = 0;
  L = await call({ action: 'registry_list', password: 'secret', days: 0 }, false, '10.9.9.9');
  const months = new Set(L.entries.map(e => e.at.slice(0, 7))).size;
  ok(gets <= months + 2, `реестр за всё время — из кэша по месяцам: ${gets} чтений на ${L.entries.length} записей`);
  await call({ action: 'registry_delete', password: 'secret', id: 'burst0', at: burst[0].at }, false, '10.9.9.9');
  await call({ action: 'registry_add', entry: { id: 'late1', at: '2025-03-05T10:00:00Z', mark: 'ESQ F HVS10-500', who: 'Иванов И.И.' } }, false, '10.1.0.1');
  L = await call({ action: 'registry_list', password: 'secret', days: 0 }, false, '10.9.9.9');
  ok(!L.entries.some(e => e.id === 'burst0') && L.entries.some(e => e.id === 'late1'), 'кэш не прячет удаление и запись задним числом');

  const r = await handler({ httpMethod: 'OPTIONS' }, {});
  ok(r.statusCode === 204 && r.headers['Access-Control-Allow-Origin'], 'CORS для браузера');
  console.log(`\nфункция реестра: ${n} проверок пройдено`);
  srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
