// 단위 테스트: resolveFixedExpensesForMonth + computeMonthlyData 통합 (고정비 자동 반영)
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};

const numFn = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const resolveFn = grab(/function resolveFixedExpensesForMonth[\s\S]*?\n\}/, 'resolveFixedExpensesForMonth');
const distFn = grab(/function computeMonthlyDistribution[\s\S]*?\n\}/, 'computeMonthlyDistribution');
const ratFn = grab(/function computeCostRatios[\s\S]*?\n\}/, 'computeCostRatios');
const purchaseFn = grab(/function computePurchaseFromRec[\s\S]*?\n\}/, 'computePurchaseFromRec');
const monthFn = grab(/function computeMonthlyData[\s\S]*?\n\}/, 'computeMonthlyData');
const prorateFn = grab(/function _proratedMonthFactor[\s\S]*?\n\}/, '_proratedMonthFactor');
const ratLvl = grab(/function _ratioLevel[\s\S]*?\n\}/, '_ratioLevel');
const thresh = grab(/const COST_RATIO_THRESHOLDS = \{[\s\S]*?\};/, 'thresholds');
const cogs = grab(/const COGS_CATEGORIES = \[[\s\S]*?\];/, 'COGS_CATEGORIES');
const expCats = grab(/const EXPENSE_CATEGORIES = \[[\s\S]*?\];/, 'EXPENSE_CATEGORIES');

const src = `
  let _records = {};
  let _fixedExpenses = [];
  let _partners = [];
  let _subtract = false;
  function getAllRecords() { return _records; }
  function getPartners() { return _partners; }
  function getDistSubtractDiscounts() { return _subtract; }
  function getFixedExpenses() { return _fixedExpenses; }
  function computeTotalsFor(rec) { return rec.totals || { posTotal: 0, supply: 0, vat: 0 }; }
  ${expCats}
  ${cogs}
  ${thresh}
  ${numFn}
  ${ratLvl}
  ${ratFn}
  ${purchaseFn}
  ${resolveFn}
  ${prorateFn}
  ${distFn}
  ${monthFn}
  return {
    num, computeMonthlyData, resolveFixedExpensesForMonth,
    setRecords: (r) => { _records = r; },
    setFixed: (f) => { _fixedExpenses = f; }
  };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}

// CASE 1: 고정비 자동 반영 (해당 월 매입행 없음)
mod.setRecords({
  '2026-05-01': {
    totals: { posTotal: 11000000, supply: 10000000, vat: 1000000 },
    purchaseRows: [{ category: '식자재', supply: 3000000, vat: 300000, total: 3300000 }],
    payrollRows: [{ amount: 2500000 }],
    extras: { expenses: 0 }
  }
});
mod.setFixed([
  { name: '임대료', category: '임대료', amount: 3000000 },
  { name: '관리비', category: '관리비', amount: 200000 }
]);
let d = mod.computeMonthlyData('2026-05');
check('1) sumFixedApplied = 3,200,000', d.sumFixedApplied === 3200000, `got ${d.sumFixedApplied}`);
check('1) monthPL 고정비 차감됨', d.monthPL === 10000000 - 3000000 - 2500000 - 3200000, `got ${d.monthPL}`);
check('1) bySupplyCategory 임대료 포함', d.bySupplyCategory['임대료'] === 3000000);

// CASE 2: 해당 월에 매입행 있으면 설정값 무시
mod.setRecords({
  '2026-06-01': {
    totals: { posTotal: 5500000, supply: 5000000, vat: 500000 },
    purchaseRows: [
      { category: '식자재', supply: 1500000, vat: 150000, total: 1650000 },
      { category: '임대료', supply: 3500000, vat: 0, total: 3500000 }  // 매입행 직접 입력
    ],
    payrollRows: [],
    extras: { expenses: 0 }
  }
});
mod.setFixed([{ name: '임대료', category: '임대료', amount: 3000000 }]);
d = mod.computeMonthlyData('2026-06');
check('2) 매입행 있으면 설정값 무시', d.sumFixedApplied === 0);
check('2) 임대료 = 매입행 그대로', d.bySupplyCategory['임대료'] === 3500000);
const expected2PL = 5000000 - (1500000 + 3500000) - 0 - 0;
check('2) monthPL 매입행만 반영', d.monthPL === expected2PL, `got ${d.monthPL}, expected ${expected2PL}`);

// CASE 3: 부분 적용 — 임대료는 매입행 있고, 관리비는 없음
mod.setRecords({
  '2026-07-01': {
    totals: { posTotal: 11000000, supply: 10000000, vat: 1000000 },
    purchaseRows: [{ category: '임대료', supply: 3500000, vat: 0, total: 3500000 }],
    payrollRows: [],
    extras: { expenses: 0 }
  }
});
mod.setFixed([
  { name: '임대료', category: '임대료', amount: 3000000 },  // 매입행 있음 → 무시
  { name: '관리비', category: '관리비', amount: 200000 }    // 매입행 없음 → 적용
]);
d = mod.computeMonthlyData('2026-07');
check('3) 부분 적용 sumFixedApplied = 200,000', d.sumFixedApplied === 200000);
check('3) 임대료 = 매입행만', d.bySupplyCategory['임대료'] === 3500000);
check('3) 관리비 = 설정값', d.bySupplyCategory['관리비'] === 200000);

// CASE 4: 금액 0 고정비는 적용 안 함
mod.setRecords({
  '2026-08-01': {
    totals: { posTotal: 1100000, supply: 1000000, vat: 100000 },
    purchaseRows: [], payrollRows: [], extras: { expenses: 0 }
  }
});
mod.setFixed([{ name: '미정 임대료', category: '임대료', amount: 0 }]);
d = mod.computeMonthlyData('2026-08');
check('4) 금액 0 → 미적용', d.sumFixedApplied === 0);

// CASE 5: 잘못된 카테고리 — getFixedExpenses 직접 stub이라 적용은 됨, 단지 EXPENSE_CATEGORIES 외 카테고리도 그대로
mod.setFixed([{ name: 'X', category: '존재안하는카테고리', amount: 100000 }]);
d = mod.computeMonthlyData('2026-08');
check('5) 임의 카테고리도 처리됨 (소비자 책임)', d.sumFixedApplied === 100000);

// CASE 6: resolveFixedExpensesForMonth 직접 호출
mod.setFixed([
  { name: '임대료', category: '임대료', amount: 3000000 },
  { name: '관리비', category: '관리비', amount: 200000 }
]);
let r = mod.resolveFixedExpensesForMonth({ '임대료': 0, '관리비': 100000 });
check('6) 임대료 applied=true', r.items[0].applied === true);
check('6) 관리비 applied=false (매입행 있음)', r.items[1].applied === false);
check('6) appliedByCategory only 임대료', r.appliedByCategory['임대료'] === 3000000 && !r.appliedByCategory['관리비']);

// CASE 7: alwaysApply — 같은 분류 매입행이 있어도 매월 반영 (캐치테이블·4대보험 실사례)
// 5월: 마케팅 매입행 3,039,082 / 세금·공과 매입행 90,000 있음. 캐치테이블(마케팅)·4대보험(세금·공과)은 항상 적용.
mod.setRecords({
  '2026-05-10': {
    totals: { posTotal: 11000000, supply: 10000000, vat: 1000000 },
    purchaseRows: [
      { category: '마케팅', supply: 3039082, vat: 303908, total: 3342990 },
      { category: '세금·공과', supply: 90000, vat: 0, total: 90000 },
      { category: '임대료', supply: 3120000, vat: 0, total: 3120000 }  // 5월 실제 임대료(매입행 우선)
    ],
    payrollRows: [], extras: { expenses: 0 }
  }
});
mod.setFixed([
  { name: '캐치테이블', category: '마케팅', amount: 2200000, alwaysApply: true },
  { name: '4대보험 회사부담분', category: '세금·공과', amount: 1136000, alwaysApply: true },
  { name: '임대료', category: '임대료', amount: 6000000 }  // alwaysApply 없음 → 매입행 있으면 무시
]);
d = mod.computeMonthlyData('2026-05');
check('7) 캐치+4대보험 항상적용 합산 = 3,336,000', d.sumFixedApplied === 2200000 + 1136000, `got ${d.sumFixedApplied}`);
check('7) 마케팅 = 매입행 + 캐치테이블', d.bySupplyCategory['마케팅'] === 3039082 + 2200000, `got ${d.bySupplyCategory['마케팅']}`);
check('7) 세금·공과 = 매입행 + 4대보험', d.bySupplyCategory['세금·공과'] === 90000 + 1136000, `got ${d.bySupplyCategory['세금·공과']}`);
check('7) 임대료(항상적용X) = 매입행만', d.bySupplyCategory['임대료'] === 3120000, `got ${d.bySupplyCategory['임대료']}`);

// CASE 7b: 같은 데이터에서 alwaysApply 빼면 캐치·4대보험 드롭(기존 버그 동작 — 회귀 비교용)
mod.setFixed([
  { name: '캐치테이블', category: '마케팅', amount: 2200000 },
  { name: '4대보험 회사부담분', category: '세금·공과', amount: 1136000 },
]);
d = mod.computeMonthlyData('2026-05');
check('7b) alwaysApply 없으면 둘 다 드롭(sumFixedApplied=0)', d.sumFixedApplied === 0, `got ${d.sumFixedApplied}`);

// CASE 8: 저장→읽기 왕복 — 실제 getFixedExpenses/saveFixedExpenses가 alwaysApply를 보존해야 함
// (화이트리스트 누락 회귀 방지: stub이 아닌 진짜 함수로 검증)
{
  const realGet = grab(/function getFixedExpenses\(\)[\s\S]*?\n\}/, 'getFixedExpenses');
  const realSave = grab(/function saveFixedExpenses\(arr\)[\s\S]*?\n\}/, 'saveFixedExpenses');
  const expCatsC = grab(/const EXPENSE_CATEGORIES = \[[\s\S]*?\];/, 'EXPENSE_CATEGORIES');
  const numC = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
  const rt = new Function(`
    let _s = {};
    const localStorage = { setItem:(k,v)=>{_s[k]=v;}, getItem:(k)=>_s[k]||null };
    const FIXED_EXPENSES_KEY = 'fixed_expenses_v1';
    function _queueCloudUpload(){}
    ${numC} ${expCatsC} ${realGet} ${realSave}
    return { getFixedExpenses, saveFixedExpenses };
  `)();
  rt.saveFixedExpenses([
    { name: '캐치테이블', category: '마케팅', amount: 2200000, alwaysApply: true },
    { name: '임대료', category: '임대료', amount: 6000000 },
  ]);
  const back = rt.getFixedExpenses();
  check('8) 저장→읽기 후 alwaysApply=true 보존', back[0].alwaysApply === true, JSON.stringify(back[0]));
  check('8) alwaysApply 미설정 → false', back[1].alwaysApply === false, JSON.stringify(back[1]));
}

if (!process.exitCode) console.log('\n전체 통과');
