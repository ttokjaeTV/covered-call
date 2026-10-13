import asyncio, json
from playwright.async_api import async_playwright
B='http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        out = {}
        # 1) 현황판: 대응 본주 없는 종목은 본주 칸 비어야 함
        await pg.goto(B + '#board', wait_until='networkidle'); await pg.wait_for_timeout(1200)
        out['476550_base'] = await pg.evaluate("document.querySelector('tr[data-c=\"476550\"] td:last-child').innerText")
        out['289480_base'] = await pg.evaluate("document.querySelector('tr[data-c=\"289480\"] td:last-child').innerText")
        # 2) 정률에서 '남은 돈도 생활비' 고른 뒤 같은 금액으로 → 생활비 같아야 함
        await pg.goto(B + '#166400', wait_until='networkidle'); await pg.wait_for_timeout(1000)
        await pg.check('input[name="d-mode"][value="rate"]'); await pg.wait_for_timeout(200)
        await pg.click('#d-left .chip[data-v="spend"]'); await pg.wait_for_timeout(200)
        await pg.check('input[name="d-mode"][value="match"]'); await pg.wait_for_timeout(400)
        out['match_spent'] = await pg.evaluate("[...document.querySelectorAll('.vs-card')].map(c=>c.querySelectorAll('.vs-line')[1].innerText)")
        # 3) 월평균 생활비, 매도 세금 안내
        await pg.goto(B + '#441680', wait_until='networkidle'); await pg.wait_for_timeout(1000)
        out['avg'] = await pg.evaluate("[...document.querySelectorAll('.vs-card.a .vs-line')].map(x=>x.innerText).slice(-1)")
        out['gainnote'] = await pg.inner_text('#d-verdict-sub')
        # 4) 백테스트 MDD
        await pg.goto(B + '#441680-bt', wait_until='networkidle'); await pg.wait_for_timeout(1000)
        await pg.fill('#b-monthly', '200'); await pg.dispatch_event('#b-monthly','input'); await pg.wait_for_timeout(600)
        out['mdd'] = await pg.evaluate("[...document.querySelectorAll('#b-stats .stat-card')][3].innerText")
        out['errors'] = errs
        print(json.dumps(out, ensure_ascii=False, indent=1)); await b.close()
asyncio.run(main())
