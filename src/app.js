'use strict';
/* ============================================================
 * 커버드콜 계산기 화면
 * ============================================================ */
const DATA_URL = 'data/cc-data.json';

// 기초자산 묶음 (트래커 분류 → 화면 이름)
const GROUPS = [
  ['코스피커', '코스피200'], ['국배커', '국내 배당'], ['국테크커', '국내 반도체'], ['코스닥커', '코스닥150'],
  ['나스닥커', '나스닥100'], ['S&P500커', 'S&P500'], ['미배커', '미국 배당'], ['테크커', '미국 테크'],
  ['미채커', '미국 국채'], ['커채혼합', '채권혼합'], ['기타', '금·중국'],
];
const GROUP_NAME = Object.fromEntries(GROUPS);

// 비교 본주 기본값: 묶음별 → 종목별 예외
const BASE_BY_GROUP = {
  '코스피커': '069500', '국배커': '069500', '국테크커': '091160', '코스닥커': '229200',
  '나스닥커': '133690', 'S&P500커': '360750', '미배커': '458730', '테크커': '133690',
};
const BASE_BY_CODE = { '489030': '161510', '0018C0': '161510', '0094M0': '495850', '474220': '381170' };

// 세대 (2026-10 확정 기준). 없으면 분류 보류
const GEN = {};
[['1', '289480 290080 441680'],
 ['2', '166400 472150 0219E0'],
 ['2.5', '441640 0144L0 458750 458760'],
 ['3', '475720 498400 0167B0 0104N0 0210E0 480020 480030 480040 482730 486290 490590 490600 491620 493810 494210 494300 494420 0005A0 0008S0 0138T0 483280 489030 0018C0 498410 0094M0 0104P0 0094L0 0128D0 0176P0 0190G0 0198A0 0223A0 476550 481060 0132K0 0203D0 0040X0'],
].forEach(([g, list]) => list.split(' ').forEach(c => { GEN[c] = g; }));
const GEN_LABEL = { '1': '1세대', '2': '2세대', '2.5': '2.5세대', '3': '3세대' };
const GEN_CLS = { '1': 'g1', '2': 'g2', '2.5': 'g25', '3': 'g3' };

let D = null;           // 엔진 데이터
let CC = [], BASES = []; // 코드 목록
const charts = {};

// ---------------- 포맷 ----------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function won(n) {               // 1억 4,748만원
  if (Math.abs(n) < 0.5) return '0원';
  const neg = n < 0; n = Math.abs(n);
  if (n < 10000) return (neg ? '−' : '') + Math.round(n).toLocaleString() + '원';
  const man = Math.round(n / 10000);
  const eok = Math.floor(man / 10000), rest = man % 10000;
  let s;
  if (man === 0) s = Math.round(n).toLocaleString() + '원';
  else if (eok && rest) s = eok.toLocaleString() + '억 ' + rest.toLocaleString() + '만원';
  else if (eok) s = eok.toLocaleString() + '억원';
  else s = rest.toLocaleString() + '만원';
  return (neg ? '−' : '') + s;
}
function wonShort(n) {          // 차트 축: 1.5억 / 3,000만
  const a = Math.abs(n), neg = n < 0 ? '-' : '';
  if (a >= 1e8) return neg + (a / 1e8).toFixed(a >= 1e10 ? 0 : 1) + '억';
  if (a >= 1e4) return neg + Math.round(a / 1e4).toLocaleString() + '만';
  return neg + Math.round(a).toLocaleString();
}
function manText(m) {           // 만원 입력 → 표시
  m = Math.round(+m || 0);
  if (m <= 0) return '없음';
  return won(m * 10000);
}
const pctS = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%';
const pct2 = v => (v * 100).toFixed(2) + '%';
const ymd = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const ymdDot = s => `${s.slice(2, 4)}.${s.slice(4, 6)}`;
/* 일반계좌에서 한 해 과세 금융소득(분배금 과세표준액 + 해외 ETF 매도차익)이 2,000만원을 넘으면 종합과세 경고.
   이 계산기는 15.4%만 반영하므로, 넘는 해를 알려 준다 (다른 금융소득·종합소득은 모름) */
const FIN_COMP_LINE = 20000000;
function finWarnHTML(byYear) {
  const over = Object.keys(byYear || {}).sort().filter(y => byYear[y] > FIN_COMP_LINE);
  if (!over.length) return '';
  const top = over.reduce((a, y) => (byYear[y] > byYear[a] ? y : a), over[0]);
  return `<br><span class="tag-mini" style="margin-left:0;">금융소득종합과세 대상</span> `
    + `${over.length === 1 ? `${top}년` : `${over[0]}~${over[over.length - 1]}년 중 ${over.length}개 해`} 과세 분배금·매도차익이 연 2,000만원을 넘습니다`
    + ` (최대 ${top}년 ${won(byYear[top])}). 이 계산은 15.4%만 반영해, 다른 소득에 따라 세금이 더 나오고 건보료도 늘 수 있습니다.`;
}
const nm = c => D.etfs[c] ? D.etfs[c].n : c;
const signCls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';

function idxFromInput(v, fallback, prev) {
  if (!v) return fallback;
  const s = v.replace(/-/g, '');
  const ds = D.dates;
  let lo = 0, hi = ds.length - 1;
  if (s <= ds[0]) return 0;
  if (s >= ds[hi]) return hi;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ds[mid] < s) lo = mid + 1; else hi = mid; }
  if (prev && ds[lo] > s && lo > 0) return lo - 1;   // 종료일이 휴장일이면 직전 거래일
  return lo;
}
const startOf = codes => Math.max(...codes.filter(Boolean).map(c => D.etfs[c].s));

function baseFor(cc) {
  const e = D.etfs[cc];
  const b = BASE_BY_CODE[cc] || BASE_BY_GROUP[e.grp];
  return b && D.etfs[b] ? b : '069500';
}

// ---------------- 셀렉트 ----------------
function ccOptions(withBases) {
  let h = '';
  if (withBases) {
    h += '<optgroup label="본주(일반 ETF)">' + BASES.map(c => `<option value="${c}">${esc(nm(c))}</option>`).join('') + '</optgroup>';
  }
  for (const [g, label] of GROUPS) {
    const list = CC.filter(c => D.etfs[c].grp === g);
    if (!list.length) continue;
    h += `<optgroup label="커버드콜 · ${esc(label)}">` + list.map(c => `<option value="${c}">${esc(nm(c))}</option>`).join('') + '</optgroup>';
  }
  return h;
}
function baseOptions() {
  return '<optgroup label="본주(일반 ETF)">' + BASES.map(c => `<option value="${c}">${esc(nm(c))}</option>`).join('') + '</optgroup>'
    + ccOptions(false);
}

// ---------------- 공통 입력 ----------------
const $ = id => document.getElementById(id);
const radio = name => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
function syncRadios() {
  document.querySelectorAll('.radio-opt').forEach(l => {
    const inp = l.querySelector('input'); l.classList.toggle('on', !!(inp && inp.checked));
  });
}
const unitCanvas = document.createElement('canvas').getContext('2d');
function placeUnits() {
  document.querySelectorAll('.input-wrap input[data-unit]').forEach(inp => {
    let tag = inp.parentNode.querySelector('.input-unit');
    if (!tag) { tag = document.createElement('span'); tag.className = 'input-unit'; tag.textContent = inp.dataset.unit; inp.after(tag); }
    const cs = getComputedStyle(inp);
    if (inp.value === '' || !inp.offsetWidth) { tag.style.visibility = 'hidden'; return; }
    unitCanvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = unitCanvas.measureText(inp.value).width;
    const left = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + w + 4 - inp.scrollLeft;
    tag.style.left = Math.round(left) + 'px';
    tag.style.fontSize = cs.fontSize;
    tag.style.visibility = left + tag.offsetWidth < inp.clientWidth - parseFloat(cs.paddingRight) + 8 ? 'visible' : 'hidden';
  });
}
function updateDisplays() {
  $('d-initial-display').textContent = manText($('d-initial').value);
  $('b-initial-display').textContent = manText($('b-initial').value);
  const m = +$('b-monthly').value || 0;
  $('b-monthly-display').textContent = m > 0 ? '월 ' + manText(m) : '없음';
  document.querySelectorAll('.chips[data-target]').forEach(ch => {
    const v = $(ch.dataset.target).value;
    ch.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', String(b.dataset.v) === String(v)));
  });
  placeUnits();
}

function setDateRange(prefix, codes, keep) {
  const s = startOf(codes), last = D.dates.length - 1;
  const st = $(prefix + '-start'), en = $(prefix + '-end');
  st.min = en.min = ymd(D.dates[s]);
  st.max = en.max = ymd(D.dates[last]);
  let si = keep ? idxFromInput(st.value, s) : s;
  if (si < s) si = s;
  let ei = keep ? idxFromInput(en.value, last, true) : last;
  if (ei > last) ei = last;
  if (ei <= si) { si = s; ei = last; }
  st.value = ymd(D.dates[si]); en.value = ymd(D.dates[ei]);
  const late = codes.filter(Boolean).filter(c => D.etfs[c].s === s && s > 0).map(nm);
  $(prefix + '-start-hint').textContent = s > 0
    ? `${ymd(D.dates[s])}부터 계산할 수 있어요${late.length ? ` (${late[0]} 기준)` : ''}`
    : `데이터 시작일 ${ymd(D.dates[0])}`;
}
function yearsBetween(i0, i1) {
  return (ymdToDate(D.dates[i1]) - ymdToDate(D.dates[i0])) / (365.25 * 86400000);
}
const yrText = y => y >= 1 ? `${(Math.round(y * 10) / 10).toFixed(1)}년` : `${Math.max(1, Math.round(y * 12))}개월`;

// ---------------- 차트 ----------------
const chartBase = {
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { labels: { font: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 13, weight: 600 }, color: '#1A1A1A', usePointStyle: true, padding: 16 } },
    tooltip: {
      backgroundColor: '#FBF7F0', titleColor: '#1A1A1A', bodyColor: '#3A2F26', borderColor: '#D9542B', borderWidth: 1.5,
      padding: 12, titleFont: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 13, weight: 800 }, bodyFont: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 12.5, weight: 600 },
      usePointStyle: true, boxPadding: 6, cornerRadius: 10,
      callbacks: { label: c => ` ${c.dataset.label}: ${won(c.parsed.y)}` },
    },
  },
};
const endLabelPlugin = {
  id: 'endLabel',
  afterDatasetsDraw(chart) {
    if (chart.config.type !== 'line') return;
    const { ctx } = chart; ctx.save();
    const labels = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden || ds._noEnd) return;
      const p = meta.data[ds.data.length - 1];
      if (p) labels.push({ x: p.x, y: p.y, color: ds.borderColor, text: ds._short || ds.label, value: ds.data[ds.data.length - 1] });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 18) labels[i].y = labels[i - 1].y + 18;
    const mobile = window.innerWidth < 768, fs = mobile ? 10 : 11;
    labels.forEach(l => {
      ctx.font = `700 ${fs}px Pretendard, sans-serif`;
      const text = `${l.text} ${wonShort(l.value)}`;
      const tw = ctx.measureText(text).width, padX = mobile ? 5 : 7, bh = fs + 8, bw = tw + padX * 2;
      const bx = Math.min(l.x - bw - 4, chart.chartArea.right - bw), by = l.y - bh / 2;
      ctx.fillStyle = '#FBF7F0'; ctx.strokeStyle = l.color; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4); else ctx.rect(bx, by, bw, bh);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = l.color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(text, bx + padX, l.y);
    });
    ctx.restore();
  },
};
function drawLine(id, labels, datasets, log) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), {
    type: 'line',
    data: { labels, datasets: datasets.map(d => Object.assign({ pointRadius: 0, pointHoverRadius: 3, borderWidth: 2.2, tension: 0, fill: false }, d)) },
    options: Object.assign({}, chartBase, {
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: window.innerWidth < 768 ? 5 : 8, autoSkip: true, maxRotation: 0, font: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 11, weight: 600 }, color: '#8B8276', callback(v) { return ymdDot(this.getLabelForValue(v)); } } },
        y: { type: log ? 'logarithmic' : 'linear', grid: { color: '#EDE5D6' }, ticks: { font: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 11, weight: 600 }, color: '#8B8276', callback: v => wonShort(v), maxTicksLimit: 7 } },
      },
      plugins: Object.assign({}, chartBase.plugins, { tooltip: Object.assign({}, chartBase.plugins.tooltip, { callbacks: { title: it => ymd(it[0].label), label: c => ` ${c.dataset.label}: ${won(c.parsed.y)}` } }) }),
    }),
    plugins: [endLabelPlugin],
  });
}
function drawBars(id, labels, datasets) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), {
    type: 'bar',
    data: { labels, datasets: datasets.map(d => Object.assign({ borderRadius: 3, maxBarThickness: 18 }, d)) },
    options: Object.assign({}, chartBase, {
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: window.innerWidth < 768 ? 6 : 12, autoSkip: true, maxRotation: 0, font: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 11, weight: 600 }, color: '#8B8276', callback(v) { const l = this.getLabelForValue(v); return l.slice(2, 4) + '.' + l.slice(4, 6); } } },
        y: { grid: { color: '#EDE5D6' }, ticks: { font: { family: "Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", size: 11, weight: 600 }, color: '#8B8276', callback: v => wonShort(v) } },
      },
      plugins: Object.assign({}, chartBase.plugins, { tooltip: Object.assign({}, chartBase.plugins.tooltip, { callbacks: { title: it => `${it[0].label.slice(0, 4)}년 ${+it[0].label.slice(4, 6)}월`, label: c => ` ${c.dataset.label}: ${won(c.parsed.y)}` } }) }),
    }),
  });
}
const segVal = id => ($(id).querySelector('button.on') || {}).dataset.v;

function yearEnds(i0, i1) {     // [{y, i}] 각 연도의 마지막 거래일(구간 안)
  const out = [];
  for (let i = i0; i <= i1; i++) {
    if (i === i1 || D.dates[i + 1].slice(0, 4) !== D.dates[i].slice(0, 4)) out.push({ y: D.dates[i].slice(0, 4), i });
  }
  return out;
}

// ============================================================
// 01 생활비 대결
// ============================================================
let duelRes = null;
function readDuel() {
  const cc = $('d-cc').value, base = $('d-base').value;
  const last = D.dates.length - 1, s = startOf([cc, base]);
  let i0 = Math.max(s, idxFromInput($('d-start').value, s));
  let i1 = Math.min(last, idxFromInput($('d-end').value, last, true));
  if (i1 <= i0) { i0 = s; i1 = last; }
  return {
    cc, base, i0, i1,
    initial: Math.max(0, +$('d-initial').value || 0) * 10000,
    taxMode: radio('d-tax'),
    mode: radio('d-mode'),
    rate: Math.min(30, Math.max(0.5, Number.isFinite(parseFloat($('d-rate').value)) ? parseFloat($('d-rate').value) : 4)),
    leftover: radio('d-mode') === 'rate' ? (($('d-left').querySelector('.chip.on') || {}).dataset.v || 'reinvest') : 'reinvest',
  };
}
function runDuelUI() {
  const o = readDuel();
  $('d-rate-wrap').style.opacity = o.mode === 'rate' ? 1 : 0.45;
  $('d-left-wrap').classList.toggle('is-hidden', o.mode !== 'rate');
  if (o.cc === o.base) { $('d-verdict-main').textContent = '커버드콜과 본주를 서로 다른 종목으로 골라 주세요.'; return; }
  if (o.initial <= 0) { $('d-verdict-main').textContent = '초기 투자금을 넣어 주세요.'; return; }
  const r = runDuel(D, o);
  duelRes = { o, r };
  const vA = r.A.value(o.i1), vB = r.B.value(o.i1);
  const yrs = yearsBetween(o.i0, o.i1);
  const ccName = nm(o.cc), bName = nm(o.base);
  const xA = xirr(D, [...r.A.flows, [o.i1, vA]]), xB = xirr(D, [...r.B.flows, [o.i1, vB]]);
  const monthKeys = [...new Set(D.dates.slice(o.i0, o.i1 + 1).map(d => d.slice(0, 6)))];
  const months = monthKeys.length;
  // 지금 다 판다면 낼 매매차익 세금(추정) — 일반계좌 + 국내주식형이 아닌 ETF만
  const gainTax = (acc, code) => {
    if (o.taxMode !== 'general' || D.etfs[code].dom) return 0;
    const q = acc.sh[code] || 0, p = priceAt(D, code, o.i1);
    return q && p ? Math.max(0, q * p - (acc.cost[code] || 0)) * 0.154 : 0;
  };
  const gA = gainTax(r.A, o.cc), gB = gainTax(r.B, o.base);
  const gainNote = (gA > 0 || gB > 0)
    ? `<span class="lump-note">남은 자산은 팔기 전 평가금액입니다. 지금 모두 판다면 매매차익 세금(추정)이 커버드콜 <strong>${won(gA)}</strong>, 본주 <strong>${won(gB)}</strong> 더 붙고, 이걸 빼면 남은 자산 차이(본주 − 커버드콜)는 <strong>${won((vB - gB) - (vA - gA))}</strong>입니다.</span>`
    : '';

  // 판정
  $('d-verdict-label').textContent = `${ymd(D.dates[o.i0])} ~ ${ymd(D.dates[o.i1])} · ${yrText(yrs)} · ${o.taxMode === 'general' ? '일반계좌' : '절세계좌'}`;
  if (o.mode === 'match') {
    const diff = vB - vA;
    $('d-verdict-main').innerHTML = `똑같이 <span class="hl">${won(r.A.spent)}</span>을 생활비로 쓴 뒤,<br>`
      + (Math.abs(diff) < 1 ? '두 사람에게 남은 돈은 거의 같습니다.'
        : `<span class="hl">${diff > 0 ? '본주' : '커버드콜'}</span> 쪽이 <span class="hl">${won(Math.abs(diff))}</span> 더 남았습니다.`);
    $('d-verdict-sub').innerHTML = `커버드콜은 분배금(세후)만으로, 본주는 같은 날 같은 금액을 꺼내 썼습니다. 처음 넣은 돈은 둘 다 <strong>${won(o.initial)}</strong>입니다.` + gainNote;
  } else {
    const tA = vA + r.A.spent, tB = vB + r.B.spent, diff = tB - tA;
    $('d-verdict-main').innerHTML = `쓴 생활비 <span class="hl">${won(r.A.spent)}</span> vs <span class="hl">${won(r.B.spent)}</span><br>`
      + `남은 자산까지 합치면 <span class="hl">${diff >= 0 ? '본주' : '커버드콜'}</span> 쪽이 <span class="hl">${won(Math.abs(diff))}</span> 많습니다.`;
    $('d-verdict-sub').innerHTML = `커버드콜은 분배금(세후)을 전부 생활비로, 본주는 매년 평가금액의 <strong>${o.rate}%</strong>를 매달 나눠 꺼냈습니다. 처음 넣은 돈은 둘 다 <strong>${won(o.initial)}</strong>입니다.` + gainNote;
  }

  const card = (cls, who, name, acc, v, x, extra, g) => `
    <div class="vs-card ${cls}">
      <div class="vs-who">${who}</div>
      <div class="vs-name">${esc(name)}</div>
      <div class="vs-line big"><span>남은 자산</span><b>${won(v)}</b></div>
      <div class="vs-line"><span>쓴 생활비 누계</span><b>${won(acc.spent)}</b></div>
      <div class="vs-line"><span>남은 자산 + 쓴 생활비</span><b>${won(v + acc.spent)}</b></div>
      <div class="vs-line"><span>낸 세금</span><b>${won(acc.tax)}</b></div>
      ${g > 0 ? `<div class="vs-line"><span>지금 팔면 낼 세금 (추정)</span><b>${won(g)}</b></div>` : ''}
      <div class="vs-line"><span>연환산 수익률 (생활비 포함)</span><b class="${signCls(x)}">${x == null ? '—' : pctS(x)}</b></div>
      ${extra || ''}
    </div>`;
  const dep = r.B.depletedAt != null ? `<span class="skull">💀 ${ymd(D.dates[r.B.depletedAt])}에 자산 소진</span>` : '';
  $('d-vs').innerHTML = card('a', '커버드콜 · 분배금으로 생활', ccName, r.A, vA, xA,
    `<div class="vs-line"><span>월평균 생활비 (${months}개월)</span><b>${won(r.A.spent / Math.max(1, months))}</b></div>`, gA)
    + card('b', o.mode === 'match' ? '본주 · 같은 금액을 팔아서 생활' : `본주 · 매년 ${o.rate}% 꺼내서 생활`, bName, r.B, vB, xB, dep, gB);

  // 차트 1
  const labels = D.dates.slice(o.i0, o.i1 + 1);
  const view = segVal('d-c1-view'), log = segVal('d-c1-scale') === 'log';
  const serA = view === 'total' ? r.sA.map((v, k) => v + r.cA[k]) : r.sA;
  const serB = view === 'total' ? r.sB.map((v, k) => v + r.cB[k]) : r.sB;
  $('d-c1-title').textContent = view === 'total' ? '남은 자산 + 쓴 생활비' : '남은 자산 비교';
  $('d-c1-sub').textContent = view === 'total' ? '지금까지 꺼내 쓴 생활비까지 더한 금액입니다. 같은 금액 방식이면 두 선의 생활비 부분은 같습니다.' : '생활비를 꺼내고 난 뒤 각자 계좌에 남은 평가금액입니다.';
  drawLine('d-chart1', labels, [
    { label: ccName, _short: '커버드콜', data: serA, borderColor: '#D9542B' },
    { label: bName, _short: '본주', data: serB, borderColor: '#8B6F47' },
    { label: '처음 넣은 돈', data: labels.map(() => o.initial), borderColor: '#9B9387', borderDash: [5, 4], borderWidth: 1.5, _noEnd: true },
  ], log);

  // 차트 2: 월별 생활비
  const keys = monthKeys;
  const ds2 = [{ label: '커버드콜 분배금(세후)', data: keys.map(k => r.mA.get(k) || 0), backgroundColor: '#D9542B' }];
  if (o.mode === 'rate') ds2.push({ label: '본주에서 꺼낸 생활비', data: keys.map(k => r.mB.get(k) || 0), backgroundColor: '#C4A57B' });
  $('d-c2-sub').textContent = o.mode === 'rate'
    ? '커버드콜 분배금(세후)과 본주에서 매달 꺼낸 생활비입니다. 분배금은 매달 같지 않습니다.'
    : '커버드콜 분배금(세후)이 달마다 얼마였는지 보여 줍니다. 본주도 같은 날 같은 금액을 꺼냈습니다.';
  drawBars('d-chart2', keys, ds2);

  // 표
  const rows = [];
  let pA = 0, pB = 0;
  for (const { y, i } of yearEnds(o.i0, o.i1)) {
    const k = i - o.i0;
    const sa = r.cA[k] - pA, sb = r.cB[k] - pB; pA = r.cA[k]; pB = r.cB[k];
    const gap = r.sB[k] - r.sA[k];
    rows.push(`<tr><td>${y}</td><td>${won(sa)}</td><td>${won(r.sA[k])}</td><td>${won(sb)}</td><td>${won(r.sB[k])}</td><td class="${signCls(gap)}">${gap >= 0 ? '+' : ''}${won(gap)}</td></tr>`);
  }
  $('d-table').querySelector('tbody').innerHTML = rows.join('');

  // 인사이트
  const short = yrs < 3 ? ` 다만 ${yrText(yrs)}은 짧은 기간이라, 시작일을 바꿔 가며 결과가 어떻게 달라지는지 꼭 확인해 보세요.` : ' 시작일을 바꿔 보면 결과가 어떻게 달라지는지도 확인할 수 있습니다.';
  const pr = totalReturn(D, o.base, o.i0, o.i1), pc = totalReturn(D, o.cc, o.i0, o.i1);
  const mkt = pr ? `같은 기간 ${bName}의 주가는 ${pctS(pr.price)}, ${ccName}의 주가는 ${pctS(pc.price)} 움직였습니다.` : '';
  if (o.mode === 'match') {
    if (vB >= vA) {
      $('d-insight-title').textContent = `같은 생활비를 쓰고도 본주 쪽이 ${won(vB - vA)} 더 남았습니다`;
      $('d-insight-desc').innerHTML = `${mkt} 커버드콜은 콜옵션을 팔아 받은 돈을 분배금으로 나눠 주는 대신, 크게 오를 때 상승분 일부를 포기합니다. <strong>분배금은 공짜가 아니라 미래 상승분을 미리 현금으로 받는 것</strong>에 가깝다는 뜻입니다.${short}`;
    } else {
      $('d-insight-title').textContent = `이 기간엔 커버드콜 쪽이 ${won(vA - vB)} 더 남았습니다`;
      $('d-insight-desc').innerHTML = `${mkt} 옆으로 기거나 내리는 구간에서는 옵션을 팔아 받은 돈이 <strong>방어막</strong> 역할을 합니다. 반대로 크게 오르는 구간이 끼면 결과가 뒤집힐 수 있습니다.${short}`;
    }
  } else {
    const tA = vA + r.A.spent, tB = vB + r.B.spent;
    $('d-insight-title').textContent = `생활비를 더 많이 쓴 쪽은 ${r.A.spent >= r.B.spent ? '커버드콜' : '본주'}, 남은 것까지 합치면 ${tB >= tA ? '본주' : '커버드콜'}`;
    $('d-insight-desc').innerHTML = `${mkt} 커버드콜은 분배금이 높은 만큼 매달 쓸 돈이 많지만, 그만큼 계좌에서 빠져나가는 돈도 많습니다. 본주를 정률로 꺼내면 생활비는 적어도 자산이 덜 줄어듭니다. <strong>얼마를 쓰고 얼마를 남길지</strong>는 인출률을 바꿔 가며 비교해 보세요.${short}`;
  }
  syncHash();
}

// ============================================================
// 02 분배금 재투자 백테스트
// ============================================================
function readBt() {
  const cc = $('b-cc').value, cmp = $('b-cmp').value, policy = radio('b-policy');
  const target = policy === 'other' ? $('b-target').value : null;
  const last = D.dates.length - 1, s = startOf([cc, cmp, target]);
  let i0 = Math.max(s, idxFromInput($('b-start').value, s));
  let i1 = Math.min(last, idxFromInput($('b-end').value, last, true));
  if (i1 <= i0) { i0 = s; i1 = last; }
  return {
    cc, cmp, policy, target, i0, i1,
    initial: Math.max(0, +$('b-initial').value || 0) * 10000,
    monthly: Math.max(0, +$('b-monthly').value || 0) * 10000,
    taxMode: radio('b-tax'),
  };
}
const POLICY_TEXT = { reinvest: '분배금을 같은 ETF에 재투자', other: '분배금으로 다른 ETF 매수', cash: '분배금을 현금으로 보유', spend: '분배금을 생활비로 사용' };
function runBtUI() {
  const o = readBt();
  $('b-target-wrap').classList.toggle('is-hidden', o.policy !== 'other');
  if (o.initial <= 0 && o.monthly <= 0) { $('b-verdict-main').textContent = '초기 투자금이나 월 적립액을 넣어 주세요.'; return; }
  const r = runBacktest(D, o);
  const vA = r.A.value(o.i1), vB = r.B.value(o.i1);
  const yrs = yearsBetween(o.i0, o.i1);
  const xA = xirr(D, [...r.A.flows, [o.i1, vA]]), xB = xirr(D, [...r.B.flows, [o.i1, vB]]);
  const twIndex = (vals, inv) => {   // 넣은 돈의 영향을 뺀 시간가중 지수
    const out = [1];
    for (let k = 1; k < vals.length; k++) {
      const prev = vals[k - 1], flow = inv[k] - inv[k - 1];
      out.push(prev > 0 ? out[k - 1] * (vals[k] - flow) / prev : out[k - 1]);
    }
    return out;
  };
  // MDD는 두 쪽 모두 계좌 잔고 기준 (생활비로 꺼내 쓴 돈은 더하지 않는다)
  const mA = mdd(twIndex(r.sA, r.sInv)), mB = mdd(twIndex(r.sB, r.sInv));
  const ccName = nm(o.cc), cmpName = nm(o.cmp);
  const stratName = `${ccName} · ${POLICY_TEXT[o.policy]}${o.policy === 'other' ? `(${nm(o.target)})` : ''}`;
  const totA = vA + r.A.spent;

  $('b-verdict-main').innerHTML = `넣은 돈 <span class="hl">${won(r.A.invested)}</span> → 내 전략 <span class="hl">${won(totA)}</span>`
    + `<br>같은 돈을 ${esc(cmpName)}에 넣었다면 <span class="hl">${won(vB)}</span>`;
  $('b-verdict-sub').innerHTML = `${ymd(D.dates[o.i0])} ~ ${ymd(D.dates[o.i1])} · ${yrText(yrs)} · ${o.taxMode === 'general' ? '일반계좌' : '절세계좌'} · ${esc(POLICY_TEXT[o.policy])}`
    + (o.policy === 'spend' ? `<br>내 전략 금액에는 생활비로 쓴 <strong>${won(r.A.spent)}</strong>이 포함돼 있습니다.` : '')
    + (o.policy === 'cash' ? `<br>내 전략 금액에는 쌓아 둔 현금 <strong>${won(r.A.cash)}</strong>이 포함돼 있습니다.` : '')
    + finWarnHTML(r.A.finByYear);

  const st = (cls, label, value, sub) => `<div class="stat-card ${cls}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
  $('b-stats').innerHTML =
    st('accent', '내 전략 최종 금액', won(totA), o.policy === 'spend' ? `남은 자산 ${won(vA)} + 쓴 생활비` : '팔기 전 평가금액')
    + st('', '비교 대상 최종 금액', won(vB), esc(cmpName) + ' · 분배금 재투자')
    + st('', '연환산 수익률 (XIRR)', `<span class="${signCls(xA)}">${xA == null ? '—' : pctS(xA)}</span>`, `비교 대상 ${xB == null ? '—' : pctS(xB)}`
      + (o.policy === 'spend' ? '<br>생활비는 받은 날 돌려받은 돈으로 계산해, 최종 금액이 같아도 ‘현금으로 보유’보다 높게 나옵니다' : ''))
    + st('', o.policy === 'spend' ? '최대 낙폭 (MDD · 계좌 잔고 기준)' : '최대 낙폭 (MDD)', `<span class="down">${pctS(mA)}</span>`, o.policy === 'spend' ? `비교 대상 ${pctS(mB)} · 둘 다 쓴 생활비 제외` : `비교 대상 ${pctS(mB)}`)
    + st('', '받은 분배금 (세후)', won(r.A.divNet), `세전 ${won(r.A.divGross)}`)
    + st('', '낸 세금', won(r.A.tax), o.taxMode === 'general' ? `비교 대상 ${won(r.B.tax)}` : '절세계좌 가정')
    + st('', '넣은 돈', won(r.A.invested), o.monthly > 0 ? `초기 ${won(o.initial)} + 월 ${won(o.monthly)}` : '거치식')
    + st('', '차이 (내 전략 − 비교)', `<span class="${signCls(totA - vB)}">${totA - vB >= 0 ? '+' : ''}${won(totA - vB)}</span>`, totA >= vB ? '내 전략이 많음' : '비교 대상이 많음');

  const labels = D.dates.slice(o.i0, o.i1 + 1);
  const log = segVal('b-scale') === 'log';
  const serA = o.policy === 'spend' ? r.sA.map((v, k) => v + r.sSpentA[k]) : r.sA;
  drawLine('b-chart', labels, [
    { label: o.policy === 'spend' ? '내 전략 (남은 자산 + 쓴 생활비)' : '내 전략', _short: '내 전략', data: serA, borderColor: '#D9542B' },
    { label: cmpName, _short: '비교', data: r.sB, borderColor: '#8B6F47' },
    { label: '넣은 돈 누계', data: r.sInv, borderColor: '#9B9387', borderDash: [5, 4], borderWidth: 1.5, _noEnd: true },
  ], log);
  $('b-c-sub').textContent = `${stratName} vs 같은 돈을 ${cmpName}에 그대로 넣고 분배금까지 재투자했을 때`;

  // 연도별: 그해 분배금·세금은 연말 누계 차이로
  const rows = [];
  const yrs2 = yearEnds(o.i0, o.i1);
  // 연도별 분배금·세금 누계를 구하려고 한 번 더 돌리지 않고, 계좌 기록을 연말마다 저장해 둔다
  const snap = btYearSnap(o);
  let pd = 0, pt = 0;
  yrs2.forEach(({ y, i }, n) => {
    const k = i - o.i0, sn = snap[n];
    rows.push(`<tr><td>${y}</td><td>${won(r.sInv[k])}</td><td>${won(serA[k])}</td><td>${won(r.sB[k])}</td><td>${won(sn.div - pd)}</td><td>${won(sn.tax - pt)}</td></tr>`);
    pd = sn.div; pt = sn.tax;
  });
  $('b-table').querySelector('tbody').innerHTML = rows.join('');
  $('b-table').querySelectorAll('th')[2].textContent = o.policy === 'spend' ? '내 전략 연말 자산 + 쓴 생활비' : '내 전략 연말 자산';

  // 인사이트
  const tr = totalReturn(D, o.cc, o.i0, o.i1);
  if (o.policy === 'cash' || o.policy === 'spend') {
    $('b-insight-title').textContent = `분배금을 재투자하지 않으면 주가만 남습니다 — ${ccName} 주가 ${pctS(tr.price)}`;
    $('b-insight-desc').innerHTML = `같은 기간 분배금을 전부 재투자했다면 총수익은 ${pctS(tr.total)}(세전)입니다. 가격 수익률과 총수익의 차이 <strong>${((tr.total - tr.price) * 100).toFixed(1)}%p</strong>가 분배금으로 꺼내 준 몫입니다. 커버드콜은 이 몫이 큰 상품이라, 분배금을 쓰면 원금(주가)이 얼마나 지켜지는지가 핵심입니다.`;
  } else if (o.policy === 'other') {
    $('b-insight-title').textContent = `분배금으로 ${nm(o.target)}를 사 모은 결과, 같은 ETF 재투자와 비교해 보세요`;
    $('b-insight-desc').innerHTML = `커버드콜에서 나온 현금으로 성장형 ETF를 사 모으면, 커버드콜이 포기한 상승분을 일부 되찾는 효과가 있습니다. 대신 분배금에 세금이 붙는 일반계좌에서는 떼인 세금만큼 덜 삽니다. 위에서 처리 방식을 "같은 ETF에 재투자"로 바꿔 차이를 확인해 보세요.`;
  } else {
    $('b-insight-title').textContent = totA >= vB ? `이 기간엔 커버드콜 재투자가 ${won(totA - vB)} 앞섰습니다` : `이 기간엔 ${cmpName}가 ${won(vB - totA)} 앞섰습니다`;
    $('b-insight-desc').innerHTML = `분배금을 전부 재투자해도 일반계좌에서는 분배금마다 세금(과세표준액 × 15.4%)을 떼고 다시 삽니다. 이 기간 낸 세금은 <strong>${won(r.A.tax)}</strong>입니다. 계좌를 절세계좌로 바꾸면 세금이 결과를 얼마나 바꾸는지 볼 수 있습니다.`;
  }
  syncHash();
}
function btYearSnap(o) {
  // runBacktest와 같은 계산을 연말마다 멈춰 누계 분배금(세후)·세금 기록
  const out = [];
  const ends = new Set(yearEnds(o.i0, o.i1).map(x => x.i));
  const r = runBacktest(D, Object.assign({}, o, { _snap: (i, A) => { if (ends.has(i)) out.push({ div: A.divNet, tax: A.tax }); } }));
  return out.length ? out : [{ div: r.A.divNet, tax: r.A.tax }];
}

// ============================================================
// 03 현황판
// ============================================================
let boardSort = { k: 'total', asc: false };
let boardGroup = 'all', boardGen = 'all';
function boardRows() {
  const last = D.dates.length - 1;
  const per = segVal('bd-period');
  const endDate = ymdToDate(D.dates[last]);
  const out = [];
  for (const c of CC) {
    const e = D.etfs[c];
    let i0;
    if (per === 'all') i0 = e.s;
    else {
      const from = new Date(endDate); from.setUTCFullYear(from.getUTCFullYear() - (+per));
      const fs = `${from.getUTCFullYear()}${String(from.getUTCMonth() + 1).padStart(2, '0')}${String(from.getUTCDate()).padStart(2, '0')}`;
      i0 = idxFromInput(ymd(fs));
      if (i0 < e.s) i0 = null;
    }
    const t12 = trailing12(D, c, last);
    const has12 = yearsBetween(e.s, last) >= 0.98;
    const p = priceAt(D, c, last);
    const tr = i0 != null ? totalReturn(D, c, i0, last) : null;
    const hasBase = !!(BASE_BY_CODE[c] || BASE_BY_GROUP[e.grp]);
    const b = baseFor(c);
    const bt = hasBase && i0 != null && D.etfs[b] && i0 >= D.etfs[b].s ? totalReturn(D, b, i0, last) : null;
    out.push({
      c, e, gen: GEN[c] || 'x', i0,
      y12: has12 ? t12.d / p : null, taxr: has12 && t12.d > 0 ? t12.t / t12.d : null,
      taxrPart: !has12 && t12.d > 0 ? t12.t / t12.d : null,
      price: tr ? tr.price : null, total: tr ? tr.total : null,
      base: bt ? bt.total : null, baseCode: hasBase ? b : null,
    });
  }
  return out;
}
function renderBoard() {
  let rows = boardRows().filter(r => (boardGroup === 'all' || r.e.grp === boardGroup) && (boardGen === 'all' || r.gen === boardGen));
  const k = boardSort.k, dir = boardSort.asc ? 1 : -1;
  rows.sort((a, b) => {
    if (k === 'name') return dir * a.e.n.localeCompare(b.e.n, 'ko');
    const va = a[k], vb = b[k];
    if (va == null && vb == null) return 0;
    if (va == null) return 1; if (vb == null) return -1;
    return dir * (va - vb);
  });
  document.querySelectorAll('#bd-table th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.k === k);
    th.classList.toggle('asc', th.dataset.k === k && boardSort.asc);
  });
  const per = segVal('bd-period');
  const html = rows.map(r => {
    const g = r.gen === 'x' ? '<span class="gen gx">분류 보류</span>' : `<span class="gen ${GEN_CLS[r.gen]}">${GEN_LABEL[r.gen]}</span>`;
    const from = r.i0 != null ? `<span class="cell-sub">${ymd(D.dates[r.i0])}부터</span>` : '';
    const na = `<span class="muted">${per === 'all' ? '—' : '상장 기간 부족'}</span>`;
    // 분배금 몫 = 화면에 보이는(소수 첫째 자리로 반올림한) 총수익 − 가격 수익률 → 두 칸을 더하면 총수익과 정확히 맞는다
    const shown = v => Math.sign(v) * Number(Math.abs(v * 100).toFixed(1));
    const gap = r.total != null && r.price != null ? shown(r.total) - shown(r.price) : null;
    return `<tr data-c="${r.c}">
      <td><span class="b-name">${esc(r.e.n)}</span><span class="b-meta">${g}${esc(GROUP_NAME[r.e.grp] || r.e.grp)} · 상장 ${esc(r.e.list || '-')}</span></td>
      <td>${r.y12 != null ? pct2(r.y12) : '<span class="muted">1년 미만</span>'}</td>
      <td>${r.taxr != null ? Math.round(r.taxr * 100) + '%' : r.taxrPart != null ? `<span class="muted">${Math.round(r.taxrPart * 100)}%</span><span class="cell-sub">상장 후 전체</span>` : '—'}</td>
      <td>${r.price != null ? `<span class="${signCls(r.price)}">${pctS(r.price)}</span>${from}` : na}</td>
      <td>${r.total != null ? `<span class="${signCls(r.total)}">${pctS(r.total)}</span>${gap != null ? `<span class="cell-sub">분배금 몫 ${gap.toFixed(1)}%p</span>` : ''}` : na}</td>
      <td>${r.base != null ? `<span class="${signCls(r.base)}">${pctS(r.base)}</span><span class="cell-sub">${esc(nm(r.baseCode))}</span>` : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
  $('bd-table').querySelector('tbody').innerHTML = html || '<tr><td colspan="6" class="muted">조건에 맞는 종목이 없습니다</td></tr>';
  const last = D.dates.length - 1;
  $('bd-note').innerHTML = `12개월 분배율 = 최근 12개월 분배금 합 ÷ ${ymd(D.dates[last])} 종가. 과세 비율 = 최근 12개월 과세표준액 합 ÷ 분배금 합(100%면 분배금 전액 과세). `
    + `본주 총수익은 같은 기간 비교 본주의 분배금 재투자(세전) 수익률이고, 비교할 본주가 마땅치 않은 종목은 비워 뒀습니다. 수익률은 ${per === 'all' ? '종목마다 계산 가능한 첫날(표에 표시)부터' : per + '년 전 같은 날부터'} ${ymd(D.dates[last])}까지입니다.`;
}

// ============================================================
// 해시·초기화
// ============================================================
let currentTab = 'duel';
function showTab(t) {
  currentTab = t;
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'panel-' + t));
  if (t === 'board') renderBoard();
  else if (t === 'bt') runBtUI();
  else runDuelUI();
  placeUnits();
  syncHash();
}
let hashLock = false;
function syncHash() {
  if (hashLock || !D) return;
  const code = currentTab === 'bt' ? $('b-cc').value : $('d-cc').value;
  const h = currentTab === 'board' ? '#board' : `#${code.toLowerCase()}${currentTab === 'bt' ? '-bt' : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function applyHash() {
  const h = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  if (!h) return false;
  if (h === 'BOARD') {
    // 멤버십: 잠겨 있으면 현황판 대신 생활비 대결로 열고 안내만 띄운다
    if (window.TJLock && TJLock.locked()) { TJLock.prompt('현황판'); syncHash(); return false; }
    showTab('board'); return true;
  }
  const [code, tab] = h.split('-');
  if (!D.etfs[code] || D.etfs[code].kind !== 'cc') return false;
  hashLock = true;
  selectCC(code);
  hashLock = false;
  // 멤버십: 잠겨 있으면 백테스트 대신 생활비 대결로 (종목 선택은 그대로)
  if (tab === 'BT' && window.TJLock && TJLock.locked()) { showTab('duel'); TJLock.prompt('재투자 백테스트'); return true; }
  showTab(tab === 'BT' ? 'bt' : 'duel');
  return true;
}
function selectCC(code) {
  $('d-cc').value = code; $('b-cc').value = code;
  const b = baseFor(code);
  $('d-base').value = b; $('b-cmp').value = b; $('b-target').value = b;
  pairHint();
  setDateRange('d', [code, b], false);
  setDateRange('b', [code, b, radio('b-policy') === 'other' ? b : null], false);
}
function pairHint() {
  const c = $('d-cc').value, e = D.etfs[c];
  const g = GEN[c] ? GEN_LABEL[GEN[c]] : '세대 분류 보류';
  $('d-pair-hint').textContent = `${e.n} · ${GROUP_NAME[e.grp] || e.grp} · ${g}${e.desc ? ' · ' + e.desc : ''}`;
  const c2 = $('b-cc').value, e2 = D.etfs[c2];
  $('b-pair-hint').textContent = `${e2.n} · ${GROUP_NAME[e2.grp] || e2.grp} · ${GEN[c2] ? GEN_LABEL[GEN[c2]] : '세대 분류 보류'}${e2.desc ? ' · ' + e2.desc : ''}`;
}

function bind() {
  document.querySelectorAll('.mode-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  // 생활비 대결
  $('d-cc').addEventListener('change', () => {
    const c = $('d-cc').value; $('d-base').value = baseFor(c); pairHint();
    setDateRange('d', [c, $('d-base').value], false); runDuelUI();
  });
  $('d-base').addEventListener('change', () => { setDateRange('d', [$('d-cc').value, $('d-base').value], true); runDuelUI(); });
  ['d-start', 'd-end', 'd-rate'].forEach(id => $(id).addEventListener('change', runDuelUI));
  document.querySelectorAll('input[name="d-tax"],input[name="d-mode"]').forEach(x => x.addEventListener('change', () => {
    // 멤버십: 키보드 등으로 정률을 고른 경우에도 막고 같은 금액으로 되돌린다
    if (x.name === 'd-mode' && x.value === 'rate' && x.checked && window.TJLock && !TJLock.allow('정률 인출')) document.querySelector('input[name="d-mode"][value="match"]').checked = true;
    syncRadios(); runDuelUI();
  }));
  $('d-left').addEventListener('click', ev => {
    const b = ev.target.closest('.chip'); if (!b) return;
    $('d-left').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); runDuelUI();
  });
  ['d-c1-view', 'd-c1-scale', 'b-scale', 'bd-period'].forEach(id => $(id).addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (id === 'bd-period') renderBoard(); else if (id === 'b-scale') runBtUI(); else runDuelUI();
  }));
  // 백테스트
  $('b-cc').addEventListener('change', () => {
    const c = $('b-cc').value, b = baseFor(c);
    $('b-cmp').value = b; if (radio('b-policy') !== 'other') $('b-target').value = b; pairHint();
    setDateRange('b', [c, b, radio('b-policy') === 'other' ? $('b-target').value : null], false); runBtUI();
  });
  ['b-cmp', 'b-target'].forEach(id => $(id).addEventListener('change', () => {
    setDateRange('b', [$('b-cc').value, $('b-cmp').value, radio('b-policy') === 'other' ? $('b-target').value : null], true); runBtUI();
  }));
  document.querySelectorAll('input[name="b-policy"],input[name="b-tax"]').forEach(x => x.addEventListener('change', () => {
    syncRadios();
    setDateRange('b', [$('b-cc').value, $('b-cmp').value, radio('b-policy') === 'other' ? $('b-target').value : null], true);
    runBtUI();
  }));
  ['b-start', 'b-end'].forEach(id => $(id).addEventListener('change', runBtUI));
  // 금액 입력·칩
  let t = null;
  ['d-initial', 'b-initial', 'b-monthly'].forEach(id => $(id).addEventListener('input', () => {
    updateDisplays(); clearTimeout(t);
    t = setTimeout(() => (id[0] === 'd' ? runDuelUI() : runBtUI()), 250);
  }));
  document.querySelectorAll('.chips[data-target]').forEach(ch => ch.addEventListener('click', ev => {
    const b = ev.target.closest('.chip'); if (!b) return;
    $(ch.dataset.target).value = b.dataset.v; updateDisplays();
    ch.dataset.target[0] === 'd' ? runDuelUI() : runBtUI();
  }));
  // 현황판
  $('bd-group').addEventListener('click', ev => {
    const b = ev.target.closest('.chip'); if (!b) return;
    boardGroup = b.dataset.v; $('bd-group').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); renderBoard();
  });
  $('bd-gen').addEventListener('click', ev => {
    const b = ev.target.closest('.chip'); if (!b) return;
    boardGen = b.dataset.v; $('bd-gen').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); renderBoard();
  });
  document.querySelectorAll('#bd-table th').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    boardSort = boardSort.k === k ? { k, asc: !boardSort.asc } : { k, asc: k === 'name' };
    renderBoard();
  }));
  $('bd-table').querySelector('tbody').addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-c]'); if (!tr) return;
    selectCC(tr.dataset.c); showTab('duel');
    document.querySelector('.mode-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('hashchange', applyHash);
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(placeUnits, 150); });
}

async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    D = makeData(raw);
    CC = Object.keys(raw.etfs).filter(c => raw.etfs[c].kind === 'cc');
    BASES = Object.keys(raw.etfs).filter(c => raw.etfs[c].kind === 'base');
    let lastDiv = '';
    for (const c of CC) for (const r of raw.etfs[c].dv) if (raw.dates[r[0]] > lastDiv) lastDiv = raw.dates[r[0]];
    $('data-line').innerHTML = `국내상장 커버드콜 <b>${CC.length}종</b> · 종가 <b>${ymd(raw.priceDate)}</b> 기준 · 분배금·과세표준액은 <b>${ymd(lastDiv)}</b> 분배락분까지 · 계산 가능한 기간은 최대 <b>${ymd(raw.dates[0])}</b>부터`;
    $('foot-date').textContent = `종가 ${ymd(raw.priceDate)} 기준 · 데이터는 평일 저녁 자동 갱신`;
  } catch (ex) {
    $('data-line').textContent = '';
    $('app-error').innerHTML = `<div class="err">데이터를 불러오지 못했습니다(${esc(ex.message)}). 잠시 뒤 새로고침해 주세요.</div>`;
    return;
  }
  $('d-cc').innerHTML = ccOptions(false); $('b-cc').innerHTML = ccOptions(false);
  $('d-base').innerHTML = baseOptions(); $('b-cmp').innerHTML = baseOptions(); $('b-target').innerHTML = baseOptions();
  $('bd-group').innerHTML = '<button class="chip on" data-v="all">전체</button>' + GROUPS.filter(([g]) => CC.some(c => D.etfs[c].grp === g)).map(([g, l]) => `<button class="chip" data-v="${g}">${esc(l)}</button>`).join('');
  $('bd-gen').innerHTML = '<button class="chip on" data-v="all">전체</button>' + ['1', '2', '2.5', '3'].map(g => `<button class="chip" data-v="${g}">${GEN_LABEL[g]}</button>`).join('') + '<button class="chip" data-v="x">분류 보류</button>';
  bind();
  updateDisplays();
  if (!applyHash()) { selectCC(D.etfs['289480'] ? '289480' : CC[0]); showTab('duel'); }
}
init();
