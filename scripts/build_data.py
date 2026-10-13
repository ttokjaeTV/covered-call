# -*- coding: utf-8 -*-
"""
똑재TV 커버드콜 계산기 — 데이터 빌드 (GitHub Actions 자동 실행)

산출물: data/cc-data.json

데이터 출처
  - 종가: 다음금융 일별 시세 API (원본 종가, 분배금 미반영)
  - 분배금·과세표준액: 월배당 ETF 트래커 tax-base.json / tax-base-extra.json (ETF CHECK)
                      + portfolio-sheet-data etf_tax_base.json (ETF CHECK + FunETF)
  - 종목 목록·분류: 월배당 ETF 트래커 index.html 의 ETFS 배열 (자산=커버드콜)
  - 상장일: 다음금융 quotes API

검증
  네이버 수정주가(분배금 반영)와 다음 원본 종가를 비교하면 분배락일마다
  "숨은 분배금"이 드러난다. 이 값과 기록된 분배금을 대조해서
  - 커버드콜: 기록이 빠진 구간이 있으면 그 뒤부터만 계산하도록 시작일을 늦춘다
  - 비교 본주: 빠진 분배금을 역산값으로 채우고 과표 = 분배금(전액 과세)으로 둔다(est 표시)

수동 실행:  python scripts/build_data.py
"""
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cc-data.json"
REPORT = ROOT / "data" / "build-report.txt"

RAW = "https://raw.githubusercontent.com/ttokjaeTV"
TRACKER_INDEX = f"{RAW}/montly-div/main/index.html"
TRACKER_TB = f"{RAW}/montly-div/main/data/tax-base.json"
TRACKER_TB_EXTRA = f"{RAW}/montly-div/main/data/tax-base-extra.json"
TRACKER_LISTING = f"{RAW}/montly-div/main/data/listing.json"
TRACKER_EXPENSE = f"{RAW}/montly-div/main/data/expense.json"
PSD_TB = f"{RAW}/portfolio-sheet-data/master/data/etf_tax_base.json"

YEARS = 5  # 네이버·다음 모두 이 기간으로 맞춘다
MISS_RATIO = 0.0035  # 기록 누락으로 볼 최소 분배 크기(직전 종가 대비)

# 비교용 본주 (현황판 '본주 총수익'·백테스트 비교 대상)
# dom: 국내주식형(매매차익 비과세) 여부
BASES = [
    ("069500", "KODEX 200", "국내 주식", True),
    ("229200", "KODEX 코스닥150", "국내 주식", True),
    ("091160", "KODEX 반도체", "국내 주식", True),
    ("161510", "PLUS 고배당주", "국내 주식", True),
    ("495850", "KODEX 코리아밸류업", "국내 주식", True),
    ("133690", "TIGER 미국나스닥100", "국내상장 해외", False),
    ("360750", "TIGER 미국S&P500", "국내상장 해외", False),
    ("458730", "TIGER 미국배당다우존스", "국내상장 해외", False),
    ("381170", "TIGER 미국테크TOP10 INDXX", "국내상장 해외", False),
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def get(url, headers=None, timeout=25, retries=3):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as ex:  # noqa
            last = ex
            time.sleep(1.5 * (i + 1))
    raise last


def get_json(url, headers=None):
    return json.loads(get(url, headers))


# ---------------------------------------------------------------- 종목 목록
def tracker_covered_calls():
    html = get(TRACKER_INDEX)
    pat = re.compile(
        r'\["([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]+)","([^"]*)","([^"]*)","(월중|월말)"'
    )
    out, seen = [], set()
    for m in pat.finditer(html):
        c1, c2, c3, c4, code, nm, desc, dt = m.groups()
        if c2 != "커버드콜" or code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "n": nm, "a": c1, "r": c3, "grp": c4, "desc": desc, "dt": dt})
    return out


# ---------------------------------------------------------------- 시세
def daum_days(code, since_ymd):
    """다음 일별 시세(원본 종가). 반환 {YYYYMMDD: close}"""
    out = {}
    hdr = {"Referer": f"https://finance.daum.net/quotes/A{code}"}
    for page in range(1, 10):
        url = (f"https://finance.daum.net/api/quote/A{code}/days"
               f"?symbolCode=A{code}&page={page}&perPage=1000&pagination=true")
        data = get_json(url, hdr).get("data") or []
        for x in data:
            d = x["date"][:10].replace("-", "")
            if x.get("tradePrice"):
                out[d] = int(round(float(x["tradePrice"])))
        if not data or data[-1]["date"][:10].replace("-", "") < since_ymd:
            break
        time.sleep(0.25)
    return {d: v for d, v in out.items() if d >= since_ymd}


def naver_adj(code, s, e):
    """네이버 일봉(분배금 반영 수정주가). 반환 {YYYYMMDD: close}"""
    url = ("https://api.finance.naver.com/siseJson.naver"
           f"?symbol={code}&requestType=1&startTime={s}&endTime={e}&timeframe=day")
    txt = get(url, {"Referer": "https://finance.naver.com/"}).replace("'", '"')
    rows = json.loads(txt)
    out = {}
    for r in rows[1:]:
        if r and len(r) >= 5 and r[4] is not None:
            out[str(r[0])] = int(r[4])
    return out


def daum_listing(code):
    try:
        d = get_json(f"https://finance.daum.net/api/quotes/A{code}?summary=false&changeStatistics=true",
                     {"Referer": "https://finance.daum.net/domestic/all_stocks"})
        return (d.get("listingDate") or "")[:10], d.get("name")
    except Exception:
        return "", None


# ---------------------------------------------------------------- 분배금 검증
def implied_dists(raw, adj):
    """네이버 수정주가와 원본 종가의 비율 변화로 분배락일·분배금 역산. 반환 {date: D}"""
    ds = sorted(set(raw) & set(adj))
    out = {}
    for i in range(1, len(ds)):
        p, d = ds[i - 1], ds[i]
        if raw[p] <= 0 or raw[d] <= 0 or adj[p] <= 0 or adj[d] <= 0:
            continue
        r = (adj[d] / adj[p]) / (raw[d] / raw[p])
        if r <= 1:
            continue
        D = raw[p] * (1 - 1 / r)
        if D >= max(5, raw[p] * 0.0008):
            out[d] = D
    return out


def match_records(implied, recs, cal):
    """기록 분배마다 거래일 ±3일 안에서 가장 큰 역산 분배와 짝짓기.
    반환 (unmatched_implied, unmatched_recs)"""
    pos = {d: i for i, d in enumerate(cal)}
    used = set()
    extra = []
    for rd in sorted(recs):
        if rd not in pos:
            continue
        cands = [(D, d) for d, D in implied.items()
                 if d in pos and d not in used and abs(pos[d] - pos[rd]) <= 3]
        if cands:
            used.add(max(cands)[1])
        else:
            extra.append(rd)
    miss = [(d, round(D)) for d, D in sorted(implied.items()) if d not in used]
    return miss, extra


def prev_day(d, cal):
    i = cal.index(d) if d in cal else -1
    return cal[i - 1] if i > 0 else d


def norm_recs(rows):
    """[[YYYY/MM/DD, 분배금, 과표], ...] → {YYYYMMDD: (D, T)}"""
    out = {}
    for r in rows or []:
        d = r[0].replace("/", "").replace("-", "")
        D = float(r[1] or 0)
        T = float(r[2]) if len(r) > 2 and r[2] is not None else D
        if D > 0:
            out[d] = (D, T)
    return out


def snap(d, cal_set, cal):
    """기록일이 휴장일이면 직전 거래일로."""
    if d in cal_set:
        return d
    prev = [x for x in cal if x < d]
    return prev[-1] if prev else None


# ---------------------------------------------------------------- 메인
def main():
    now = datetime.now(KST)
    s = now.replace(year=now.year - YEARS).strftime("%Y%m%d")
    e = now.strftime("%Y%m%d")
    log = []

    def say(msg):
        print(msg)
        log.append(msg)

    say(f"=== 커버드콜 계산기 데이터 빌드 {now:%Y-%m-%d %H:%M} KST, 기간 {s}~{e}")

    ccs = tracker_covered_calls()
    say(f"커버드콜 {len(ccs)}종 (트래커 ETFS 배열 기준)")
    tb = get_json(TRACKER_TB)["data"]
    try:
        tb.update({k: v for k, v in get_json(TRACKER_TB_EXTRA)["data"].items() if k not in tb})
    except Exception as ex:
        say(f"[경고] tax-base-extra 읽기 실패: {ex}")
    psd = get_json(PSD_TB)["data"]
    try:
        listing = get_json(TRACKER_LISTING)["data"]
    except Exception:
        listing = {}
    try:
        expense = get_json(TRACKER_EXPENSE)["data"]
    except Exception:
        expense = {}

    items = []
    for c in ccs:
        items.append(dict(c, kind="cc", dom=(c["a"] == "주식" and c["r"] == "국내")))
    for code, nm, grp, dom in BASES:
        items.append({"code": code, "n": nm, "a": "주식", "r": "국내" if dom else "미국",
                      "grp": grp, "desc": "", "dt": "", "kind": "base", "dom": dom})

    # 거래일 달력 = KODEX 200 원본 시세 날짜
    raw_all, adj_all = {}, {}

    def fetch(it):
        code = it["code"]
        msgs = []
        try:
            r = daum_days(code, s)
        except Exception as ex:
            msgs.append(f"[실패] {code} 다음 시세: {ex}")
            r = {}
        try:
            a = naver_adj(code, s, e)
        except Exception as ex:
            msgs.append(f"[경고] {code} 네이버 수정주가: {ex}")
            a = {}
        return code, r, a, msgs

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, (code, r, a, msgs) in enumerate(pool.map(fetch, items), 1):
            raw_all[code], adj_all[code] = r, a
            for m in msgs:
                say(m)
            print(f"[{i:>3}/{len(items)}] {code}: 원본 {len(r)}일 / 수정 {len(a)}일", flush=True)

    cal = sorted(raw_all.get("069500", {}))
    if len(cal) < 200:
        say("[ERROR] 기준 달력(KODEX 200) 시세가 비정상 — 중단")
        sys.exit(1)
    cal_set = set(cal)
    idx = {d: i for i, d in enumerate(cal)}

    etfs = {}
    fails = 0
    for it in items:
        code = it["code"]
        raw = {d: v for d, v in raw_all.get(code, {}).items() if d in cal_set}
        if len(raw) < 20:
            say(f"[제외] {code} {it['n']}: 시세 부족 ({len(raw)}일)")
            fails += 1
            continue
        lst = listing.get(code, "")
        if not lst:
            lst, _ = daum_listing(code)

        # 분배 기록: 트래커 우선, 없으면 portfolio-sheet-data
        recs = norm_recs(psd.get(code))
        recs.update(norm_recs(tb.get(code)))
        recs = {snap(d, cal_set, cal): v for d, v in recs.items() if d >= cal[0]}
        recs.pop(None, None)

        implied = implied_dists(raw, adj_all.get(code, {}))
        miss, extra = match_records(implied, recs, cal)
        # 반올림 잡음(실측 0.08~0.28%)은 버리고 가격의 0.35% 이상만 '기록 누락'으로 본다
        miss = [(d, D) for d, D in miss if D >= MISS_RATIO * raw.get(prev_day(d, cal), raw[d])]

        first_px = min(raw)
        start = first_px
        est = set()
        if it["kind"] == "cc":
            # 기록이 빠진 역산 분배가 있으면 그 다음 거래일부터
            if miss:
                last_miss = max(d for d, _ in miss)
                nxt = [d for d in cal if d > last_miss]
                start = max(start, nxt[0] if nxt else last_miss)
        else:
            for d, D in miss:
                recs[d] = (float(D), float(D))
                est.add(d)

        if miss:
            say(f"[분배 누락] {code} {it['n']}: 기록 없는 분배락 {len(miss)}건 {miss[:6]}"
                + (" → 역산값으로 채움(과표=분배금 가정)" if it["kind"] == "base" else f" → 시작일 {start}"))
        if extra and adj_all.get(code):
            ex_in = [d for d in extra if d >= start]
            if ex_in:
                say(f"[참고] {code} {it['n']}: 수정주가에 안 보이는 기록 {len(ex_in)}건 {ex_in[:6]} (소액이면 정상)")

        si = idx[start]
        px = []
        last = None
        for d in cal[si:]:
            v = raw.get(d)
            if v is None:
                v = last  # 거래정지 등 → 직전 종가 유지
            px.append(v)
            last = v if v is not None else last
        if px and px[0] is None:
            say(f"[제외] {code}: 시작일 시세 없음")
            fails += 1
            continue

        dv = []
        for d in sorted(recs):
            if d < start or d not in idx:
                continue
            D, T = recs[d]
            row = [idx[d], round(D, 2), round(T, 2)]
            if d in est:
                row.append(1)
            dv.append(row)

        etfs[code] = {
            "n": it["n"], "kind": it["kind"], "grp": it["grp"], "a": it["a"], "r": it["r"],
            "dom": it["dom"], "desc": it["desc"], "dt": it["dt"], "list": lst,
            "s": si, "px": px, "dv": dv,
        }
        if code in expense:
            etfs[code]["exp"] = expense[code][3]

    out = {
        "updated": now.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "priceDate": cal[-1],
        "source": {
            "price": "다음금융 일별 시세(원본 종가)",
            "dist": "ETF CHECK·FunETF 분배금·과세표준액 (월배당 ETF 트래커·portfolio-sheet-data 수집분)",
            "check": "네이버 수정주가로 분배금 누락 대조",
        },
        "dates": cal,
        "etfs": etfs,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    say(f"=== 완료: {len(etfs)}종 저장, 실패 {fails}, {OUT.stat().st_size/1024:.0f}KB, 종가 기준일 {cal[-1]}")
    REPORT.write_text("\n".join(log) + "\n", encoding="utf-8")
    if fails > 8:
        sys.exit(1)


if __name__ == "__main__":
    main()
