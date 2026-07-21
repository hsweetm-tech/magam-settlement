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
  let _rec = {}, _ht = {}, _bank = {}, _fixed = [], _p3map = {};
  function getAllRecords() { return _rec; }
  function getHometaxData(m) { return _ht[m] || []; }
  function getKbBankData(m) { return _bank[m] || []; }
  function getFixedExpenses() { return _fixed; }
  function getP3wMap() { return _p3map; }
  function setP3map(o) { _p3map = o || {}; }
  let _ls = {};
  const STORAGE_KEY = 'dailySettlement_v1';
  const localStorage = { setItem: (k, v) => { _ls[k] = v; }, getItem: (k) => _ls[k] || null };
  function _queueCloudUpload() {}
  function toast() {}
  ${grab(/function num\(v\)[\s\S]*?\n\}/, 'num')}
  ${grab(/function _normalizeBizNo[\s\S]*?\n\}/, '_normalizeBizNo')}
  ${grab(/function _canonVendor[\s\S]*?\n\}/, '_canonVendor')}
  ${grab(/function _shareCore[\s\S]*?\n\}/, '_shareCore')}
  ${grab(/function _fixedExpenseMatched[\s\S]*?\n\}/, '_fixedExpenseMatched')}
  ${fn3way}
  ${grab(/function _bumpClosedAt[\s\S]*?\n\}/, '_bumpClosedAt')}
  ${grab(/function autoRegisterRecurring[\s\S]*?\n\}/, 'autoRegisterRecurring')}
  ${grab(/function _guessP3wCategory[\s\S]*?\n\}/, '_guessP3wCategory')}
  ${grab(/function _p3wDraftFromRow[\s\S]*?\n\}/, '_p3wDraftFromRow')}
  ${grab(/function _registerP3wDrafts[\s\S]*?\n\}/, '_registerP3wDrafts')}
  return {
    reconcilePurchase3Way, _canonVendor, setP3map, autoRegisterRecurring, _guessP3wCategory, _p3wDraftFromRow, _registerP3wDrafts,
    set: (rec, ht, bank, fixed) => { _rec = rec; _ht = { '2026-05': ht }; _bank = { '2026-05': bank }; _fixed = fixed || []; _p3map = {}; },
    setMulti: (rec, htByMonth, bankByMonth, fixed) => { _rec = rec; _ht = htByMonth || {}; _bank = bankByMonth || {}; _fixed = fixed || []; _p3map = {}; }
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

// 예외/고정비 매핑: 아트팜(bizNo) → 고정비 → 매입누락에서 빠지고 fixed_matched
M.setP3map({ 'b:6667788888': { kind: 'fixed', category: '임대료', label: '아트팜' } });
const r2 = M.reconcilePurchase3Way('2026-05');
const art2 = rowOf(r2, '아트팜');
eq(art2.status, 'fixed_matched', '매핑: 아트팜 고정비 처리');
eq(art2.mapped, '임대료', '매핑: 분류 임대료');
eq(r2.counts.missing_buy, 2, '매핑 후 매입누락 3→2');
// 매입-only(증빙·출금대기)도 예외 가능: 손무경은 통장only라 missing_buy였음 — 이름키로 예외
M.setP3map({ 'n:손무경무무앤코': { kind: 'fixed', category: '소모품' } });
const r3 = M.reconcilePurchase3Way('2026-05');
eq(rowOf(r3, '손무경').status, 'fixed_matched', '매핑: 이름키 예외 처리');

// 정기(자동등록): 아트팜(세금계산서 300,000, 매입X)을 정기로 → 자동 매입생성
M.set(rec, ht, bank, fixed); // 초기화(매핑/레코드 리셋)
M.setP3map({ 'b:6667788888': { kind: 'auto', category: '소모품', label: '아트팜' } });
const before = M.reconcilePurchase3Way('2026-05');
eq(rowOf(before, '아트팜').status, 'missing_buy', '정기: 자동등록 전 매입누락');
const created = M.autoRegisterRecurring('2026-05');
eq(created, 1, '정기: 1건 자동등록');
const after = M.reconcilePurchase3Way('2026-05');
const art3 = rowOf(after, '아트팜');
eq(art3.buy, 300000, '정기: 매입 자동생성 300,000(세금계산서 금액)');
eq(art3.status, 'unpaid', '정기: 매입+세금계산서 → 미출금(통장 전)');
eq(art3.recurring, '소모품', '정기: recurring 표시');
// 멱등: 다시 실행해도 추가 생성 0
eq(M.autoRegisterRecurring('2026-05'), 0, '정기: 멱등(재실행 0건)');

// 자동연결: 공통글자 ≥3 — 통장 '장서아_코카콜라' ↔ 세금계산서 '코카콜라음료'
M.set({ '2026-05-03': { purchaseRows: [] } },
  [{ date: '2026-05-31', vendor: '코카콜라음료(주)', bizNo: '211-88-11111', supply: 100000, vat: 10000, total: 110000, docType: '세금계산서' }],
  [{ date: '2026-05-10', desc: '장서아_코카콜라', withdraw: 110000, summary: '인터넷뱅킹', kind: '' }], []);
const rc = M.reconcilePurchase3Way('2026-05');
const coke2 = rowOf(rc, '코카콜라');
ok(coke2 && coke2.tax === 110000 && coke2.bank === 110000, '자동연결: 코카콜라 세금계산서↔통장(공통글자)');

// 수동연결(별칭): KT — 통장 'KT통신요금05' ↔ 세금계산서 '주식회사 케이티'(자동불가)
M.set({ '2026-05-03': { purchaseRows: [] } },
  [{ date: '2026-05-31', vendor: '주식회사 케이티', bizNo: '999-88-77777', supply: 1700, vat: 170, total: 1870, docType: '세금계산서' }],
  [{ date: '2026-05-10', desc: 'KT통신요금05', withdraw: 1870, summary: '자동이체', kind: '' }], []);
const ktBefore = M.reconcilePurchase3Way('2026-05');
ok(ktBefore.rows.filter(x => /케이티|kt|KT/i.test(x.name)).length >= 2, '연결 전: KT 2줄로 쪼개짐');
// 별칭(패턴): 'kt통신요금' 패턴 → b:9998877777 (끝 숫자 무관)
M.setP3map({ 'n:kt통신요금05': { kind: 'alias', target: 'b:9998877777', pattern: 'kt통신요금' } });
const ktAfter = M.reconcilePurchase3Way('2026-05');
const kt = ktAfter.rows.find(x => x.bizNo === '9998877777');
ok(kt && kt.tax === 1870 && kt.bank === 1870, '수동연결(패턴): KT 한 줄로 묶임');
ok(kt && kt.incomingAlias === true, '수동연결: 대상 행 incomingAlias 표시');

// 다음달: 통장 'KT통신요금06' 도 같은 패턴으로 자동 매칭
M.set({ '2026-05-03': { purchaseRows: [] } },
  [{ date: '2026-05-31', vendor: '주식회사 케이티', bizNo: '999-88-77777', supply: 1800, vat: 180, total: 1980, docType: '세금계산서' }],
  [{ date: '2026-05-10', desc: 'KT통신요금06', withdraw: 1980, summary: '자동이체', kind: '' }], []);
M.setP3map({ 'n:kt통신요금05': { kind: 'alias', target: 'b:9998877777', pattern: 'kt통신요금' } });
const ktNext = M.reconcilePurchase3Way('2026-05');
const kt2 = ktNext.rows.find(x => x.bizNo === '9998877777');
ok(kt2 && kt2.tax === 1980 && kt2.bank === 1980, '수동연결(패턴): 다음달 06도 자동 매칭');

// 카드결제 매입-only(다이소·대진): 세금계산서·통장 없어도 정상 → 'card'
M.set({ '2026-05-07': { purchaseRows: [
  { vendor: '다이소', supply: 167727, vat: 16773, total: 184500, category: '소모품', method: '법인카드' },
  { vendor: '대진종합공사', bizNo: '211-02-41662', supply: 130000, vat: 13000, total: 143000, category: '소모품', method: '법인카드' },
  { vendor: '어떤거래처', supply: 100000, vat: 10000, total: 110000, category: '식자재', method: '계좌이체' },
] } }, [], [], []);
const rcard = M.reconcilePurchase3Way('2026-05');
eq(rowOf(rcard, '다이소').status, 'card', '카드결제: 다이소 → card(정상)');
eq(rowOf(rcard, '대진종합공사').status, 'card', '카드결제: 대진 → card(정상)');
eq(rowOf(rcard, '어떤거래처').status, 'pending', '계좌이체 매입-only → pending 유지');

// 개별 등록: 매입누락 1건만 매입행으로 등록 → 그 거래처는 매입 생김
M.set({ '2026-05-03': { purchaseRows: [] } },
  [{ date: '2026-05-31', vendor: '아트팜', bizNo: '666-77-88888', supply: 300000, vat: 0, total: 300000, docType: '계산서' },
   { date: '2026-05-20', vendor: '더 월드키친', bizNo: '333-44-55555', supply: 500000, vat: 50000, total: 550000, docType: '세금계산서' }], [], []);
const rOne = M.reconcilePurchase3Way('2026-05');
const artRow = rOne.rows.find(x => x.name.includes('아트팜'));
const draft = M._p3wDraftFromRow(artRow, '2026-05');
eq(draft.total, 300000, '개별등록 초안: 아트팜 합계 300,000');
eq(draft.vendor, '아트팜', '개별등록 초안: 거래처');
M._registerP3wDrafts([draft]);
const rAfter = M.reconcilePurchase3Way('2026-05');
const artAfter = rAfter.rows.find(x => x.name.includes('아트팜'));
ok(artAfter.buy === 300000, '개별등록: 아트팜 매입 생성됨');
ok(artAfter.status !== 'missing_buy', '개별등록: 아트팜 매입누락 해제');
ok(rAfter.rows.find(x => x.name.includes('월드키친')).status === 'missing_buy', '개별등록: 더월드키친은 그대로(개별만)');

// 분류 자동추천 (_guessP3wCategory)
eq(M._guessP3wCategory('코카콜라음료(주)'), '주류/음료', '추천: 코카콜라 → 주류/음료');
eq(M._guessP3wCategory('참이슬 소주 1박스'), '주류/음료', '추천: 소주 → 주류/음료');
eq(M._guessP3wCategory('하이트 생수 2L'), '주류/음료', '추천: 생수 → 주류/음료');
eq(M._guessP3wCategory('주식회사 케이티'), '통신비', '추천: 케이티 → 통신비');
eq(M._guessP3wCategory('KT통신요금05'), '통신비', '추천: KT통신요금 → 통신비');
eq(M._guessP3wCategory('한국전력 전기요금'), '공과금', '추천: 한전 → 공과금');
eq(M._guessP3wCategory('상가 임대료 6월'), '임대료', '추천: 임대료 → 임대료');
eq(M._guessP3wCategory('OO세무회계 기장료'), '세금·공과', '추천: 세무 → 세금·공과');
eq(M._guessP3wCategory('배달의민족 광고비'), '배달수수료', '추천: 배민(배달 우선) → 배달수수료');
eq(M._guessP3wCategory('다이소 주방용품'), '소모품', '추천: 다이소 → 소모품');
eq(M._guessP3wCategory('에어컨 수리'), '수리/비품', '추천: 수리 → 수리/비품');
eq(M._guessP3wCategory('한우 정육 도매'), '식자재', '추천: 정육/도매 → 식자재');
eq(M._guessP3wCategory('네이버 플레이스 광고'), '마케팅', '추천: 플레이스 → 마케팅');
eq(M._guessP3wCategory('손무경(무무앤코)'), null, '추천: 단서없는 거래처 → null(기본값 사용)');
eq(M._guessP3wCategory(''), null, '추천: 빈 텍스트 → null');
// _p3wDraftFromRow가 추천 분류를 채우는지 (코카콜라 세금계산서 → 주류/음료)
M.set({ '2026-05-03': { purchaseRows: [] } },
  [{ date: '2026-05-31', vendor: '코카콜라음료(주)', bizNo: '211-88-11111', supply: 100000, vat: 10000, total: 110000, docType: '세금계산서', item: '코카콜라 1.5L' }], [], []);
const rGuess = M.reconcilePurchase3Way('2026-05');
eq(M._p3wDraftFromRow(rGuess.rows.find(x => x.name.includes('코카콜라')), '2026-05').category, '주류/음료', '초안: 코카콜라 추천분류 반영');

// 사업자번호 없는 거래처: 매입(긴 이름) ↔ 통장(짧은 약칭) 유사도 병합
// 강성국 인테리어: 매입 '강성국 인테리어 커튼구매시공' ↔ 통장 '강성국' (세금계산서 없음)
M.set({ '2026-05-08': { purchaseRows: [
  { vendor: '강성국 인테리어 커튼구매시공', bizNo: '', supply: 500000, vat: 50000, total: 550000, category: '수리/비품', method: '계좌이체' },
] } }, [], [
  { date: '2026-05-09', desc: '강성국', withdraw: 550000, summary: '인터넷뱅킹', kind: '' },
], []);
const rks = M.reconcilePurchase3Way('2026-05');
const ks = rowOf(rks, '강성국');
ok(ks && ks.buy === 550000 && ks.bank === 550000, '유사병합: 강성국 매입↔통장 한 줄(bizNo 없이)');
eq(ks.status, 'no_tax', '유사병합: 강성국 매입+통장(계산서X) → no_tax');
ok(rks.rows.filter(x => x.name.includes('강성국')).length === 1, '유사병합: 강성국 한 줄로만');

// 전기료: 매입 '한국전력 전기료' ↔ 통장 '한국전력'
M.set({ '2026-05-10': { purchaseRows: [
  { vendor: '한국전력 전기료', bizNo: '', supply: 200000, vat: 20000, total: 220000, category: '공과금', method: '계좌이체' },
] } }, [], [
  { date: '2026-05-11', desc: '한국전력', withdraw: 220000, summary: '자동이체', kind: '' },
], []);
const rel = M.reconcilePurchase3Way('2026-05');
const elc = rowOf(rel, '한국전력');
ok(elc && elc.buy === 220000 && elc.bank === 220000, '유사병합: 한국전력 매입↔통장 병합');

// 오병합 방지: 3글자 미만 공통은 병합 안 함 ('가스' vs '전기' 등)
M.set({ '2026-05-12': { purchaseRows: [
  { vendor: '대한가스', bizNo: '', supply: 100000, vat: 10000, total: 110000, category: '공과금', method: '계좌이체' },
] } }, [], [
  { date: '2026-05-13', desc: '대한제분', withdraw: 90000, summary: '인터넷뱅킹', kind: '' },
], []);
const rno = M.reconcilePurchase3Way('2026-05');
ok(rno.rows.filter(x => x.name.includes('대한')).length === 2, '오병합 방지: 대한가스↔대한제분(공통2글자) 안 묶임');

// 체크카드 건별결제: 통장에 거래처별로 찍힌 체크카드 출금은 실제 매입 → 3-way에 포함돼야 함
// 킨코스(매입X, 체크카드 통장O) → missing_buy로 떠서 등록 가능해야 함
M.set({ '2026-05-01': { purchaseRows: [
  { vendor: '다이소', supply: 50000, vat: 5000, total: 55000, category: '소모품', method: '체크카드' }, // 카드매입(이미 입력)
] } }, [], [
  { date: '2026-05-26', desc: '킨코스코리아(주)', withdraw: 64800, summary: '체크카드', kind: '기타출금' },
  { date: '2026-05-08', desc: '다이소', withdraw: 55000, summary: '체크카드', kind: '기타출금' }, // 카드매입과 매칭
  { date: '2026-05-15', desc: '카드대금결제', withdraw: 999999, summary: '결제', kind: '카드출금' }, // 카드대금 일괄출금 → 제외
]);
const rck = M.reconcilePurchase3Way('2026-05');
const kinko = rowOf(rck, '킨코스');
ok(kinko && kinko.bank === 64800 && kinko.buy === 0, '체크카드: 킨코스 통장출금 잡힘(매입X)');
eq(kinko.status, 'missing_buy', '체크카드: 킨코스 → 매입 미입력(등록 가능)');
// 카드매입(다이소)이 체크카드 통장출금과 매칭돼도 'card' 유지(no_tax 경고로 안 바뀜)
const daiso = rowOf(rck, '다이소');
ok(daiso && daiso.buy === 55000 && daiso.bank === 55000, '체크카드: 다이소 매입↔체크카드 통장 매칭');
eq(daiso.status, 'card', '체크카드: 카드매입+체크카드출금 → card 유지(no_tax 아님)');
// 카드대금 일괄출금(kind:카드출금)은 여전히 제외
ok(!rck.rows.some(x => /카드대금/.test(x.name)), '체크카드: 카드대금 일괄출금은 제외');
// 킨코스 등록 초안: 체크카드 → method/docType 반영
const kdraft = M._p3wDraftFromRow(kinko, '2026-05');
eq(kdraft.method, '체크카드', '체크카드 초안: method=체크카드');
eq(kdraft.docType, '카드전표', '체크카드 초안: docType=카드전표');

// 통장>매입 차액(overBank): 거래처가 매입과 묶였어도 통장이 더 많으면 누락분 표시
// 대진종합공사: 매입 143,000(카드) ↔ 통장 173,800 → 30,800 누락(5/27건)
M.set({ '2026-05-13': { purchaseRows: [
  { vendor: '대진종합공사', supply: 63000, vat: 6300, total: 69300, category: '소모품', method: '법인카드' },
  { vendor: '대진종합공사', supply: 7000, vat: 700, total: 7700, category: '소모품', method: '법인카드' },
] }, '2026-05-27': { purchaseRows: [
  { vendor: '대진종합공사', supply: 60000, vat: 6000, total: 66000, category: '소모품', method: '법인카드' },
] } }, [], [
  { date: '2026-05-13', desc: '대진종합공사', withdraw: 69300, summary: '체크카드', kind: '기타출금' },
  { date: '2026-05-13', desc: '대진종합공사', withdraw: 7700, summary: '체크카드', kind: '기타출금' },
  { date: '2026-05-27', desc: '대진종합공사', withdraw: 66000, summary: '체크카드', kind: '기타출금' },
  { date: '2026-05-27', desc: '대진종합공사', withdraw: 30800, summary: '체크카드', kind: '기타출금' }, // 매입 누락분
]);
const rdj = M.reconcilePurchase3Way('2026-05');
const dj2 = rowOf(rdj, '대진');
ok(dj2 && dj2.buy === 143000 && dj2.bank === 173800, '차액: 대진 매입143,000 통장173,800 한 줄');
eq(dj2.overBank, 30800, '차액: 통장>매입 30,800 감지');
eq(dj2.status, 'card', '차액: 상태는 card 유지(통장 초과는 별도 플래그)');
// 차액 등록 초안: 정확히 일치하는 통장건(5/27 30,800)을 누락분으로 잡음
const items = (dj2.bankItems || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
const gapSrc = items.find(b => Math.round(b.total) === 30800);
ok(gapSrc && gapSrc.date === '2026-05-27', '차액: 30,800 일치 통장건(5/27) 식별');
// 차액 없는 정상 거래처는 overBank 0
M.set({ '2026-05-01': { purchaseRows: [
  { vendor: '마니약국', supply: 87273, vat: 8727, total: 96000, category: '소모품', method: '법인카드' },
] } }, [], [
  { date: '2026-05-08', desc: '마니약국', withdraw: 96000, summary: '체크카드', kind: '기타출금' },
]);
eq(rowOf(M.reconcilePurchase3Way('2026-05'), '마니약국').overBank, 0, '차액: 매입=통장 거래처는 overBank 0');
// 1,000원 미만 차이는 노이즈로 무시
M.set({ '2026-05-01': { purchaseRows: [
  { vendor: '소소상회', supply: 9091, vat: 909, total: 10000, category: '식자재', method: '계좌이체' },
] } }, [], [
  { date: '2026-05-08', desc: '소소상회', withdraw: 10500, summary: '인터넷출금이체', kind: '기타출금' },
]);
eq(rowOf(M.reconcilePurchase3Way('2026-05'), '소소상회').overBank, 0, '차액: 1,000원 미만(500) 차이는 무시');

// 오병합 방지(강남역 등 공통 지역명): 포함관계 아니면 안 묶임
// 모닝글로리강남역점 / 꾸아강남역CGV점 / 롯데슈퍼강남역가맹 — 모두 '강남역' 공유하지만 서로 포함 아님 → 별도 행
M.set({ '2026-05-23': { purchaseRows: [
  { vendor: '롯데슈퍼강남역가맹', supply: 6354, vat: 636, total: 6990, category: '식자재', method: '체크카드' },
] } }, [], [
  { date: '2026-05-23', desc: '롯데슈퍼강남역가맹', withdraw: 6990, summary: '체크카드', kind: '기타출금' },
  { date: '2026-05-15', desc: '모닝글로리강남역점', withdraw: 13000, summary: '체크카드', kind: '기타출금' },
  { date: '2026-05-01', desc: '꾸아강남역CGV점', withdraw: 24500, summary: '체크카드', kind: '기타출금' },
]);
const rgn = M.reconcilePurchase3Way('2026-05');
ok(rowOf(rgn, '모닝글로리'), '오병합 방지: 모닝글로리 별도 행으로 존재');
ok(rowOf(rgn, '꾸아'), '오병합 방지: 꾸아 별도 행으로 존재');
eq(rowOf(rgn, '모닝글로리').status, 'missing_buy', '오병합 방지: 모닝글로리 매입 미입력으로 노출');
eq(rowOf(rgn, '롯데슈퍼').bank, 6990, '오병합 방지: 롯데슈퍼 통장 6,990만(모닝·꾸아 안 섞임)');

// 오연결 방지(공통 3글자 경계 겹침): 버텍스서초점(통장) ↔ 에스케이쉴더스(주)서초지점(세금계산서) 안 묶임
// 둘 다 '...스 서초...'라 '스서초' 3글자가 겹치지만 다른 거래처 → 공통 4글자 기준으로 차단
M.set({ '2026-05-16': { purchaseRows: [] } },
  [{ date: '2026-05-31', vendor: '에스케이쉴더스(주) 서초지점', representative: '민기식', bizNo: '644-85-01451', supply: 68000, vat: 6800, total: 74800, docType: '세금계산서' }],
  [{ date: '2026-05-16', desc: '버텍스서초점', withdraw: 44300, summary: '체크카드', kind: '기타출금' }], []);
const rvx = M.reconcilePurchase3Way('2026-05');
ok(rvx.rows.find(x => x.name.includes('버텍스')), '오연결 방지: 버텍스서초점 별도 행 존재');
ok(rvx.rows.find(x => x.name.includes('쉴더스')), '오연결 방지: 에스케이쉴더스 별도 행 존재');
ok(rvx.rows.filter(x => /버텍스|쉴더스/.test(x.name)).length === 2, '오연결 방지: 버텍스↔쉴더스 안 묶임(2행)');
// 진짜 공통 4글자(코카콜라)는 여전히 연결돼야 함 — 기존 자동연결 테스트가 이미 커버(코카콜라음료↔장서아_코카콜라)

// ── 전월 미지급 이월 (1개월) ──
// 외상매입: 5월 와드 매입 2,200,000(계좌이체), 5월 통장 결제 0 → 6월에 통장으로 결제.
// 6월 3-way: 와드 통장출금만 있고 매입/계산서 없음 → 예전엔 missing_buy(오탐), 이제 paid_prev.
M.setMulti(
  {
    '2026-05-26': { purchaseRows: [
      { date: '2026-05-26', vendor: '주식회사 와드', bizNo: '6148800597', category: '마케팅', supply: 2000000, vat: 200000, total: 2200000, method: '계좌이체' },
    ] },
    '2026-06-05': { purchaseRows: [
      { date: '2026-06-05', vendor: '(주)단지푸드', bizNo: '5478102961', category: '식자재', supply: 300000, vat: 30000, total: 330000, method: '계좌이체' },
    ] },
  },
  {}, // 홈택스 없음
  { '2026-06': [ { date: '2026-06-03', desc: '주식회사 와드', withdraw: 2200000, summary: '전자금융', kind: '기타출금' } ] }, // 6월 통장: 와드 결제
);
const rCarry1 = M.reconcilePurchase3Way('2026-06');
const wade = rCarry1.rows.find(x => /와드/.test(x.name));
eq(wade && wade.status, 'paid_prev', '이월: 6월 와드 통장출금 → 전월분 결제(paid_prev, missing_buy 아님)');
eq(wade && wade.prevOpen, 2200000, '이월: 전월 미지급 2,200,000 인식');
eq(rCarry1.rows.filter(x => x.status === 'missing_buy').length, 0, '이월: missing_buy 오탐 0건');

// 전월에 이미 결제된 경우엔 이월 안 됨: 5월 와드 매입 O + 5월 통장 결제 O → 6월 와드 출금은 그냥 missing_buy(전월분 아님)
M.setMulti(
  { '2026-05-26': { purchaseRows: [ { date: '2026-05-26', vendor: '주식회사 와드', bizNo: '6148800597', category: '마케팅', supply: 2000000, vat: 200000, total: 2200000, method: '계좌이체' } ] } },
  {},
  {
    '2026-05': [ { date: '2026-05-28', desc: '주식회사 와드', withdraw: 2200000, summary: '전자금융', kind: '기타출금' } ], // 5월에 이미 결제
    '2026-06': [ { date: '2026-06-03', desc: '주식회사 와드', withdraw: 500000, summary: '전자금융', kind: '기타출금' } ],   // 6월 별도 출금
  },
);
const rCarry2 = M.reconcilePurchase3Way('2026-06');
const wade2 = rCarry2.rows.find(x => /와드/.test(x.name));
eq(wade2 && wade2.prevOpen, 0, '이월: 전월에 이미 결제됐으면 미지급 0 (이월 안 됨)');
ok(wade2 && wade2.status !== 'paid_prev', '이월: 전월 결제 완료분은 paid_prev 아님');

// ── 별칭 방향 자동 교정 (거꾸로/월고정 저장 치유) ──
// 안정적인 KT(사업자번호)를 소스로, 가변 통장행 'KT통신요금05'를 대상으로 반대로 연결한 케이스.
// 저장된 별칭: pattern '케이티' → target 'n:kt통신요금05'(월고정). 5월은 우연히 붙지만 6월(요금06)엔 깨짐.
// reconcile가 pattern 'kt통신요금' → target 'b:<KT사업자번호>'로 자동 교정해 매월 한 줄로 병합돼야 함.
M.setMulti(
  { '2026-05-06': { purchaseRows: [ { date: '2026-05-06', vendor: '주식회사 케이티', bizNo: '1028142945', category: '통신비', supply: 1700, vat: 170, total: 1870, method: '계좌이체' } ] },
    '2026-06-06': { purchaseRows: [ { date: '2026-06-06', vendor: '주식회사 케이티', bizNo: '1028142945', category: '통신비', supply: 1700, vat: 170, total: 1870, method: '계좌이체' } ] } },
  { '2026-05': [ { date: '2026-05-06', vendor: '주식회사 케이티', bizNo: '1028142945', supply: 1700, vat: 170, total: 1870, docType: '세금계산서' } ],
    '2026-06': [ { date: '2026-06-06', vendor: '주식회사 케이티', bizNo: '1028142945', supply: 1700, vat: 170, total: 1870, docType: '세금계산서' } ] },
  { '2026-05': [ { date: '2026-05-10', desc: 'KT통신요금05', withdraw: 1870, summary: 'FBS출금', kind: '통신비' } ],
    '2026-06': [ { date: '2026-06-10', desc: 'KT통신요금06', withdraw: 1870, summary: 'FBS출금', kind: '통신비' } ] },
);
M.setP3map({ 'b:1028142945': { kind: 'alias', target: 'n:kt통신요금05', pattern: '케이티', label: '주식회사 케이티', targetLabel: 'KT통신요금05' } });
const kt5 = M.reconcilePurchase3Way('2026-05').rows.filter(x => /케이티|kt통신/i.test(x.name));
eq(kt5.length, 1, '별칭교정: 5월 KT 한 줄로 병합(매입+계산서+통장)');
eq(kt5[0] && kt5[0].status, 'complete', '별칭교정: 5월 KT complete');
const kt6 = M.reconcilePurchase3Way('2026-06').rows.filter(x => /케이티|kt통신/i.test(x.name));
eq(kt6.length, 1, '별칭교정: 6월도 한 줄(월고정 아님 — KT통신요금06도 매칭)');
eq(kt6[0] && kt6[0].status, 'complete', '별칭교정: 6월 KT complete');

console.log(`\n3-way 점검 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
