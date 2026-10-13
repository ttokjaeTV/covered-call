// ==ENGINE START==
/* 커버드콜 계산기 엔진
 * 데이터: cc-data.json (dates: 거래일 YYYYMMDD, etfs[code] = {s, px[], dv:[[i, 분배금, 과표, est?]], dom, ...})
 * 규칙
 *  - 매수·재투자는 그날 종가, 소수 주 허용
 *  - 분배락일 직전 보유 수량 × 주당 분배금을 받는다 (그날 종가에 산 수량은 제외)
 *  - 일반계좌: 분배금 세금 = 수량 × 과세표준액 × 15.4%
 *              국내상장 해외 ETF 등(국내주식형 제외)을 팔면 (매도가 − 평균 단가) × 15.4% (추정)
 *  - 절세계좌: 세금 없음(과세이연)
 */
const TAX = 0.154;

function makeData(raw) {
  const D = { dates: raw.dates, etfs: raw.etfs, divAt: {} };
  for (const code in raw.etfs) {
    const m = new Map();
    for (const r of raw.etfs[code].dv) m.set(r[0], r);
    D.divAt[code] = m;
  }
  return D;
}

function priceAt(D, code, i) {
  const e = D.etfs[code];
  if (!e || i < e.s) return null;
  return e.px[i - e.s];
}

function isMonthStart(D, i, i0) {
  return i > i0 && D.dates[i].slice(0, 6) !== D.dates[i - 1].slice(0, 6);
}
function isYearStart(D, i, i0) {
  return i > i0 && D.dates[i].slice(0, 4) !== D.dates[i - 1].slice(0, 4);
}

/* 한 사람의 계좌 */
function Account(D, opt) {
  this.D = D;
  this.general = opt.taxMode !== 'shelter';
  this.sh = {};      // code -> 수량
  this.cost = {};    // code -> 매입원가 합
  this.cash = 0;     // 아직 쓰거나 재투자하지 않은 현금
  this.spent = 0;    // 생활비로 쓴 돈 누계
  this.tax = 0;      // 낸 세금 누계
  this.invested = 0; // 넣은 돈 누계
  this.divGross = 0; // 받은 분배금(세전) 누계
  this.divNet = 0;   // 받은 분배금(세후) 누계
  this.flows = [];   // XIRR용 [i, 금액(+면 내 손에 들어온 돈)]
  this.depletedAt = null;
}
Account.prototype.buy = function (code, amt, i) {
  if (amt <= 0) return;
  const p = priceAt(this.D, code, i);
  if (!p) { this.cash += amt; return; }
  this.sh[code] = (this.sh[code] || 0) + amt / p;
  this.cost[code] = (this.cost[code] || 0) + amt;
};
Account.prototype.value = function (i) {
  let v = this.cash;
  for (const c in this.sh) {
    const p = priceAt(this.D, c, i);
    if (p) v += this.sh[c] * p;
  }
  return v;
};
/* code를 팔아 세후 net 원을 마련. 실제로 마련한 세후 금액을 돌려준다 */
Account.prototype.sellNet = function (code, net, i) {
  const q = this.sh[code] || 0;
  const p = priceAt(this.D, code, i);
  if (!q || !p || net <= 0) return 0;
  const avg = this.cost[code] / q;
  const taxable = this.general && !this.D.etfs[code].dom;
  const gainRate = taxable ? Math.max(0, (p - avg) / p) : 0; // 매도금액 중 차익 비율
  const keep = 1 - TAX * gainRate;                              // 매도금액 1원당 손에 남는 돈
  let gross = net / keep;
  if (gross > q * p) gross = q * p;
  const sellQ = gross / p;
  const t = gross * TAX * gainRate;
  this.cost[code] -= avg * sellQ;
  this.sh[code] = q - sellQ;
  if (this.sh[code] < 1e-9) { this.sh[code] = 0; this.cost[code] = 0; }
  this.tax += t;
  return gross - t;
};
/* i일 분배락: 보유 종목마다 분배금 수령. 반환 {code: 세후금액} */
Account.prototype.collect = function (i) {
  const got = {};
  for (const c in this.sh) {
    const q = this.sh[c];
    if (!q) continue;
    const r = this.D.divAt[c] && this.D.divAt[c].get(i);
    if (!r) continue;
    const gross = q * r[1];
    const t = this.general ? q * r[2] * TAX : 0;
    this.tax += t;
    this.divGross += gross;
    this.divNet += gross - t;
    got[c] = gross - t;
  }
  return got;
};
Account.prototype.contribute = function (code, amt, i) {
  if (amt <= 0) return;
  this.invested += amt;
  this.flows.push([i, -amt]);
  this.buy(code, amt, i);
};
Account.prototype.spend = function (amt, i) {
  if (amt <= 0) return;
  this.spent += amt;
  this.flows.push([i, amt]);
};

/* ---------------------------------------------------------------
 * 백테스트: 커버드콜 1종 + 분배금 처리
 *  opt = { cc, policy: 'reinvest'|'other'|'cash'|'spend', target, cmp,
 *          i0, i1, initial, monthly, taxMode }
 *  cmp(비교 대상)는 같은 날 같은 돈을 넣고 자기 분배금은 자기에게 재투자
 * ------------------------------------------------------------- */
function runBacktest(D, opt) {
  const A = new Account(D, opt);
  const B = opt.cmp ? new Account(D, opt) : null;
  const sA = [], sB = [], sInv = [], sSpentA = [];
  for (let i = opt.i0; i <= opt.i1; i++) {
    // 1) 분배락 (어제까지 보유분)
    const gA = A.collect(i);
    for (const c in gA) {
      const net = gA[c];
      if (c === opt.cc) {
        if (opt.policy === 'reinvest') A.buy(opt.cc, net, i);
        else if (opt.policy === 'other' && opt.target) A.buy(opt.target, net, i);
        else if (opt.policy === 'spend') A.spend(net, i);
        else A.cash += net;
      } else {
        A.buy(c, net, i); // 분배금으로 산 다른 ETF의 분배금은 그 ETF에 재투자
      }
    }
    if (B) {
      const gB = B.collect(i);
      for (const c in gB) B.buy(c, gB[c], i);
    }
    // 2) 넣는 돈
    let add = 0;
    if (i === opt.i0) add += opt.initial;
    if (isMonthStart(D, i, opt.i0)) add += opt.monthly;
    if (add > 0) {
      A.contribute(opt.cc, add, i);
      if (B) B.contribute(opt.cmp, add, i);
    }
    sA.push(A.value(i));
    if (B) sB.push(B.value(i));
    sInv.push(A.invested);
    sSpentA.push(A.spent);
    if (opt._snap) opt._snap(i, A);
  }
  return { A, B, sA, sB, sInv, sSpentA };
}

/* ---------------------------------------------------------------
 * 생활비 대결: 커버드콜은 분배금(세후)을 전부 생활비로, 본주는 팔아서 생활비
 *  opt = { cc, base, i0, i1, initial, taxMode,
 *          mode: 'match' (커버드콜과 같은 날 같은 금액) | 'rate' (매년 rate% 정률, 매달 1/12) ,
 *          rate, leftover: 'reinvest'|'spend' }
 *  본주는 자기 분배금(세후)을 먼저 쓰고 모자란 만큼만 판다
 * ------------------------------------------------------------- */
function runDuel(D, opt) {
  const A = new Account(D, opt);
  const B = new Account(D, opt);
  const sA = [], sB = [], cA = [], cB = [];
  const mA = new Map(), mB = new Map(); // YYYYMM -> 그달 생활비
  let budgetB = 0;
  const addM = (m, i, v) => { const k = D.dates[i].slice(0, 6); m.set(k, (m.get(k) || 0) + v); };

  const payB = (need, i) => {
    let paid = 0;
    const fromCash = Math.min(B.cash, need);
    B.cash -= fromCash; paid += fromCash;
    if (paid < need - 1e-6) {
      paid += B.sellNet(opt.base, need - paid, i);
    }
    if (paid < need - 0.5 && B.depletedAt === null) B.depletedAt = i;
    B.spend(paid, i); addM(mB, i, paid);
    return paid;
  };

  for (let i = opt.i0; i <= opt.i1; i++) {
    // 분배락
    const gA = A.collect(i);
    let spendA = 0;
    for (const c in gA) { spendA += gA[c]; }
    if (spendA > 0) { A.spend(spendA, i); addM(mA, i, spendA); }
    const gB = B.collect(i);
    for (const c in gB) B.cash += gB[c];

    if (i === opt.i0) {
      A.contribute(opt.cc, opt.initial, i);
      B.contribute(opt.base, opt.initial, i);
      budgetB = opt.initial * (opt.rate || 0) / 100;
    }

    if (opt.mode === 'match') {
      if (spendA > 0) payB(spendA, i);
    } else {
      if (isYearStart(D, i, opt.i0)) budgetB = B.value(i) * opt.rate / 100;
      if (isMonthStart(D, i, opt.i0)) payB(budgetB / 12, i);
    }
    // 인출하고 남은 본주 분배금
    if (B.cash > 0 && (opt.mode === 'match' ? spendA > 0 : isMonthStart(D, i, opt.i0))) {
      if (opt.leftover === 'spend') { const v = B.cash; B.cash = 0; B.spend(v, i); addM(mB, i, v); }
      else { const v = B.cash; B.cash = 0; B.buy(opt.base, v, i); }
    }
    sA.push(A.value(i)); sB.push(B.value(i));
    cA.push(A.spent); cB.push(B.spent);
  }
  return { A, B, sA, sB, cA, cB, mA, mB };
}

/* 현황판용: 세전 재투자 총수익률·가격 수익률 */
function totalReturn(D, code, i0, i1) {
  const p0 = priceAt(D, code, i0), p1 = priceAt(D, code, i1);
  if (!p0 || !p1) return null;
  let sh = 1;
  const m = D.divAt[code];
  for (const [i, r] of m) {
    if (i > i0 && i <= i1) {
      const p = priceAt(D, code, i);
      if (p) sh += sh * r[1] / p;
    }
  }
  return { price: p1 / p0 - 1, total: sh * p1 / p0 - 1 };
}

/* 최근 12개월 분배 합·과표 합 (기준: i1 날짜로부터 365일 이내 분배락) */
function trailing12(D, code, i1) {
  const end = ymdToDate(D.dates[i1]);
  const from = new Date(end.getTime() - 365 * 86400000);
  let d = 0, t = 0, n = 0;
  for (const [i, r] of D.divAt[code]) {
    if (i > i1) continue;
    const dt = ymdToDate(D.dates[i]);
    if (dt > from) { d += r[1]; t += r[2]; n++; }
  }
  return { d, t, n };
}

function ymdToDate(s) { return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); }

/* XIRR: flows [[i, amt]], 마지막 평가금액을 i1에 + */
function xirr(D, flows) {
  if (!flows.length) return null;
  const t0 = ymdToDate(D.dates[flows[0][0]]).getTime();
  const pts = flows.map(([i, a]) => [(ymdToDate(D.dates[i]).getTime() - t0) / (365 * 86400000), a]);
  const span = pts[pts.length - 1][0];
  if (span < 0.08) return null;
  const npv = r => pts.reduce((s, [t, a]) => s + a / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (Math.abs(f) < 1e-7) return mid;
    if (f * flo > 0) { lo = mid; flo = f; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

function mdd(series) {
  let peak = -Infinity, worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}

if (typeof module !== 'undefined') {
  module.exports = { makeData, priceAt, runBacktest, runDuel, totalReturn, trailing12, xirr, mdd, Account };
}
// ==ENGINE END==
