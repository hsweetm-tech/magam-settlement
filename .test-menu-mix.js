// 단위 테스트: computeMenuMix · computeHourWeekdayHeatmap · computeAvgCheckTrend
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};
const numFn = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const mix = grab(/function computeMenuMix[\s\S]*?\n\}/, 'computeMenuMix');
const heat = grab(/function computeHourWeekdayHeatmap[\s\S]*?\n\}/, 'computeHourWeekdayHeatmap');
const trend = grab(/function computeAvgCheckTrend[\s\S]*?\n\}/, 'computeAvgCheckTrend');

const src = `
  ${numFn}
  ${mix}
  ${heat}
  ${trend}
  return { num, computeMenuMix, computeHourWeekdayHeatmap, computeAvgCheckTrend };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// ===== computeMenuMix =====
// CASE 1: ABC 분류 — A(80%) / B(80~95%) / C(95~100%)
let recs = [
  { posRows: [
    { menu: '시그니처A', qty: 10, amount: 800000 },  // 80%
    { menu: '보조B',    qty: 3,  amount: 150000 },  // 15%
    { menu: '주변C',    qty: 1,  amount: 50000 }   // 5%
  ]}
];
let mix1 = mod.computeMenuMix(recs);
check('1) 3종 정렬됨', mix1.length === 3 && mix1[0].menu === '시그니처A');
check('1) A급 80%', mix1[0].sharePct === 80);
check('1) A 클래스', mix1[0].class === 'A');
check('1) B 클래스', mix1[1].class === 'B');
check('1) C 클래스', mix1[2].class === 'C');
check('1) 누적 100', near(mix1[2].cumPct, 100));
check('1) 평균객단가 A', mix1[0].avgPrice === 80000);

// CASE 2: 빈 데이터
let mix2 = mod.computeMenuMix([]);
check('2) 빈 입력 → []', mix2.length === 0);

// CASE 3: 같은 메뉴 여러 일자 합산
recs = [
  { posRows: [{ menu: 'X', qty: 2, amount: 20000 }] },
  { posRows: [{ menu: 'X', qty: 3, amount: 30000 }] },
  { posRows: [{ menu: 'Y', qty: 1, amount: 5000 }] }
];
let mix3 = mod.computeMenuMix(recs);
check('3) 일자 횡단 합산 X', mix3[0].menu === 'X' && mix3[0].qty === 5 && mix3[0].sales === 50000);

// CASE 4: 빈 menu 이름은 스킵
recs = [{ posRows: [{ menu: '', qty: 1, amount: 1000 }, { menu: '  ', qty: 1, amount: 1000 }, { menu: 'Z', qty: 1, amount: 1000 }] }];
let mix4 = mod.computeMenuMix(recs);
check('4) 빈 메뉴 스킵', mix4.length === 1 && mix4[0].menu === 'Z');

// CASE 5: qty 누락 → 1로 처리
recs = [{ posRows: [{ menu: 'W', amount: 5000 }] }];
let mix5 = mod.computeMenuMix(recs);
check('5) qty 없으면 1', mix5[0].qty === 1);

// ===== computeHourWeekdayHeatmap =====
// CASE 6: 시간 분리 정확
recs = [
  { date: '2026-05-18', posRows: [{ time: '12:30', amount: 50000 }, { time: '13:15', amount: 30000 }] }  // 월요일
];
let mat = mod.computeHourWeekdayHeatmap(recs);
check('6) 월요일=1, 12시', mat[1][12].sales === 50000 && mat[1][12].count === 1);
check('6) 13시', mat[1][13].sales === 30000);
check('6) 다른 셀=0', mat[2][12].sales === 0);

// CASE 7: 'HH' 형식 (콜론 없음)도 처리
recs = [{ date: '2026-05-19', posRows: [{ time: '14', amount: 10000 }] }];
mat = mod.computeHourWeekdayHeatmap(recs);
check('7) 콜론 없는 시간', mat[2][14].sales === 10000);

// CASE 8: 시간 없는 행은 스킵
recs = [{ date: '2026-05-18', posRows: [{ amount: 99999 }] }];
mat = mod.computeHourWeekdayHeatmap(recs);
let totalCells = 0;
for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) totalCells += mat[w][h].count;
check('8) 시간 없으면 스킵', totalCells === 0);

// CASE 9: 잘못된 날짜 → 스킵
recs = [{ date: 'invalid', posRows: [{ time: '12:00', amount: 1000 }] }];
mat = mod.computeHourWeekdayHeatmap(recs);
totalCells = 0;
for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) totalCells += mat[w][h].count;
check('9) 잘못된 날짜 스킵', totalCells === 0);

// ===== computeAvgCheckTrend =====
// CASE 10: 일별 객단가 정렬
recs = [
  { date: '2026-05-20', totals: { posTotal: 200000 }, posRows: [{}, {}, {}, {}] },  // 50,000
  { date: '2026-05-18', totals: { posTotal: 100000 }, posRows: [{}, {}] },          // 50,000
  { date: '2026-05-19', totals: { posTotal: 150000 }, posRows: [{}, {}, {}] }       // 50,000
];
let tr = mod.computeAvgCheckTrend(recs);
check('10) 날짜 오름차순', tr[0].date === '2026-05-18' && tr[2].date === '2026-05-20');
check('10) 객단가 모두 50,000', tr.every(x => x.avgCheck === 50000));

// CASE 11: 영수증 0건 → avgCheck=0
recs = [{ date: '2026-05-20', totals: { posTotal: 0 }, posRows: [] }];
tr = mod.computeAvgCheckTrend(recs);
check('11) 0건 → avgCheck=0', tr[0].avgCheck === 0 && tr[0].count === 0);

// CASE 12: null record 안전 처리
tr = mod.computeAvgCheckTrend([null, { date: '2026-05-20', totals: { posTotal: 10000 }, posRows: [{}] }, undefined]);
check('12) null 무시', tr.length === 1 && tr[0].avgCheck === 10000);

if (!process.exitCode) console.log('\n전체 통과');
