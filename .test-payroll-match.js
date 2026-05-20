// 단위 테스트: matchPayrollToBank() 격리 검증
// 일일정산.html에서 함수와 num()만 추출해 실행.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

// 1) num()과 matchPayrollToBank()를 정규식으로 추출
const numMatch = html.match(/function num\(v\)[\s\S]*?return isFinite\(n\) \? n : 0;[\s\S]*?\}/);
const matchFnMatch = html.match(/function matchPayrollToBank\(\)[\s\S]*?candidateBankIdxs: cand \};[\s\S]*?\}/);
if (!numMatch || !matchFnMatch) {
  console.error('FAIL: 함수 추출 실패');
  process.exit(2);
}

// 2) 가짜 state 주입해서 실행
const src = `
  let state;
  ${numMatch[0]}
  ${matchFnMatch[0]}
  return { num, matchPayrollToBank, setState: (s) => { state = s; } };
`;
const mod = new Function(src)();

function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) process.exitCode = 1;
}

// CASE 1: 1-to-1 금액 일치 매칭
mod.setState({
  payrollRows: [{ date: '2026-05-19', employee: '홍길동', amount: 2500000, method: '계좌이체', memo: '' }],
  bankRows: [{ date: '2026-05-19', desc: '급여 홍길동', withdraw: 2500000, deposit: 0, kind: '인건비' }]
});
let r = mod.matchPayrollToBank();
check('1) 단일 매칭', r.matchByPayroll[0] === 0 && r.matchByBank[0] === 0);

// CASE 2: 금액 불일치는 매칭 안 됨
mod.setState({
  payrollRows: [{ date: '2026-05-19', employee: '홍길동', amount: 2500000, method: '계좌이체', memo: '' }],
  bankRows: [{ date: '2026-05-19', desc: '급여 홍길동', withdraw: 2499000, deposit: 0, kind: '인건비' }]
});
r = mod.matchPayrollToBank();
check('2) 금액 불일치 → 미매칭', r.matchByPayroll[0] == null);

// CASE 3: 현금 지급은 자동 매칭 대상 아님
mod.setState({
  payrollRows: [{ date: '2026-05-19', employee: '홍길동', amount: 100000, method: '현금', memo: '' }],
  bankRows: [{ date: '2026-05-19', desc: '급여', withdraw: 100000, deposit: 0, kind: '인건비' }]
});
r = mod.matchPayrollToBank();
check('3) 현금 지급 → 매칭 제외', r.matchByPayroll[0] == null);

// CASE 4: 동일 금액 2건 + 적요 직원명으로 구분
mod.setState({
  payrollRows: [
    { date: '2026-05-19', employee: '홍길동', amount: 2000000, method: '계좌이체', memo: '' },
    { date: '2026-05-19', employee: '김철수', amount: 2000000, method: '계좌이체', memo: '' }
  ],
  bankRows: [
    { date: '2026-05-19', desc: '급여 김철수', withdraw: 2000000, deposit: 0, kind: '인건비' },
    { date: '2026-05-19', desc: '급여 홍길동', withdraw: 2000000, deposit: 0, kind: '인건비' }
  ]
});
r = mod.matchPayrollToBank();
check('4-a) 홍길동 → 통장 #2 (이름)', r.matchByPayroll[0] === 1);
check('4-b) 김철수 → 통장 #1 (이름)', r.matchByPayroll[1] === 0);

// CASE 5: 통장에 kind가 인건비가 아니면 매칭 후보 아님
mod.setState({
  payrollRows: [{ date: '2026-05-19', employee: '홍길동', amount: 100000, method: '계좌이체', memo: '' }],
  bankRows: [{ date: '2026-05-19', desc: '급여 홍길동', withdraw: 100000, deposit: 0, kind: '매입·비용' }]
});
r = mod.matchPayrollToBank();
check('5) 통장 kind!=인건비 → 미매칭', r.matchByPayroll[0] == null);

// CASE 6: 통장에 인건비 출금만 있고 급여 행 없음 → orphan
mod.setState({
  payrollRows: [],
  bankRows: [{ date: '2026-05-19', desc: '급여 홍길동', withdraw: 2500000, deposit: 0, kind: '인건비' }]
});
r = mod.matchPayrollToBank();
check('6) 고아 통장 출금 (급여 행 없음)', r.matchByBank[0] == null && r.candidateBankIdxs.length === 1);

// CASE 7: 빈 금액 행은 스킵
mod.setState({
  payrollRows: [{ date: '2026-05-19', employee: '', amount: 0, method: '계좌이체', memo: '' }],
  bankRows: []
});
r = mod.matchPayrollToBank();
check('7) 빈 금액 행 → 스킵', Object.keys(r.matchByPayroll).length === 0);

if (!process.exitCode) console.log('\n전체 통과');
