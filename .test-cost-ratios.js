// 단위 테스트: computeCostRatios() + 임계치 분류
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};
const numFn = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const thresh = grab(/const COST_RATIO_THRESHOLDS = \{[\s\S]*?\n\};/, 'COST_RATIO_THRESHOLDS');
const lvlFn = grab(/function _ratioLevel[\s\S]*?\n\}/, '_ratioLevel');
const cmpFn = grab(/function computeCostRatios[\s\S]*?\n\}/, 'computeCostRatios');

const src = `
  // computeTotalsFor stub — 테스트에서 rec.totals만 사용
  function computeTotalsFor(rec) { return rec.totals || { supply: 0 }; }
  ${numFn}
  ${thresh}
  ${lvlFn}
  ${cmpFn}
  return { num, computeCostRatios, _ratioLevel, COST_RATIO_THRESHOLDS };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}
const near = (a, b, eps = 0.001) => Math.abs(a - b) < eps;

// CASE 1: 표준 식당 시나리오 — 매출 1,000,000 / 식자재 300,000 / 주류 80,000 / 인건비 250,000
const rec = {
  totals: { supply: 1000000 },
  purchaseRows: [
    { category: '식자재', supply: 300000 },
    { category: '주류/음료', supply: 80000 },
    { category: '임대료', supply: 100000 }  // 분모/분자에 안 들어감
  ],
  payrollRows: [{ amount: 250000 }]
};
let cr = mod.computeCostRatios(rec);
check('1) salesSupply', cr.salesSupply === 1000000);
check('1) foodSupply', cr.foodSupply === 300000);
check('1) beverageSupply', cr.beverageSupply === 80000);
check('1) foodCost', cr.foodCost === 380000);
check('1) laborTotal', cr.laborTotal === 250000);
check('1) primeCost', cr.primeCost === 630000);
check('1) foodCostRatio = 38%', near(cr.foodCostRatio, 0.38));
check('1) laborRatio = 25%', near(cr.laborRatio, 0.25));
check('1) primeCostRatio = 63%', near(cr.primeCostRatio, 0.63));

// CASE 2: 매출 0 → 모든 비율 0 (NaN 방지)
cr = mod.computeCostRatios({ totals: { supply: 0 }, purchaseRows: [{ category: '식자재', supply: 100 }], payrollRows: [] });
check('2) 매출0 → ratio=0', cr.foodCostRatio === 0 && cr.laborRatio === 0 && cr.primeCostRatio === 0);

// CASE 3: 매입카테고리 '인건비'도 인건비에 합산
cr = mod.computeCostRatios({
  totals: { supply: 1000000 },
  purchaseRows: [{ category: '인건비', supply: 50000 }],
  payrollRows: [{ amount: 200000 }]
});
check('3) 매입+payroll 인건비 합산', cr.laborTotal === 250000);

// CASE 4: 배열 입력 (월 단위)
cr = mod.computeCostRatios([
  { totals: { supply: 500000 }, purchaseRows: [{ category: '식자재', supply: 150000 }], payrollRows: [{ amount: 100000 }] },
  { totals: { supply: 500000 }, purchaseRows: [{ category: '식자재', supply: 200000 }], payrollRows: [{ amount: 100000 }] }
]);
check('4) 배열 매출 합산', cr.salesSupply === 1000000);
check('4) 배열 식자재 합산', cr.foodSupply === 350000);
check('4) 배열 인건비 합산', cr.laborTotal === 200000);
check('4) foodCostRatio = 35%', near(cr.foodCostRatio, 0.35));

// CASE 5: 임계치 분류 (식자재)
const tFood = mod.COST_RATIO_THRESHOLDS.food;
check('5-a) 25% → ok', mod._ratioLevel(25, tFood) === 'ok');
check('5-b) 32% → normal', mod._ratioLevel(32, tFood) === 'normal');
check('5-c) 38% → warn', mod._ratioLevel(38, tFood) === 'warn');
check('5-d) 45% → danger', mod._ratioLevel(45, tFood) === 'danger');

// CASE 6: 임계치 (Prime Cost)
const tP = mod.COST_RATIO_THRESHOLDS.prime;
check('6-a) 50% → ok', mod._ratioLevel(50, tP) === 'ok');
check('6-b) 58% → normal', mod._ratioLevel(58, tP) === 'normal');
check('6-c) 63% → warn', mod._ratioLevel(63, tP) === 'warn');
check('6-d) 70% → danger', mod._ratioLevel(70, tP) === 'danger');

// CASE 7: null/빈 입력 안전 처리
cr = mod.computeCostRatios([]);
check('7-a) 빈 배열 → salesSupply=0', cr.salesSupply === 0);
cr = mod.computeCostRatios([null, undefined, { totals: null }]);
check('7-b) null 섞임 → 에러 없이 0', cr.salesSupply === 0);

// CASE 8: purchaseRows/payrollRows 없는 record
cr = mod.computeCostRatios({ totals: { supply: 100000 } });
check('8) 매입/급여 없음 → 분자 0', cr.foodCost === 0 && cr.laborTotal === 0 && cr.primeCostRatio === 0);

// CASE 9: opts.extraLabor 옵션 (고정비 인건비)
const baseRec = { totals: { supply: 10000000 }, purchaseRows: [{ category: '식자재', supply: 3000000 }], payrollRows: [{ amount: 500000 }] };
cr = mod.computeCostRatios(baseRec, { extraLabor: 1200000 });
check('9-a) extraLabor 적용', cr.extraLabor === 1200000);
check('9-b) laborTotal = payroll + extra', cr.laborTotal === 500000 + 1200000);
check('9-c) primeCost 포함', cr.primeCost === 3000000 + 500000 + 1200000);
check('9-d) laborRatio = (500k+1200k)/10M = 17%', near(cr.laborRatio, 0.17));

// CASE 10: opts 없으면 기존 동작 유지 (회귀 안전성)
cr = mod.computeCostRatios(baseRec);
check('10) opts 없음 → extraLabor=0', cr.extraLabor === 0);
check('10) laborTotal payroll만', cr.laborTotal === 500000);

if (!process.exitCode) console.log('\n전체 통과');
