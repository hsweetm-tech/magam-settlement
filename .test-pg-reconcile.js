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

const src = `
  let _pg = {}, _bank = {}, _records = {};
  function getPgSettleData(m) { return _pg[m] || []; }
  function getKbBankData(m) { return _bank[m] || []; }
  function getAllRecords() { return _records; }
  ${numFn}
  ${matchCol}
  ${pgCols}
  ${pgDate}
  ${pgParse}
  ${recCard}
  ${recPgBank}
  ${recPgCard}
  return {
    parsePgSettleRows, reconcilePgBank, reconcilePgDailyCard, _parsePgDate, _recordCardSales,
    setPg: (m, a) => { _pg[m] = a; }, setBank: (m, a) => { _bank[m] = a; }, setRecords: (r) => { _records = r; }
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

console.log(`\nPG 정산 대사 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
