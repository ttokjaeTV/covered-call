# -*- coding: utf-8 -*-
"""엔진(JS) 결과를 파이썬 독립 구현과 대조한다.  python tests/verify_engine.py"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = json.load(open(ROOT / "data" / "cc-data.json", encoding="utf-8"))
DATES = RAW["dates"]
E = RAW["etfs"]
TAX = 0.154
DIV = {c: {r[0]: r for r in e["dv"]} for c, e in E.items()}


def px(c, i):
    e = E[c]
    return None if i < e["s"] else e["px"][i - e["s"]]


def month_start(i, i0):
    return i > i0 and DATES[i][:6] != DATES[i - 1][:6]


def year_start(i, i0):
    return i > i0 and DATES[i][:4] != DATES[i - 1][:4]


class Acct:
    def __init__(self, general):
        self.g = general
        self.sh, self.cost = {}, {}
        self.cash = self.spent = self.tax = self.inv = 0.0

    def buy(self, c, amt, i):
        if amt <= 0:
            return
        p = px(c, i)
        self.sh[c] = self.sh.get(c, 0) + amt / p
        self.cost[c] = self.cost.get(c, 0) + amt

    def val(self, i):
        return self.cash + sum(q * px(c, i) for c, q in self.sh.items() if q)

    def divs(self, i):
        out = {}
        for c, q in self.sh.items():
            r = DIV[c].get(i)
            if q and r:
                t = q * r[2] * TAX if self.g else 0
                self.tax += t
                out[c] = q * r[1] - t
        return out

    def sell_net(self, c, net, i):
        q, p = self.sh.get(c, 0), px(c, i)
        if not q or net <= 0:
            return 0
        avg = self.cost[c] / q
        gr = max(0, (p - avg) / p) if (self.g and not E[c]["dom"]) else 0
        gross = min(net / (1 - TAX * gr), q * p)
        sq = gross / p
        t = gross * TAX * gr
        self.cost[c] -= avg * sq
        self.sh[c] = q - sq
        if self.sh[c] < 1e-9:
            self.sh[c] = 0
            self.cost[c] = 0
        self.tax += t
        return gross - t


def backtest(cc, policy, target, cmp, i0, i1, initial, monthly, general):
    A, B = Acct(general), Acct(general)
    for i in range(i0, i1 + 1):
        for c, net in A.divs(i).items():
            if c == cc:
                if policy == "reinvest":
                    A.buy(cc, net, i)
                elif policy == "other":
                    A.buy(target, net, i)
                elif policy == "spend":
                    A.spent += net
                else:
                    A.cash += net
            else:
                A.buy(c, net, i)
        for c, net in B.divs(i).items():
            B.buy(c, net, i)
        add = (initial if i == i0 else 0) + (monthly if month_start(i, i0) else 0)
        if add:
            A.inv += add
            B.inv += add
            A.buy(cc, add, i)
            B.buy(cmp, add, i)
    return {"A": A.val(i1), "B": B.val(i1), "taxA": A.tax, "inv": A.inv, "spentA": A.spent}


def duel(cc, base, i0, i1, initial, general, mode, rate, leftover):
    A, B = Acct(general), Acct(general)
    budget = 0.0
    depleted = None
    for i in range(i0, i1 + 1):
        sa = sum(A.divs(i).values())
        A.spent += sa
        for c, net in B.divs(i).items():
            B.cash += net
        if i == i0:
            A.buy(cc, initial, i)
            B.buy(base, initial, i)
            budget = initial * rate / 100

        def pay(need):
            nonlocal depleted
            take = min(B.cash, need)
            B.cash -= take
            paid = take
            if paid < need - 1e-6:
                paid += B.sell_net(base, need - paid, i)
            if paid < need - 0.5 and depleted is None:
                depleted = i
            B.spent += paid

        if mode == "match":
            if sa > 0:
                pay(sa)
            trig = sa > 0
        else:
            if year_start(i, i0):
                budget = B.val(i) * rate / 100
            # 시작일도 그 달 인출일(예산은 시작일 평가금액 기준)
            pay_day = i == i0 or month_start(i, i0)
            if pay_day:
                pay(budget / 12)
            trig = pay_day
        if B.cash > 0 and trig:
            v, B.cash = B.cash, 0
            if leftover == "spend":
                B.spent += v
            else:
                B.buy(base, v, i)
    return {"A": A.val(i1), "B": B.val(i1), "spentA": A.spent, "spentB": B.spent,
            "taxA": A.tax, "taxB": B.tax, "dep": depleted}


def idx(d):
    return next(i for i, x in enumerate(DATES) if x >= d)


CASES = [
    ("bt", dict(cc="289480", policy="reinvest", target=None, cmp="069500", i0=idx("20211013"),
                i1=len(DATES) - 1, initial=1e8, monthly=1e6, general=True)),
    ("bt", dict(cc="441680", policy="other", target="133690", cmp="133690", i0=idx("20221130"),
                i1=len(DATES) - 1, initial=5e7, monthly=0, general=True)),
    ("bt", dict(cc="498400", policy="cash", target=None, cmp="069500", i0=idx("20250102"),
                i1=len(DATES) - 1, initial=3e7, monthly=5e5, general=False)),
    ("duel", dict(cc="441680", base="133690", i0=idx("20221130"), i1=len(DATES) - 1,
                  initial=3e8, general=True, mode="match", rate=0, leftover="reinvest")),
    ("duel", dict(cc="289480", base="069500", i0=idx("20211013"), i1=len(DATES) - 1,
                  initial=3e8, general=False, mode="rate", rate=4, leftover="spend")),
    ("duel", dict(cc="490590", base="133690", i0=E["490590"]["s"], i1=len(DATES) - 1,
                  initial=1e8, general=True, mode="rate", rate=30, leftover="reinvest")),
]

JS = r"""
// 공용 제도 상수(rules.js)를 브라우저처럼 전역 TTOKJAE_RULES로 둔다. 버전은 페이지의 <script src>에서 읽음.
(function loadRules() {
  const fs = require('fs'), path = require('path');
  const html = ['template.html', '../src/template.html', '../index.html', 'index.html'].map(f => path.join(__dirname, f)).find(f => fs.existsSync(f) && /rules\/v[\d.]+\/rules\.js/.test(fs.readFileSync(f, 'utf8')));
  const rel = fs.readFileSync(html, 'utf8').match(/rules\/v[\d.]+\/rules\.js/)[0];
  let src = null;
  for (let d = __dirname, i = 0; i < 6 && src === null; i++, d = path.dirname(d)) {
    const f = path.join(d, 'ttokjaetv.github.io', rel);
    if (fs.existsSync(f)) src = fs.readFileSync(f, 'utf8');
  }
  if (src === null) src = require('child_process').execFileSync(process.execPath, ['-e',
    `fetch('https://ttokjaetv.github.io/${rel}').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => process.stdout.write(t))`]).toString();
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  global.TTOKJAE_RULES = m.exports;
})();
const fs=require('fs'); const eng=require(process.argv[2]);
const raw=JSON.parse(fs.readFileSync(process.argv[3],'utf8')); const D=eng.makeData(raw);
const cases=JSON.parse(process.argv[4]); const out=[];
for (const [k,o] of cases){
  const opt=Object.assign({},o,{taxMode:o.general?'general':'shelter'});
  if(k==='bt'){ const r=eng.runBacktest(D,opt);
    out.push({A:r.A.value(o.i1),B:r.B.value(o.i1),taxA:r.A.tax,inv:r.A.invested,spentA:r.A.spent}); }
  else { const r=eng.runDuel(D,opt);
    out.push({A:r.A.value(o.i1),B:r.B.value(o.i1),spentA:r.A.spent,spentB:r.B.spent,taxA:r.A.tax,taxB:r.B.tax,dep:r.B.depletedAt}); }
}
console.log(JSON.stringify(out));
"""


def main():
    js_cases = [[k, dict(o)] for k, o in CASES]
    tmp = ROOT / "tests" / "_run.js"
    tmp.write_text(JS, encoding="utf-8")
    res = subprocess.run(["node", str(tmp), str(ROOT / "src" / "engine.js"), str(ROOT / "data" / "cc-data.json"),
                          json.dumps(js_cases)], capture_output=True, text=True)
    tmp.unlink()
    if res.returncode:
        print(res.stderr)
        sys.exit(1)
    js = json.loads(res.stdout)
    bad = 0
    for (k, o), j in zip(CASES, js):
        py = backtest(**o) if k == "bt" else duel(**o)
        for key in py:
            a, b = py[key], j[key]
            ok = (a == b) if (a is None or b is None) else abs(a - b) <= max(1e-6 * abs(a), 0.01)
            if not ok:
                bad += 1
            print(f"{'OK ' if ok else 'BAD'} {k} {o.get('cc')} {key:7s} py={a!s:>22} js={b!s:>22}")
    print("불일치", bad)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
