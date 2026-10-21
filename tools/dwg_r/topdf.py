import asyncio, sys, pathlib, re
from playwright.async_api import async_playwright
async def main(files):
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/opt/google/chrome/chrome',args=['--no-sandbox'])
        pg=await b.new_page()
        for f in files:
            svg=pathlib.Path(f).read_text()
            m=re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"',svg); w,h=float(m.group(1)),float(m.group(2))
            W=420; H=W*h/w                                             # ширина листа 420 мм (A3), высота по пропорциям
            svg=re.sub(r'width="\d+" height="\d+"', f'width="{W}mm" height="{H:.1f}mm"', svg, count=1)
            await pg.set_content(f'<html><head><style>@page{{size:{W}mm {H:.1f}mm;margin:0}}html,body{{margin:0}}svg{{display:block}}</style></head><body>{svg}</body></html>')
            await pg.wait_for_timeout(300)
            out=f.replace('.svg','.pdf'); await pg.pdf(path=out, width=f'{W}mm', height=f'{H:.1f}mm', print_background=True)
            print(out, pathlib.Path(out).stat().st_size//1024, 'KB')
        await b.close()
asyncio.run(main(sys.argv[1:]))
