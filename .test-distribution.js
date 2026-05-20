// 단위 테스트: computeMonthlyDistribution() 격리 검증
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const numMatch = html.match(/function num\(v\)[\s\S]*?return isFinite\(n\) \? n : 0;[\s\S]*?\}/);
const distMatch = html.match(/function computeMonthlyDistribution[\s\S]*?return \{ partners: rows, distributable, ratioSum, ratioOk, subtractDiscounts \};[\s\S]*?\}/);
if (!numMatch || !distMatch) { console.error('FAIL: 함수 추출 실패'); process.exit(2); }

const src = `
  let _partners = [];
  let _subtract = false;
  function getPartners() { return _partners; }
  function getDistSubtractDiscounts() { return _subtract; }
  ${numMatch[0]}
  ${distMatch[0]}
  return {
    num, computeMonthlyDistribution,
    setPartners: (p) => { _partners = p; },
    setSubtract: (v) => { _subtract = v; }
  };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}

// CASE 1: 50/50 분배
mod.setPartners([{ name: 'A', ratio: 50 }, { name: 'B', ratio: 50 }]);
mod.setSubtract(false);
let r = mod.computeMonthlyDistribution(1000000, 30000);
check('1) 50/50 ratioOk', r.ratioOk);
check('1) A=500,000', r.partners[0].amount === 500000, `got ${r.partners[0].amount}`);
check('1) B=500,000', r.partners[1].amount === 500000);
check('1) distributable=monthPL', r.distributable === 1000000);

// CASE 2: 합계 ≠ 100% → ratioOk=false, amount=0
mod.setPartners([{ name: 'A', ratio: 60 }, { name: 'B', ratio: 30 }]);
mod.setSubtract(false);
r = mod.computeMonthlyDistribution(1000000, 0);
check('2) 합계 90 → ratioOk=false', !r.ratioOk);
check('2) ratioSum=90', r.ratioSum === 90);
check('2) amounts=0', r.partners.every(p => p.amount === 0));

// CASE 3: 컴프 차감 켜기
mod.setPartners([{ name: 'A', ratio: 50 }, { name: 'B', ratio: 50 }]);
mod.setSubtract(true);
r = mod.computeMonthlyDistribution(1000000, 200000);
check('3) distributable = PL - 할인', r.distributable === 800000);
check('3) A=400,000', r.partners[0].amount === 400000);
check('3) B=400,000', r.partners[1].amount === 400000);
check('3) subtractDiscounts=true', r.subtractDiscounts === true);

// CASE 4: 3인 33/33/34
mod.setPartners([{ name: 'A', ratio: 33 }, { name: 'B', ratio: 33 }, { name: 'C', ratio: 34 }]);
mod.setSubtract(false);
r = mod.computeMonthlyDistribution(1000000, 0);
check('4) ratioOk', r.ratioOk);
check('4) A=330,000', r.partners[0].amount === 330000);
check('4) C=340,000', r.partners[2].amount === 340000);

// CASE 5: 빈 partners → ratioOk=false (분배 불가)
mod.setPartners([]);
r = mod.computeMonthlyDistribution(1000000, 0);
check('5) 빈 partners → ratioOk=false', !r.ratioOk);
check('5) 행 없음', r.partners.length === 0);

// CASE 6: 손실(음수) PL 분배
mod.setPartners([{ name: 'A', ratio: 50 }, { name: 'B', ratio: 50 }]);
mod.setSubtract(false);
r = mod.computeMonthlyDistribution(-500000, 0);
check('6) 손실 분배 A=-250,000', r.partners[0].amount === -250000);

// CASE 7: 소수점 비율 (33.3 + 33.3 + 33.4)
mod.setPartners([{ name: 'A', ratio: 33.3 }, { name: 'B', ratio: 33.3 }, { name: 'C', ratio: 33.4 }]);
r = mod.computeMonthlyDistribution(1000000, 0);
check('7) 소수점 ratioOk', r.ratioOk, `sum=${r.ratioSum}`);

if (!process.exitCode) console.log('\n전체 통과');
