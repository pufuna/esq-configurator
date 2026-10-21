/* Локальный стенд общего реестра для автотеста: макет Object Storage + облачная функция cloud/registry за HTTP.
   Запуск: node tests/registry_server.js → печатает адрес функции. Пароль — test-password. */
'use strict';
const http = require('http');
const store = new Map();
const s3 = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'));
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.method === 'PUT') { store.set(key, body); res.writeHead(200); return res.end(); }
    if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && key) { if (!store.has(key)) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(store.get(key)); }
    const p = u.searchParams.get('prefix') || '';
    res.writeHead(200); res.end(`<R>${[...store.keys()].filter(k => k.startsWith(p)).map(k => `<Key>${k}</Key>`).join('')}<IsTruncated>false</IsTruncated></R>`);
  });
});
s3.listen(0, () => {
  Object.assign(process.env, { S3_ENDPOINT: 'http://127.0.0.1:' + s3.address().port, BUCKET: 'b', REGISTRY_PASSWORD: 'test-password' });
  const { handler } = require('../cloud/registry/index.js');
  const fn = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', async () => {
      const r = await handler({ httpMethod: req.method, body, isBase64Encoded: false }, { token: { access_token: 't' } });
      res.writeHead(r.statusCode, r.headers); res.end(r.body);
    });
  });
  fn.listen(0, () => console.log('http://127.0.0.1:' + fn.address().port + '/'));
});
