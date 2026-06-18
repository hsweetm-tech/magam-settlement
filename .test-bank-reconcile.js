// 단위 테스트: 통장 출금매칭 (reconcileKbBank)
//  ① 대표자명↔상호 부분포함 alias (강성국(CASAVI ↔ 까사뷰)
//  ② 3-way 통합: '매입 등록 필요'를 reconcilePurchase3Way의 missing_buy와 일치시킴
//     (3-way가 사업자번호·대표자·[연결]별칭으로 매칭한 건은 출금매칭에서도 제외)
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');
const grab = (re, n) => { const m = html.match(re); if (!m) { console.error('FAIL extract ' + n); process.exit(2); } return m[0]; };
const slice = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL slice ' + a); process.exit(2); } return html.slice(i, j); };

const src = `
  const window = { location: { hash: '' } };
  const localStorage = { getItem: () => null, setItem: () => {} };
  function _classifyDepositChannel() { return null; } // 입금 분류는 무관 — 스텁
  let _rec = {}, _ht = {}, _bank = {}, _fixed = [], _p3 = {};
  function getAllRecords() { return _rec; }
  function getHometaxData(m) { return _ht[m] || []; }
  function getKbBankData(m) { return _bank[m] || []; }
  function getFixedExpenses() { return _fixed; }
  function getP3wMap() { return _p3; }
  ${grab(/function num\(v\)[\s\S]*?\n\}/, 'num')}
  ${grab(/function _normalizeBizNo[\s\S]*?\n\}/, '_normalizeBizNo')}
  ${grab(/function _canonVendor[\s\S]*?\n\}/, '_canonVendor')}
  ${grab(/function _shareCore[\s\S]*?\n\}/, '_shareCore')}
  ${slice('function reconcileKbBank(month) {', 'function renderBankReconcile')}
  ${slice('function reconcilePurchase3Way(month) {', 'const P3W_STATUS')}
  return {
    reconcileKbBank, reconcilePurchase3Way,
    set: (rec, ht, bank, p3) => { _rec = rec; _ht = { '2026-05': ht }; _bank = { '2026-05': bank }; _p3 = p3 || {}; }
  };
`;
const M = new Function(src)();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

// ① 대표자명 alias: 까사뷰(대표 강성국) 매입·세금계산서 ↔ 통장 '강성국(CASAVI'
M.set(
  { '2026-05-14': { purchaseRows: [
    { date: '2026-05-14', vendor: '까사뷰', bizNo: '128-36-35505', category: '소모품', supply: 480000, vat: 48000, total: 528000, method: '계좌이체' },
  ] } },
  [{ date: '2026-05-14', vendor: '까사뷰', representative: '강성국', bizNo: '128-36-35505', supply: 480000, vat: 48000, total: 528000, docType: '세금계산서' }],
  [{ date: '2026-05-12', desc: '강성국(CASAVI', withdraw: 528000, summary: '인터넷출금이체', kind: '기타출금' }]
);
const r1 = M.reconcileKbBank('2026-05');
const isKS = x => /강성|까사뷰|casavi/i.test((x.vendor || '') + (x.desc || ''));
ok(r1.out.matched.some(m => isKS(m.sys) && isKS(m.bank)), '① 까사뷰 매입 ↔ 강성국(CASAVI 통장 매칭');
ok(!r1.out.bankOnly.some(isKS), '① 강성국이 bankOnly(매입 등록 필요)에 없음');

// ② 3-way 통합: 통장 'KT통신요금05'를 [연결]별칭으로 매입 '케이티'와 묶음 → 출금매칭 등록필요에서 제외
//    (날짜 다르고 한글↔영문이라 출금매칭 자체로는 raw에 남지만, 3-way가 매칭하므로 통일 후 제외)
M.set(
  { '2026-05-24': { purchaseRows: [
    { date: '2026-05-24', vendor: '케이티', category: '통신비', supply: 1700, vat: 170, total: 1870, method: '계좌이체' },
  ] } },
  [],
  [{ date: '2026-05-26', desc: 'KT통신요금05', withdraw: 1870, summary: '자동이체', kind: '기타출금' }],
  { 'n:kt통신요금05': { kind: 'alias', target: 'n:케이티', pattern: 'kt통신요금' } }
);
const r2 = M.reconcileKbBank('2026-05');
ok(r2.out.bankOnlyRaw.some(b => /KT통신/i.test(b.desc)), '② 통일 전(raw): KT통신요금 미매칭(한글↔영문·날짜차)');
ok(!r2.out.bankOnly.some(b => /KT통신/i.test(b.desc)), '② 통일 후: 3-way가 케이티로 매칭 → 등록필요에서 제외');

// ③ 진짜 누락은 통일 후에도 남는다 (3-way도 missing_buy)
M.set(
  {},
  [],
  [{ date: '2026-05-15', desc: '모닝글로리강남역점', withdraw: 13000, summary: '체크카드', kind: '기타출금' }]
);
const r3 = M.reconcileKbBank('2026-05');
ok(r3.out.bankOnly.some(b => /모닝글로리/.test(b.desc)), '③ 진짜 매입누락(모닝글로리)은 통일 후에도 등록필요로 유지');

console.log(`\n통장 출금매칭 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
