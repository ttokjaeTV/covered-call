import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        out = {}
        await pg.goto('http://localhost:8765/index.html#441680-bt', wait_until='networkidle'); await pg.wait_for_timeout(1200)
        out['hash_bt'] = await pg.evaluate("[document.querySelector('.mode-tab.active').dataset.tab, document.getElementById('b-cc').value, document.getElementById('b-start').value]")
        await pg.check('input[name="b-policy"][value="other"]'); await pg.wait_for_timeout(400)
        out['other'] = await pg.inner_text('#b-verdict-main')
        await pg.check('input[name="b-policy"][value="spend"]'); await pg.check('input[name="b-tax"][value="shelter"]'); await pg.wait_for_timeout(400)
        out['spend'] = await pg.inner_text('#b-verdict-main')
        await pg.goto('http://localhost:8765/index.html#490590', wait_until='networkidle'); await pg.wait_for_timeout(1200)
        await pg.check('input[name="d-mode"][value="rate"]'); await pg.fill('#d-rate', '25'); await pg.dispatch_event('#d-rate', 'change'); await pg.wait_for_timeout(400)
        out['rate'] = await pg.inner_text('#d-verdict-main'); out['skull'] = await pg.evaluate("!!document.querySelector('.skull')")
        await pg.goto('http://localhost:8765/index.html#board', wait_until='networkidle'); await pg.wait_for_timeout(1200)
        await pg.click('#bd-period button[data-v="all"]'); await pg.click('th[data-k="y12"]'); await pg.click('#bd-gen .chip[data-v="x"]'); await pg.wait_for_timeout(300)
        out['board_rows'] = await pg.evaluate("document.querySelectorAll('#bd-table tbody tr').length")
        out['board_hold'] = await pg.evaluate("[...document.querySelectorAll('#bd-table tbody .b-name')].map(x=>x.innerText)")
        await pg.click('#bd-table tbody tr'); await pg.wait_for_timeout(500)
        out['row_click'] = await pg.evaluate("[document.querySelector('.mode-tab.active').dataset.tab, location.hash]")
        out['errors'] = errs
        print(json.dumps(out, ensure_ascii=False, indent=1)); await b.close()
asyncio.run(main())
