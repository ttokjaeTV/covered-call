import asyncio, sys, json
from playwright.async_api import async_playwright
OUT = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        res = {}
        for w, tag in [(1280, 'pc'), (360, 'm')]:
            pg = await b.new_page(viewport={'width': w, 'height': 900}, device_scale_factor=1)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
            # 외부 CDN 차단 환경 대비: chart.js가 없으면 실패하므로 그대로 로드 시도
            await pg.goto('http://localhost:8765/index.html', wait_until='networkidle')
            await pg.wait_for_timeout(1500)
            sw = await pg.evaluate('document.documentElement.scrollWidth')
            await pg.screenshot(path=f'{OUT}/{tag}-duel.png', full_page=True)
            for t in ['bt', 'board']:
                await pg.click(f'.mode-tab[data-tab="{t}"]')
                await pg.wait_for_timeout(800)
                sw = max(sw, await pg.evaluate('document.documentElement.scrollWidth'))
                await pg.screenshot(path=f'{OUT}/{tag}-{t}.png', full_page=True)
            res[tag] = {'scrollWidth': sw, 'errors': errs, 'verdict': await pg.evaluate("document.getElementById('d-verdict-main').innerText")}
        print(json.dumps(res, ensure_ascii=False, indent=1))
        await b.close()
asyncio.run(main())
