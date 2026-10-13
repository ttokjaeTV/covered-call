# 커버드콜 계산기 · 똑재TV

국내상장 커버드콜 ETF의 실제 종가·분배금·과세표준액으로 계산하는 도구입니다.
배포 주소: https://ttokjaetv.github.io/covered-call/

## 기능
1. **생활비 대결** — 커버드콜 분배금(세후)으로 생활 vs 본주를 팔아 생활(같은 금액 / 매년 정률)
2. **분배금 재투자 백테스트** — 같은 ETF 재투자 · 다른 ETF 매수 · 현금 보유 · 생활비 사용, 거치식·적립식, XIRR·MDD
3. **커버드콜 현황판** — 12개월 분배율, 과세 비율, 가격 수익률 vs 총수익, 본주 총수익, 세대·기초자산 필터

주소 뒤에 종목코드를 붙이면 바로 열립니다: `#441680`(생활비 대결), `#441680-bt`(백테스트), `#board`(현황판)

## 데이터 (`data/cc-data.json`)
- 종가: 다음금융 일별 시세(분배금 미반영 원본 종가), 최근 5년
- 분배금·과세표준액: 월배당 ETF 트래커(montly-div) `tax-base.json`·`tax-base-extra.json` + portfolio-sheet-data `etf_tax_base.json`
- 종목 목록: 트래커 `index.html`의 ETFS 배열 중 자산=커버드콜 (신규 상장은 트래커에 추가되면 자동 반영)
- 검증: 네이버 수정주가(분배금 반영)와 원본 종가의 비율 변화로 분배락을 역산해 기록과 대조.
  가격의 0.35% 이상인 분배가 기록에 없으면 커버드콜은 그 뒤부터만 계산, 본주는 역산값으로 채움(과표=분배금 가정).
  결과는 `data/build-report.txt`.
- 갱신: GitHub Actions `update-data.yml`, 평일 19:41 KST

## 파일
- `src/` — 페이지 조각(page.html, base.css, extra.css, engine.js, app.js). 고친 뒤 `python scripts/build_page.py`로 `index.html` 생성
- `scripts/build_data.py` — 데이터 빌드
- `tests/verify_engine.py` — JS 엔진과 파이썬 독립 구현 대조(6개 시나리오)
- 세대 분류(`GEN`)·본주 기본값(`BASE_BY_GROUP`, `BASE_BY_CODE`)은 `src/app.js` 맨 위
