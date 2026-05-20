// 단위 테스트: computeMonthlyData() 집계 검증
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};
const numFn = grab(/function num\(v\)[\s\S]*?return isFinite\(n\) \? n : 0;[\s\S]*?\}/, 'num');
const distFn = grab(/function computeMonthlyDistribution[\s\S]*?return \{ partners: rows, distributable, ratioSum, ratioOk, subtractDiscounts \};[\s\S]*?\}/, 'computeMonthlyDistribution');
const purchaseFn = grab(/function computePurchaseFromRec[\s\S]*?return \{ purchaseSupply: supply, purchaseVat: vat, purchaseTotal: total, byCategory \};[\s\S]*?\}/, 'computePurchaseFromRec');
const computeMD = grab(/function computeMonthlyData[\s\S]*?\n\}/, 'computeMonthlyData');
const resolveFx = grab(/function resolveFixedExpensesForMonth[\s\S]*?\n\}/, 'resolveFixedExpensesForMonth');
const ratFn = grab(/function computeCostRatios[\s\S]*?\n\}/, 'computeCostRatios');
const ratLvl = grab(/function _ratioLevel[\s\S]*?\n\}/, '_ratioLevel');
const thresh = grab(/const COST_RATIO_THRESHOLDS = \{[\s\S]*?\};/, 'thresholds');

const src = `
  let _records = {};
  let _partners = [];
  let _subtract = false;
  let _fixed = [];
  function getAllRecords() { return _records; }
  function getPartners() { return _partners; }
  function getDistSubtractDiscounts() { return _subtract; }
  function getFixedExpenses() { return _fixed; }
  function computeTotalsFor(rec) {
    return rec.totals || { posTotal: 0, supply: 0, vat: 0, posCard: 0, posCash: 0, posEtc: 0, cardTotal: 0 };
  }
  ${thresh}
  ${numFn}
  ${ratLvl}
  ${ratFn}
  ${purchaseFn}
  ${resolveFx}
  ${distFn}
  ${computeMD}
  return {
    num, computeMonthlyData,
    setRecords: (r) => { _records = r; },
    setPartners: (p) => { _partners = p; },
    setSubtract: (v) => { _subtract = v; }
  };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}

// 테스트 데이터 — 2026-05월에 2일치 마감
const rec1 = {
  totals: { posTotal: 1100000, supply: 1000000, vat: 100000 },
  purchaseRows: [{ supply: 300000, vat: 30000, total: 330000, category: '식자재' }],
  payrollRows: [{ amount: 100000 }],
  extras: { expenses: 50000, discounts: 20000 },
  status: 'closed'
};
const rec2 = {
  totals: { posTotal: 2200000, supply: 2000000, vat: 200000 },
  purchaseRows: [{ supply: 400000, vat: 40000, total: 440000, category: '식자재' }, { supply: 100000, vat: 0, total: 100000, category: '소모품' }],
  payrollRows: [],
  extras: { expenses: 30000, discounts: 10000 },
  status: 'closed'
};
mod.setRecords({
  '2026-05-18': rec1,
  '2026-05-19': rec2,
  '2026-04-30': { totals: { posTotal: 999, supply: 999, vat: 0 } } // 다른 달 — 무시 대상
});

// CASE 1: 월 필터링과 합계
mod.setPartners([{ name: 'A', ratio: 50 }, { name: 'B', ratio: 50 }]);
mod.setSubtract(false);
let d = mod.computeMonthlyData('2026-05');
check('1) 영업일=2일 (4월 데이터 제외)', d.dates.length === 2);
check('1) 매출 합계', d.sumSales === 3300000, `got ${d.sumSales}`);
check('1) 공급가 합계', d.sumSalesSupply === 3000000);
check('1) 매출세액', d.sumSalesVat === 300000);
check('1) 매입공급가', d.sumPSupply === 800000, `got ${d.sumPSupply}`);
check('1) 매입세액', d.sumPVat === 70000);
check('1) 기타비용', d.sumExtra === 80000);
check('1) 인건비', d.sumPayroll === 100000);
check('1) 할인 합계', d.sumDiscounts === 30000);
// monthPL = 3,000,000 - (800,000 + 80,000 + 100,000) = 2,020,000
check('1) 월 손익', d.monthPL === 2020000, `got ${d.monthPL}`);
check('1) 납부세액', d.payableVat === 230000);

// CASE 2: 매입 분류 합계
check('2) 분류 식자재', d.byCategory['식자재'] === 770000, `got ${d.byCategory['식자재']}`);
check('2) 분류 소모품', d.byCategory['소모품'] === 100000);

// CASE 3: 분배 (50/50, subtract off)
check('3) 분배 대상=monthPL', d.dist.distributable === 2020000);
check('3) A 분배', d.dist.partners[0].amount === 1010000);

// CASE 4: 컴프 차감 토글
mod.setSubtract(true);
d = mod.computeMonthlyData('2026-05');
check('4) 분배 대상 = monthPL - sumDiscounts', d.dist.distributable === 2020000 - 30000);

// CASE 5: 일자별 행 길이/필드
check('5) dailyRows.length=2', d.dailyRows.length === 2);
check('5) row[0].date', d.dailyRows[0].date === '2026-05-18');
check('5) row[0].discounts', d.dailyRows[0].discounts === 20000);
check('5) row[0].pl', d.dailyRows[0].pl === 1000000 - 300000 - 50000 - 100000);

// CASE 6: 데이터 없는 월
mod.setSubtract(false);
d = mod.computeMonthlyData('2026-06');
check('6) 데이터 없음 → null', d === null);

// CASE 7: month 미지정 → null
d = mod.computeMonthlyData('');
check('7) month 빈값 → null', d === null);

if (!process.exitCode) console.log('\n전체 통과');
