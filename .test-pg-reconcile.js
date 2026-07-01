// 단위 테스트: 이지피지 PG 정산 파서 + 대사 (PG↔통장 입금 / PG↔마감 카드매출)
// 실행: node .test-pg-reconcile.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};
// anchor: 함수 닫는 중괄호는 항상 줄 시작 (no leading whitespace)
const numFn      = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const matchCol   = grab(/function _matchHometaxCol[\s\S]*?\n\}/, '_matchHometaxCol');
const pgCols     = grab(/const PG_COLUMNS = \{[\s\S]*?\n\};/, 'PG_COLUMNS');
const pgDate     = grab(/function _parsePgDate[\s\S]*?\n\}/, '_parsePgDate');
const pgParse    = grab(/function parsePgSettleRows[\s\S]*?\n\}/, 'parsePgSettleRows');
const recCard    = grab(/function _recordCardSales[\s\S]*?\n\}/, '_recordCardSales');
const recPgBank  = grab(/function reconcilePgBank[\s\S]*?\n\}/, 'reconcilePgBank');
const recPgCard  = grab(/function reconcilePgDailyCard[\s\S]*?\n\}/, 'reconcilePgDailyCard');
const vanParse   = grab(/function parseVanSalesRows[\s\S]*?\n\}/, 'parseVanSalesRows');
const cardPats   = grab(/const CARD_ISSUER_PATTERNS = \[[\s\S]*?\n\];/, 'CARD_ISSUER_PATTERNS');
const matchIssue = grab(/function _matchCardIssuer[\s\S]*?\n\}/, '_matchCardIssuer');
const classifyDep = grab(/function _classifyDepositChannel[\s\S]*?\n\}/, '_classifyDepositChannel');
const directExc  = grab(/const DIRECT_CARD_EXCLUDE = [^\n]*/, 'DIRECT_CARD_EXCLUDE');
const dirIssuers = grab(/const DIRECT_CARD_ISSUERS = \[[\s\S]*?\n\];/, 'DIRECT_CARD_ISSUERS');
const revRate    = grab(/function _reverseFeeRate[\s\S]*?\n\}/, '_reverseFeeRate');
const recDirect  = grab(/function reconcileDirectCard[\s\S]*?\n\}/, 'reconcileDirectCard');
const cardDisp   = grab(/const CARD_ISSUER_DISPLAY = \{[\s\S]*?\n\};/, 'CARD_ISSUER_DISPLAY');
const dispName   = grab(/function _displayCardName[\s\S]*?\n\}/, '_displayCardName');
const pgByDay    = grab(/function _pgGrossByDayIssuer[\s\S]*?\n\}/, '_pgGrossByDayIssuer');
const closeVsPg  = grab(/function reconcileCloseVsPg[\s\S]*?\n\}/, 'reconcileCloseVsPg');
const applyCorr  = grab(/function applyCloseCorrection\(date, skipConfirm\)[\s\S]*?\n\}/, 'applyCloseCorrection');

const src = `
  let _pg = {}, _bank = {}, _records = {}, _van = {}, _rates = {}, _ls = {};
  function getPgSettleData(m) { return _pg[m] || []; }
  function getKbBankData(m) { return _bank[m] || []; }
  function getAllRecords() { return _records; }
  function getPgVanData(m) { return _van[m] || []; }
  function getPgDirectRates() { return _rates; }
  const STORAGE_KEY = 'dailySettlement_v1';
  const localStorage = { setItem: (k, v) => { _ls[k] = v; }, getItem: (k) => _ls[k] || null };
  function _queueCloudUpload() {}
  function toast() {}
  ${numFn}
  ${matchCol}
  ${pgCols}
  ${pgDate}
  ${pgParse}
  ${recCard}
  ${recPgBank}
  ${recPgCard}
  ${vanParse}
  ${cardPats}
  ${matchIssue}
  ${classifyDep}
  ${directExc}
  ${dirIssuers}
  ${revRate}
  ${recDirect}
  ${cardDisp}
  ${dispName}
  ${pgByDay}
  ${closeVsPg}
  ${applyCorr}
  return {
    parsePgSettleRows, reconcilePgBank, reconcilePgDailyCard, _parsePgDate, _recordCardSales,
    parseVanSalesRows, _matchCardIssuer, _classifyDepositChannel, _reverseFeeRate, reconcileDirectCard,
    _pgGrossByDayIssuer, reconcileCloseVsPg, applyCloseCorrection,
    setPg: (m, a) => { _pg[m] = a; }, setBank: (m, a) => { _bank[m] = a; }, setRecords: (r) => { _records = r; },
    setVan: (m, a) => { _van[m] = a; }, setRates: (r) => { _rates = r; }, getRecords: () => _records
  };
`;
const M = new Function(src)();

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}\n     got=${g}\n    want=${w}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } };

// ── 1. 날짜 파서 ──
eq(M._parsePgDate('20260513'), '2026-05-13', 'YYYYMMDD');
eq(M._parsePgDate('2026-05-13'), '2026-05-13', 'YYYY-MM-DD');
eq(M._parsePgDate('2026.5.9'), '2026-05-09', 'YYYY.M.D 패딩');
eq(M._parsePgDate(''), '', '빈값');

// ── 2. 파서: 컬럼 매핑 + 합계행/빈행 스킵 ──
const rawRows = [
  { '지급일자':'20260513','거래일자':'20260509','취소일자':'','정산대상금액':171500,'대행수수료':4974,'대행수수료VAT':497,'실지급금액':166029,'발급사':'하나','거래상태':'승인','승인번호':'05105618','결제수단':'신용카드' },
  { '지급일자':'20260513','거래일자':'20260509','취소일자':'','정산대상금액':'121,700','대행수수료':3529,'대행수수료VAT':352,'실지급금액':'117,819','발급사':'국민','거래상태':'승인','승인번호':'25032933','결제수단':'신용카드' },
  { '지급일자':'','거래일자':'','취소일자':'','정산대상금액':'','대행수수료':'','대행수수료VAT':'','실지급금액':'','발급사':'','거래상태':'','승인번호':'','결제수단':'' }, // 빈/합계행 → 스킵
];
const { records, detected } = M.parsePgSettleRows(rawRows, '2026-05');
eq(records.length, 2, '파서: 빈행 제외 2건');
ok(detected.payoutDate && detected.gross && detected.net, '파서: 핵심 컬럼 감지');
eq(records[0].net, 166029, '파서: 숫자');
eq(records[1].gross, 121700, '파서: 콤마 제거 후 숫자');
eq(records[0].payoutDate, '2026-05-13', '파서: 지급일자 정규화');

// ── 3. PG ↔ 통장 입금 대사 ──
// 지급일자별 실지급 합계가 통장 에비뉴에이치 입금과 일치/차액/누락/익월예정
M.setPg('2026-05', [
  // 05-13 지급: net 166029 + 117819 = 283848 → 통장 283848 (일치)
  { payoutDate:'2026-05-13', txnDate:'2026-05-09', gross:171500, fee:4974, feeVat:497, net:166029, issuer:'하나' },
  { payoutDate:'2026-05-13', txnDate:'2026-05-09', gross:121700, fee:3529, feeVat:352, net:117819, issuer:'국민' },
  // 05-15 지급: net 100000 → 통장 99000 (차액 -1000)
  { payoutDate:'2026-05-15', txnDate:'2026-05-12', gross:103000, fee:2727, feeVat:273, net:100000, issuer:'신한' },
  // 05-18 지급: net 50000 → 통장에 없음 (입금누락)
  { payoutDate:'2026-05-18', txnDate:'2026-05-15', gross:51500, fee:1363, feeVat:137, net:50000, issuer:'삼성' },
  // 06-01 지급(익월): net 30000 → 통장 5월엔 없음 (pending, 누락 아님)
  { payoutDate:'2026-06-01', txnDate:'2026-05-29', gross:30900, fee:818, feeVat:82, net:30000, issuer:'롯데' },
]);
M.setBank('2026-05', [
  { date:'2026-05-13', deposit:283848, withdraw:0, desc:'에비뉴에이치', summary:'전자금융' },
  { date:'2026-05-15', deposit:99000,  withdraw:0, desc:'에비뉴에이치', summary:'전자금융' },
  { date:'2026-05-20', deposit:50000,  withdraw:0, desc:'김상균', summary:'인터넷출금이체' }, // 에비뉴 아님 → 매칭 안 함
]);
const rb = M.reconcilePgBank('2026-05');
const byDate = {}; rb.payouts.forEach(p => byDate[p.date] = p);
eq(byDate['2026-05-13'].status, 'match', 'PG↔통장: 05-13 일치');
eq(byDate['2026-05-13'].net, 283848, 'PG↔통장: 05-13 실지급 합계');
eq(byDate['2026-05-15'].status, 'diff', 'PG↔통장: 05-15 차액');
eq(byDate['2026-05-15'].diff, -1000, 'PG↔통장: 05-15 차액 -1000');
eq(byDate['2026-05-18'].status, 'missing', 'PG↔통장: 05-18 입금누락');
eq(byDate['2026-06-01'].status, 'pending', 'PG↔통장: 06-01 익월 정산예정');
// 에비뉴 아닌 입금(김상균 50000)은 매칭 대상 아님 → unmatchedDeposits에도 없음(필터에서 제외)
eq(rb.unmatchedDeposits.length, 0, 'PG↔통장: 에비뉴 외 입금은 후보 아님');
eq(rb.bankDepositCount, 2, 'PG↔통장: 에비뉴 입금 2건만 후보');

// ── 3b. 회귀: 대형 지급을 같은 날 소액 입금에 억지 매칭하지 않음 ──
// (실지급 4,596,825 ↔ 같은날 96,114 → 예전엔 diff -4,500,711로 잘못 뜸. 이제 missing)
M.setPg('2026-05', [
  { payoutDate:'2026-05-28', txnDate:'2026-05-25', gross:4700000, fee:98000, feeVat:9800, net:4596825, issuer:'현대' },
]);
M.setBank('2026-05', [
  { date:'2026-05-28', deposit:96114, withdraw:0, desc:'에비뉴에이치', summary:'전자금융' },
]);
const rbBig = M.reconcilePgBank('2026-05');
const p28 = rbBig.payouts.find(p => p.date === '2026-05-28');
eq(p28.status, 'missing', '회귀: 대형지급↔소액입금 억지매칭 안 함(missing)');
eq(p28.diff, 0, '회귀: 억지 차액 안 만듦(diff 0)');
eq(rbBig.unmatchedDeposits.length, 1, '회귀: 소액 입금은 미매칭으로 남음');

// ── 4. PG ↔ 마감 카드매출 대사 ──
// 거래일자별 gross 합계 vs record 카드매출 (cardRows 우선, 없으면 totals.posCard)
M.setPg('2026-05', [
  { payoutDate:'2026-05-13', txnDate:'2026-05-09', gross:171500, net:166029 },
  { payoutDate:'2026-05-13', txnDate:'2026-05-09', gross:121700, net:117819 }, // 05-09 PG합 293200
  { payoutDate:'2026-05-15', txnDate:'2026-05-12', gross:100000, net:97000 },   // 05-12 PG합 100000
  { payoutDate:'2026-05-18', txnDate:'2026-05-15', gross:60000,  net:58200 },   // 05-15 PG합 60000
  { payoutDate:'2026-06-01', txnDate:'2026-06-01', gross:9999,   net:9700 },    // 타월 거래 → 제외
]);
M.setRecords({
  '2026-05-09': { totals:{ posCard:293200 }, cardRows:[] },                       // 일치
  '2026-05-12': { totals:{ posCard:0 }, cardRows:[{amount:135486},{amount:0}] },  // 마감 135486 > PG 100000 → over_close (VAN 추정)
  '2026-05-15': { totals:{ posCard:40000 }, cardRows:[] },                        // 마감 40000 < PG 60000 → over_pg (과소입력 의심)
  '2026-05-20': { totals:{ posCard:50000 }, cardRows:[] },                        // PG 거래 없음 → no_pg
});
const rc = M.reconcilePgDailyCard('2026-05');
const cd = {}; rc.rows.forEach(r => cd[r.date] = r);
eq(cd['2026-05-09'].status, 'match', 'PG↔마감: 05-09 일치');
eq(cd['2026-05-12'].status, 'over_close', 'PG↔마감: 05-12 마감>PG(VAN)');
eq(cd['2026-05-12'].card, 135486, 'PG↔마감: cardRows 합 우선');
eq(cd['2026-05-15'].status, 'over_pg', 'PG↔마감: 05-15 PG>마감(과소입력)');
eq(cd['2026-05-15'].diff, -20000, 'PG↔마감: 05-15 차이 -20000');
eq(cd['2026-05-20'].status, 'no_pg', 'PG↔마감: 05-20 PG거래 없음');
ok(!cd['2026-06-01'], 'PG↔마감: 타월 거래 제외');

// ── 5. record 없는데 PG 거래만 있는 날 → no_close ──
M.setRecords({});
M.setPg('2026-05', [{ payoutDate:'2026-05-13', txnDate:'2026-05-09', gross:50000, net:48500 }]);
const rc2 = M.reconcilePgDailyCard('2026-05');
eq(rc2.rows[0].status, 'no_close', 'PG↔마감: 마감 record 없음 → no_close');

// ── 6. VAN 시트 파서 (발급사별 직승인 매출) ──
const vanAoa = [
  ['', '', '', '', '', '', ''],
  ['1.업체정보', '', '', '', '', '', ''],
  ['상호명(법인명)', '에비뉴 에이치', '', '조회기간', '260501 ~ 260531', '', ''],
  ['※ 아래의 데이터는 승인 - 취소 건수 입니다.', '', '', '', '', '', ''],
  ['2.신용카드', '', '', '', '', '', ''],
  ['26년 05월', '', '거래건수', '거래금액', '봉사료', '부가세', '비과세'],
  ['삼성 합계', '', 3, 140400, 0, 12763, 0],
  ['해외 합계', '', 5, 322900, 0, 29352, 0],
  ['합계', '', 8, 463300, 0, 42115, 0],   // 전체합계 → 스킵
  ['', '', '', '', '', '', ''],
  ['총계 ', '', 8, 463300, 0, 42115, 0],  // 총계 → 스킵
];
const vanRows = M.parseVanSalesRows(vanAoa);
eq(vanRows.length, 2, 'VAN: 발급사 2건(삼성·해외), 합계/총계 제외');
eq(vanRows[0], { issuer: '삼성', count: 3, gross: 140400 }, 'VAN: 삼성 합계');
eq(vanRows[1], { issuer: '해외', count: 5, gross: 322900 }, 'VAN: 해외 합계');
eq(M.parseVanSalesRows([['헤더없음']]).length, 0, 'VAN: 헤더 못찾으면 빈배열');

// ── 7. 카드사 정규화 + VAN 역산 상태 판정 ──
eq(M._matchCardIssuer('국민카드'), '국민', '정규화: 국민카드→국민');
eq(M._matchCardIssuer('하나92751350'), '하나', '정규화: 하나+숫자→하나');
eq(M._matchCardIssuer('BC-745552845'), '비씨', '정규화: BC→비씨');
eq(M._matchCardIssuer('김상균'), null, '정규화: 카드사 아님→null');
eq(M._reverseFeeRate(140400, 135486).status, 'ok', '역산: 삼성 3.5%→ok');
ok(Math.abs(M._reverseFeeRate(140400, 135486).rate - 0.035) < 1e-9, '역산: 정확히 3.5%');
eq(M._reverseFeeRate(322900, 137488).status, 'partial', '역산: 입금부족→partial(부분/익월)');
eq(M._reverseFeeRate(100000, 100500).status, 'over', '역산: 입금>매출→over');
eq(M._reverseFeeRate(100000, 0).status, 'no_deposit', '역산: 입금 없음');

// ── 8. 대사 ③: VAN 직승인 ↔ 통장 직접입금 역산 (5월 실데이터) ──
M.setRates({});
M.setVan('2026-05', [{ issuer: '삼성', count: 3, gross: 140400 }, { issuer: '해외', count: 5, gross: 322900 }]);
M.setBank('2026-05', [
  { date: '2026-05-14', deposit: 39372, desc: '삼성카드' },
  { date: '2026-05-28', deposit: 96114, desc: '삼성카드' },
  { date: '2026-05-20', deposit: 88212, desc: '하나92751350' },
  { date: '2026-05-27', deposit: 49276, desc: 'BC-745552845' },
  // 노이즈: 에비뉴(PG ①)·쿠페이 환입·1원 인증 → 제외
  { date: '2026-05-13', deposit: 283848, desc: '에비뉴에이치' },
  { date: '2026-05-15', deposit: 28870, desc: '쿠팡페이(쿠페이)' },
  { date: '2026-05-01', deposit: 1, desc: '호주노래' },
]);
const rd = M.reconcileDirectCard('2026-05');
const gi = {}; rd.groups.forEach(g => gi[g.issuer] = g);
eq(gi['삼성'].depSum, 135486, '대사③: 삼성 통장입금합 135,486');
eq(gi['삼성'].status, 'ok', '대사③: 삼성 정상');
ok(Math.abs(gi['삼성'].rate - 0.035) < 1e-9, '대사③: 삼성 역산율 3.5%');
eq(gi['삼성'].deposits.map(d => d.reverseGross), [40800, 99600], '대사③: 삼성 역산매출 40800·99600');
eq(gi['해외'].depSum, 137488, '대사③: 해외 부분입금 137,488');
eq(gi['해외'].status, 'partial', '대사③: 해외 부분/익월');
ok(!rd.groups.some(g => g.deposits.some(d => /쿠페이|호주|에비뉴/.test(d.desc))), '대사③: 노이즈·PG 입금 제외');

// ── 9. 대사 ④: 마감 카드사 OCR 교정 (이지피지 기준) ──
M.setRecords({
  // 5/15: 총액 일치, 카드사만 뒤섞임(OCR 오분류) → mislabel
  '2026-05-15': { cardRows: [{ issuer: '삼성카드', amount: 300000 }, { issuer: '신한카드', amount: 100000 }] },
  // 5/09: 총액 +200(신한 과입력) → amount_diff
  '2026-05-09': { cardRows: [{ issuer: '신한카드', amount: 108800 }] },
  // 5/12: 완전 일치 → match
  '2026-05-12': { cardRows: [{ issuer: '국민카드', amount: 270300 }] },
});
M.setPg('2026-05', [
  { txnDate: '2026-05-15', issuer: '신한', gross: 300000, net: 290000 }, // 실제는 신한 30만
  { txnDate: '2026-05-15', issuer: '삼성', gross: 100000, net: 96500 },  // 실제는 삼성 10만
  { txnDate: '2026-05-09', issuer: '신한', gross: 108600, net: 105000 },
  { txnDate: '2026-05-12', issuer: '국민', gross: 270300, net: 262000 },
]);
const cc = M.reconcileCloseVsPg('2026-05');
const ci = {}; cc.rows.forEach(r => ci[r.date] = r);
eq(ci['2026-05-15'].status, 'mislabel', '대사④: 5/15 총액OK·카드사뒤섞임→mislabel');
eq(ci['2026-05-15'].totalDiff, 0, '대사④: 5/15 총액차 0');
eq(ci['2026-05-09'].status, 'amount_diff', '대사④: 5/9 +200→amount_diff');
eq(ci['2026-05-09'].totalDiff, 200, '대사④: 5/9 총액차 +200');
eq(ci['2026-05-12'].status, 'match', '대사④: 5/12 완전일치→match');
eq(cc.counts.mislabel, 1, '대사④: 오분류 1일');

// 교정 적용: 5/15 → 이지피지 기준(신한 30만/삼성 10만)으로 cardRows 덮어쓰기, 총액 보존
const okApply = M.applyCloseCorrection('2026-05-15', true);
ok(okApply, '대사④: 5/15 교정 성공');
const fixed = M.getRecords()['2026-05-15'].cardRows;
const fixedMap = {}; fixed.forEach(r => fixedMap[r.issuer] = r.amount);
eq(fixedMap['신한카드'], 300000, '대사④: 교정후 신한카드 300,000');
eq(fixedMap['삼성카드'], 100000, '대사④: 교정후 삼성카드 100,000');
eq(fixed.reduce((s, r) => s + r.amount, 0), 400000, '대사④: 교정후 총액 400,000 보존');
const cc2 = M.reconcileCloseVsPg('2026-05');
eq(cc2.rows.find(r => r.date === '2026-05-15').status, 'match', '대사④: 교정후 5/15 일치로 전환');

// ── 10. 통장 입금 채널 분류 (PG·직승인은 카드매출 미매칭 경고에서 제외) ──
eq(M._classifyDepositChannel('에비뉴에이치'), { channel: 'pg' }, '입금분류: 에비뉴=PG(①)');
eq(M._classifyDepositChannel('삼성카드'), { channel: 'direct', issuer: '삼성' }, '입금분류: 삼성카드=직승인(③)');
eq(M._classifyDepositChannel('하나92751350'), { channel: 'direct', issuer: '하나' }, '입금분류: 하나=직승인(③)');
eq(M._classifyDepositChannel('BC-745552845'), { channel: 'direct', issuer: '비씨' }, '입금분류: BC=직승인(③)');
eq(M._classifyDepositChannel('쿠팡페이(쿠페이)'), null, '입금분류: 쿠페이 환입은 제외(null)');
eq(M._classifyDepositChannel('김상균'), null, '입금분류: 일반 송금=미매칭(null)');

console.log(`\nPG 정산 대사 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
