// 단위 테스트: 매입 3-way 점검 (매입+고정비 ↔ 세금계산서 ↔ 통장출금)
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');
const grab = (re, name) => { const m = html.match(re); if (!m) { console.error('FAIL extract ' + name); process.exit(2); } return m[0]; };
const slice = (startMark, endMark, name) => {
  const a = html.indexOf(startMark), b = html.indexOf(endMark, a);
  if (a < 0 || b < 0) { console.error('FAIL slice ' + name); process.exit(2); }
  return html.slice(a, b);
};
const fn3way = slice('function reconcilePurchase3Way(month) {', 'const P3W_STATUS', 'reconcilePurchase3Way');

const src = `
  let _rec = {}, _ht = {}, _bank = {}, _fixed = [];
  function getAllRecords() { return _rec; }
  function getHometaxData(m) { return _ht[m] || []; }
  function getKbBankData(m) { return _bank[m] || []; }
  function getFixedExpenses() { return _fixed; }
  ${grab(/function num\(v\)[\s\S]*?\n\}/, 'num')}
  ${grab(/function _normalizeBizNo[\s\S]*?\n\}/, '_normalizeBizNo')}
  ${grab(/function _canonVendor[\s\S]*?\n\}/, '_canonVendor')}
  ${fn3way}
  return {
    reconcilePurchase3Way, _canonVendor,
    set: (rec, ht, bank, fixed) => { _rec = rec; _ht = { '2026-05': ht }; _bank = { '2026-05': bank }; _fixed = fixed || []; }
  };
`;
const M = new Function(src)();
let pass = 0, fail = 0;
const eq = (g, w, m) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.error(`  ✗ ${m}\n     got=${JSON.stringify(g)}\n    want=${JSON.stringify(w)}`); } };
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const rowOf = (r, nameInc) => r.rows.find(x => x.name.includes(nameInc));

// 정규화
eq(M._canonVendor('(주)단지푸드'), '단지푸드', 'canon (주)단지푸드');
eq(M._canonVendor('주식회사 단지푸드'), '단지푸드', 'canon 주식회사 단지푸드');
eq(M._canonVendor('코카콜라음료(주)'), '코카콜라음료', 'canon 코카콜라음료(주)');

// 시나리오: 사업자번호로 매입↔세금계산서 연결, 통장은 대표자명 alias
const rec = {
  '2026-05-03': { purchaseRows: [
    { vendor: '코카콜라음료(주)', bizNo: '', supply: 100000, vat: 10000, total: 110000, category: '식자재' }, // bizNo 없음 → 세금계산서로 역해석
    { vendor: '(주)단지푸드', bizNo: '547-81-02961', supply: 90000, vat: 9000, total: 99000, category: '식자재' },
  ] },
  '2026-05-10': { purchaseRows: [
    { vendor: '(주)단지푸드', bizNo: '547-81-02961', supply: 200000, vat: 20000, total: 220000, category: '식자재' },
  ] },
};
const ht = [
  { date: '2026-05-31', vendor: '코카콜라음료(주)', bizNo: '211-88-11111', supply: 100000, vat: 10000, total: 110000, docType: '세금계산서', representative: '홍길동' },
  { date: '2026-05-31', vendor: '주식회사 단지푸드', bizNo: '547-81-02961', supply: 290000, vat: 29000, total: 319000, docType: '세금계산서', representative: '김단지' },
  { date: '2026-05-20', vendor: '더 월드키친', bizNo: '333-44-55555', supply: 500000, vat: 50000, total: 550000, docType: '세금계산서', representative: '김상균' }, // 매입X·통장O
  { date: '2026-05-15', vendor: '아트팜', bizNo: '666-77-88888', supply: 300000, vat: 0, total: 300000, docType: '계산서', representative: '박아트' }, // 매입X·통장X
];
const bank = [
  { date: '2026-05-22', desc: '김상균', withdraw: 550000, summary: '인터넷뱅킹', kind: '' }, // 더월드키친(대표자명)
  { date: '2026-05-25', desc: '손무경(무무앤코)', withdraw: 80000, summary: '인터넷뱅킹', kind: '' }, // 매입X·세금계산서X·통장O
  { date: '2026-05-12', desc: '체크카드출금삼성', withdraw: 30000, summary: '체크카드', kind: '카드출금' }, // 카드 → 제외
];
const fixed = [
  { name: '임대료', category: '임대료', amount: 1200000 }, // 같은 분류 매입 없음 → 고정비 반영
];
M.set(rec, ht, bank, fixed);
const r = M.reconcilePurchase3Way('2026-05');

// 코카콜라: 매입(bizNo없음) ↔ 세금계산서(bizNo) 가 상호로 연결되어 한 줄
const coke = rowOf(r, '코카콜라');
ok(coke && coke.buy === 110000 && coke.tax === 110000, '코카콜라 매입↔세금계산서 연결(완전 전단계)');
eq(coke.status, 'unpaid', '코카콜라 미출금(통장X)');

// 단지푸드: 매입 합 319000 ↔ 세금계산서 319000 (bizNo)
const dj = rowOf(r, '단지푸드');
ok(dj && dj.buy === 319000 && dj.tax === 319000, '단지푸드 매입합↔세금계산서');

// 더월드키친: 매입X, 세금계산서 550000, 통장 '김상균'(대표자명) 550000 → 매입누락
const wk = rowOf(r, '월드키친');
ok(wk && wk.buy === 0 && wk.tax === 550000 && wk.bank === 550000, '더월드키친 세금계산서+통장(대표자명 연결)');
eq(wk.status, 'missing_buy', '더월드키친 매입누락');

// 아트팜: 세금계산서만 → 매입누락
const art = rowOf(r, '아트팜');
eq(art.status, 'missing_buy', '아트팜 매입누락(세금계산서만)');

// 손무경: 통장만 → 매입누락
const son = rowOf(r, '손무경');
ok(son && son.bank === 80000 && son.tax === 0, '손무경 통장만');
eq(son.status, 'missing_buy', '손무경 매입누락(통장만)');

// 고정비 임대료: 매입(고정비) 1.2M, 세금계산서/통장 없음 → fixed
const rent = rowOf(r, '임대료');
ok(rent && rent.buy === 1200000 && rent.fixed === true, '임대료 고정비 반영');
eq(rent.status, 'fixed', '임대료 고정비 상태');

// 체크카드출금은 제외됐는지
ok(!r.rows.some(x => x.name.includes('체크카드')), '체크카드 출금 제외');

// 매입누락 카운트 = 더월드키친·아트팜·손무경 = 3
eq(r.counts.missing_buy, 3, '매입누락 3건');

console.log(`\n3-way 점검 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
