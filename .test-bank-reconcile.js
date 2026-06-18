// 단위 테스트: 통장 출금매칭 (reconcileKbBank) — 대표자명↔상호 alias
// 통장 적요가 '강성국(CASAVI'(대표자명+부가문구)인데 매입은 상호 '까사뷰'로 등록된 경우,
// 홈택스 대표자명(강성국→까사뷰) 부분포함 alias로 매칭돼야 한다(매입 등록 필요 오인 방지).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');
const grab = (re, n) => { const m = html.match(re); if (!m) { console.error('FAIL extract ' + n); process.exit(2); } return m[0]; };
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL slice ' + a); process.exit(2); } return html.slice(i, j); };

const src = `
  const window = { location: { hash: '' } };
  const localStorage = { getItem: () => null, setItem: () => {} };
  function _classifyDepositChannel() { return null; } // 입금 분류는 이 테스트와 무관 — 스텁
  let _rec = {}, _ht = {}, _bank = {}, _fixed = [];
  function getAllRecords() { return _rec; }
  function getHometaxData(m) { return _ht[m] || []; }
  function getKbBankData(m) { return _bank[m] || []; }
  function getFixedExpenses() { return _fixed; }
  ${grab(/function num\(v\)[\s\S]*?\n\}/, 'num')}
  ${grab(/function _normalizeBizNo[\s\S]*?\n\}/, '_normalizeBizNo')}
  ${slice('function reconcileKbBank(month) {', 'function renderBankReconcile')}
  return {
    reconcileKbBank,
    set: (rec, ht, bank) => { _rec = rec; _ht = { '2026-05': ht }; _bank = { '2026-05': bank }; }
  };
`;
const M = new Function(src)();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

// 시나리오: 까사뷰(대표 강성국) 세금계산서·매입 ↔ 통장 '강성국(CASAVI'
M.set(
  { '2026-05-14': { purchaseRows: [
    { date: '2026-05-14', vendor: '까사뷰', bizNo: '128-36-35505', category: '소모품', supply: 480000, vat: 48000, total: 528000, method: '계좌이체' },
  ] } },
  [{ date: '2026-05-14', vendor: '까사뷰', representative: '강성국', bizNo: '128-36-35505', supply: 480000, vat: 48000, total: 528000, docType: '세금계산서' }],
  [{ date: '2026-05-12', desc: '강성국(CASAVI', withdraw: 528000, summary: '인터넷출금이체', kind: '기타출금' }]
);
const r = M.reconcileKbBank('2026-05');
const isKS = x => /강성|까사뷰|casavi/i.test((x.vendor || '') + (x.desc || ''));
ok(r.out.matched.some(m => isKS(m.sys) && isKS(m.bank)), '대표자명 alias: 까사뷰 매입 ↔ 강성국(CASAVI 통장 매칭');
ok(!r.out.bankOnly.some(isKS), '대표자명 alias: 강성국이 bankOnly(매입 등록 필요)에 없음');
ok(!r.out.sysOnly.some(isKS), '대표자명 alias: 까사뷰가 sysOnly(통장 못찾음)에 없음');

// 오매칭 방지: 금액이 다르면 매칭 안 됨
M.set(
  { '2026-05-14': { purchaseRows: [
    { date: '2026-05-14', vendor: '까사뷰', bizNo: '128-36-35505', category: '소모품', supply: 100000, vat: 10000, total: 110000, method: '계좌이체' },
  ] } },
  [{ date: '2026-05-14', vendor: '까사뷰', representative: '강성국', bizNo: '128-36-35505', total: 110000, docType: '세금계산서' }],
  [{ date: '2026-05-12', desc: '강성국(CASAVI', withdraw: 528000, summary: '인터넷출금이체', kind: '기타출금' }]
);
const r2 = M.reconcileKbBank('2026-05');
ok(r2.out.bankOnly.some(b => /강성/.test(b.desc)), '오매칭 방지: 금액 다르면(528k vs 110k) 통장 강성국은 미매칭 유지');

console.log(`\n통장 출금매칭 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
