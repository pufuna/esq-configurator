# Сторонние библиотеки (локальные копии)

Подключаются с сайта, чтобы ТКП (PDF и Word) собирались там, где CDN заблокирован.
Если локальный файл не загрузился, страница берёт ту же библиотеку с cdn.jsdelivr.net.

| Файл | Библиотека | Версия | Лицензия |
|---|---|---|---|
| pdf-lib.min.js | pdf-lib | 1.17.1 | MIT |
| pdfjs/pdf.min.mjs, pdfjs/pdf.worker.min.mjs | pdfjs-dist (legacy build) | 6.2.108 | Apache-2.0 |
| docx.min.js | docx (минифицирован esbuild из dist/index.iife.js) | 9.8.1 | MIT |
