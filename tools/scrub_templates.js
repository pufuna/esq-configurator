/* Очистка шаблонов ТКП от скрытого содержимого тем же модулем, что и готовые ТКП (pdfscrub.js):
   объекты за пределами листа, ссылки без адреса, служебный слой Acrobat Fill & Sign, неиспользуемые объекты.

     node tools/scrub_templates.js                         # assets/template.pdf, assets/upp/shell.pdf
     node tools/scrub_templates.js файл.pdf [...]

   После очистки стоит ужать файл: python tools/optimize_pdf.py <файл>. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.dirname(__dirname);
global.window = global; global.self = global;
const PL = require(path.join(ROOT, 'assets/vendor/pdf-lib.min.js'));
window.PDFLib = PL;
require(path.join(ROOT, 'pdfscrub.js'));

(async () => {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['assets/template.pdf', 'assets/upp/shell.pdf'].map(f => path.join(ROOT, f));
  for (const f of files) {
    const src = fs.readFileSync(f);
    const doc = await PL.PDFDocument.load(src);
    const n = doc.getPageCount();
    const r = await window.PdfScrub.scrub(doc);
    const out = await doc.save({ useObjectStreams: true });
    if (doc.getPageCount() !== n) throw new Error(f + ': изменилось число листов');
    fs.writeFileSync(f, out);
    console.log(`${path.relative(ROOT, f)}: убрано ${r.removed} скрытых элементов, ${r.orphans} неиспользуемых объектов; ${(src.length / 1024).toFixed(0)} → ${(out.length / 1024).toFixed(0)} КБ`);
  }
})().catch(e => { console.error(e); process.exit(1); });
