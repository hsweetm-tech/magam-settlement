// 단위 테스트: 홈택스 파서 + 대사 검증
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};
// anchor: 함수의 닫는 중괄호는 항상 줄 시작 위치(no leading whitespace) → /\n\}/
const numFn = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const colsConst = grab(/const HOMETAX_COLUMNS = \{[\s\S]*?\n\};/, 'HOMETAX_COLUMNS');
const detect = grab(/function detectHometaxDocType[\s\S]*?\n\}/, 'detectHometaxDocType');
const mc = grab(/function _matchHometaxCol[\s\S]*?\n\}/, '_matchHometaxCol');
const pd = grab(/function _parseHometaxDate[\s\S]*?\n\}/, '_parseHometaxDate');
const nb = grab(/function _normalizeBizNo[\s\S]*?\n\}/, '_normalizeBizNo');
const parse = grab(/function parseHometaxRows[\s\S]*?\n\}/, 'parseHometaxRows');
const recon = grab(/function reconcileHometax[\s\S]*?\n\}/, 'reconcileHometax');
const subN1 = grab(/function _htSubsetSumN1[\s\S]*?\n\}/, '_htSubsetSumN1');

const src = `
  let _records = {};
  let _hometax = {};
  function getAllRecords() { return _records; }
  function getHometaxData(month) { return _hometax[month] || []; }
  ${numFn}
  ${colsConst}
  ${mc}
  ${pd}
  ${nb}
  ${detect}
  ${parse}
  ${subN1}
  ${recon}
  return {
    num, parseHometaxRows, detectHometaxDocType, reconcileHometax,
    setRecords: (r) => { _records = r; },
    setHometax: (m, arr) => { _hometax[m] = arr; },
    _normalizeBizNo
  };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}

// ===== 파서 =====
// CASE 1: 세금계산서 컬럼명 인식
let parsed = mod.parseHometaxRows([
  { '작성일자': '2026-05-10', '공급자상호': '아스트라식자재', '사업자등록번호': '123-45-67890', '공급가액': 500000, '세액': 50000, '합계': 550000 }
], '매입세금계산서_2026-05.xlsx', '2026-05');
check('1) 세금계산서 docType', parsed.docType === '세금계산서');
check('1) 레코드 1건', parsed.records.length === 1);
check('1) 일자 ISO', parsed.records[0].date === '2026-05-10');
check('1) 거래처', parsed.records[0].vendor === '아스트라식자재');
check('1) 사업자번호 정규화', parsed.records[0].bizNo === '1234567890');
check('1) 공급가', parsed.records[0].supply === 500000);
check('1) 세액', parsed.records[0].vat === 50000);
check('1) 합계', parsed.records[0].total === 550000);

// CASE 2: 카드 파일명 → docType 카드전표
parsed = mod.parseHometaxRows([
  { '결제일자': '2026.05.12', '가맹점명': '이마트', '가맹점사업자번호': '111-22-33333', '공급가액': '100,000', '부가세': '10,000', '승인금액': '110,000' }
], '신용카드매입_2026-05.xlsx', '2026-05');
check('2) 카드 docType', parsed.docType === '카드전표');
check('2) 카드 일자 dot 포맷', parsed.records[0].date === '2026-05-12');
check('2) 카드 합계 콤마 처리', parsed.records[0].total === 110000);

// CASE 3: 합계 없으면 supply+vat
parsed = mod.parseHometaxRows([
  { '거래일자': '2026-05-15', '상호': '주류상사', '등록번호': '999-88-77777', '공급가': 200000, '세액': 20000 }
], '계산서.xlsx', '2026-05');
check('3) total 누락 → supply+vat 보정', parsed.records[0].total === 220000);

// CASE 4: 합계/공급가 모두 0인 행은 제외
parsed = mod.parseHometaxRows([
  { '작성일자': '2026-05-10', '상호': 'A', '공급가액': 100000, '세액': 10000, '합계': 110000 },
  { '작성일자': '2026-05-11', '상호': 'B', '공급가액': 0, '세액': 0, '합계': 0 }
], 'x.xlsx', '2026-05');
check('4) 0원 행 제외', parsed.records.length === 1);

// CASE 5: 미감지 컬럼 보고
parsed = mod.parseHometaxRows([
  { '일자': '2026-05-10', '회사': 'X', '돈': 100000 }
], 'x.xlsx', '2026-05');
check('5) supply 미감지', parsed.detected.supply == null);
check('5) total 미감지', parsed.detected.total == null);

// ===== 대사 =====
// 시나리오: 5월에 입력 매입 3건, 홈택스 4건 (3 일치 + 1 누락)
mod.setRecords({
  '2026-05-10': {
    purchaseRows: [
      { date: '2026-05-10', vendor: '아스트라식자재', bizNo: '123-45-67890', supply: 500000, vat: 50000, total: 550000, docType: '세금계산서' }
    ]
  },
  '2026-05-12': {
    purchaseRows: [
      { date: '2026-05-12', vendor: '이마트', bizNo: '1112233333', supply: 100000, vat: 10000, total: 110000, docType: '카드전표' },
      { date: '2026-05-12', vendor: '동네분식', supply: 30000, vat: 0, total: 30000, docType: '구매영수증' } // 간이영수증, 홈택스에 없음
    ]
  }
});
mod.setHometax('2026-05', [
  { date: '2026-05-10', vendor: '아스트라식자재', bizNo: '1234567890', supply: 500000, vat: 50000, total: 550000, docType: '세금계산서' },
  { date: '2026-05-12', vendor: '이마트', bizNo: '1112233333', supply: 100000, vat: 10000, total: 110000, docType: '카드전표' },
  { date: '2026-05-20', vendor: '농협하나로', bizNo: '5556677777', supply: 200000, vat: 20000, total: 220000, docType: '세금계산서' } // 입력 누락
]);

let r = mod.reconcileHometax('2026-05');
check('6) 일치 2건', r.matched.length === 2, `got ${r.matched.length}`);
check('6) 홈택스만 1건 (농협하나로)', r.orphanHometax.length === 1);
check('6) 입력만 1건 (동네분식)', r.orphanApp.length === 1);
check('6) appRows=3', r.appRows.length === 3);
check('6) hometax=3', r.hometaxRows.length === 3);

// CASE 7: 사업자번호 다르지만 거래처+합계 일치하면 매칭
mod.setRecords({
  '2026-06-01': { purchaseRows: [{ vendor: '카페A', supply: 50000, vat: 0, total: 50000 }] }
});
mod.setHometax('2026-06', [{ date: '2026-06-01', vendor: '카페A', total: 50000, supply: 50000, vat: 0 }]);
r = mod.reconcileHometax('2026-06');
check('7) 사업자번호 없이도 거래처+합계로 매칭', r.matched.length === 1);

// CASE 8: 합계 차이 11원 이상 → 미매칭
mod.setRecords({
  '2026-07-01': { purchaseRows: [{ vendor: '카페B', total: 50000, supply: 50000 }] }
});
mod.setHometax('2026-07', [{ date: '2026-07-01', vendor: '카페B', total: 50100, supply: 50100 }]);
r = mod.reconcileHometax('2026-07');
check('8) 합계 차이 100원 → 미매칭', r.matched.length === 0 && r.orphanHometax.length === 1);

// CASE 9: 홈택스 데이터 없음 → 빈 결과
r = mod.reconcileHometax('2026-08');
check('9) 데이터 없음', r.matched.length === 0 && r.hometaxRows.length === 0);

// CASE 10: 실제 홈택스 양식 — 공급자사업자등록번호가 상호보다 앞 컬럼 (회귀 방지)
// 버그: vendor 후보 '공급자'가 '공급자사업자등록번호'를 잡아 상호=사업자번호가 됐었음.
parsed = mod.parseHometaxRows([
  { '작성일자': '2026-05-10', '승인번호': 'x', '공급자사업자등록번호': '211-88-12345', '종사업장번호': '',
    '상호': '코카콜라음료', '대표자명': '홍길동', '공급받는자사업자등록번호': '795-53-01082',
    '합계금액': 110000, '공급가액': 100000, '세액': 10000 }
], '매입세금계산서.xls', '2026-05');
check('10) vendor=상호값(코카콜라음료)', parsed.records[0].vendor === '코카콜라음료', `got "${parsed.records[0].vendor}"`);
check('10) vendor에 사업자번호 안 들어감', !/^\d{8,}$/.test(parsed.records[0].vendor));
check('10) bizNo=공급자사업자등록번호', parsed.records[0].bizNo === '2118812345');
check('10) representative=대표자명', parsed.records[0].representative === '홍길동');
check('10) total/supply/vat', parsed.records[0].total === 110000 && parsed.records[0].supply === 100000 && parsed.records[0].vat === 10000);

// CASE 11: 코카콜라 — 사업자번호 없이 상호+합계만 일치해도 매칭 (버그2 회귀 방지)
mod.setHometax('2026-09', [{ date: '2026-09-03', vendor: '코카콜라음료', bizNo: '2118812345', total: 110000, supply: 100000, vat: 10000 }]);
mod.setRecords({ '2026-09-03': { purchaseRows: [{ date: '2026-09-03', vendor: '코카콜라음료', supply: 100000, vat: 10000, total: 110000 }] } });
r = mod.reconcileHometax('2026-09');
check('11) 코카콜라 상호+합계로 매칭', r.matched.length === 1 && r.orphanHometax.length === 0, `matched ${r.matched.length}`);

// CASE 12: 단지푸드 — 월정산 N:1 (홈택스 1건 ↔ 일별 입력 N건 합산)
mod.setRecords({
  '2026-10-05': { purchaseRows: [{ date: '2026-10-05', vendor: '단지푸드', supply: 200000, vat: 20000, total: 220000 }] },
  '2026-10-15': { purchaseRows: [{ date: '2026-10-15', vendor: '단지푸드', supply: 250000, vat: 25000, total: 275000 }] },
  '2026-10-25': { purchaseRows: [{ date: '2026-10-25', vendor: '단지푸드', supply: 150000, vat: 15000, total: 165000 }] },
});
// 월말 합산 세금계산서 1건: 220000+275000+165000 = 660000
mod.setHometax('2026-10', [{ date: '2026-10-31', vendor: '단지푸드', bizNo: '1112233344', supply: 600000, vat: 60000, total: 660000, docType: '세금계산서' }]);
r = mod.reconcileHometax('2026-10');
check('12) N:1 단지푸드 매칭 1건', (r.matchedN1 || []).length === 1, `matchedN1 ${(r.matchedN1||[]).length}`);
check('12) N:1 합산 3건', r.matchedN1 && r.matchedN1[0].count === 3, `count ${r.matchedN1 && r.matchedN1[0].count}`);
check('12) N:1 합계 660000', r.matchedN1 && r.matchedN1[0].total === 660000);
check('12) 홈택스 orphan 0', r.orphanHometax.length === 0);
check('12) 입력 orphan 0 (3건 모두 묶임)', r.orphanApp.length === 0);
check('12) 1:1 matched 0 (전부 N:1)', r.matched.length === 0);

// CASE 13: 합산이 안 맞으면 N:1 매칭 안 함
mod.setRecords({
  '2026-11-05': { purchaseRows: [{ date: '2026-11-05', vendor: '단지푸드', total: 100000, supply: 100000 }] },
  '2026-11-15': { purchaseRows: [{ date: '2026-11-15', vendor: '단지푸드', total: 100000, supply: 100000 }] },
});
mod.setHometax('2026-11', [{ date: '2026-11-30', vendor: '단지푸드', total: 500000, supply: 500000 }]); // 합 200000 ≠ 500000
r = mod.reconcileHometax('2026-11');
check('13) 합 불일치 → N:1 매칭 안 함', (r.matchedN1 || []).length === 0 && r.orphanHometax.length === 1);

// CASE 14: 단지푸드 — 과세 세금계산서 + 면세 계산서 분리발행 → 부분집합 N:1
// 일별 매입 5건: 과세 3건(부가>0) 합 900,000 / 면세 2건(부가0) 합 500,000. 전체합 1,400,000.
mod.setRecords({
  '2026-12-03': { purchaseRows: [{ date: '2026-12-03', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 300000, vat: 30000, total: 330000 }] },
  '2026-12-10': { purchaseRows: [{ date: '2026-12-10', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 250000, vat: 25000, total: 275000 }] },
  '2026-12-17': { purchaseRows: [{ date: '2026-12-17', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 268182, vat: 26818, total: 295000 }] }, // 과세 3건 합 900,000
  '2026-12-05': { purchaseRows: [{ date: '2026-12-05', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 200000, vat: 0, total: 200000 }] },
  '2026-12-20': { purchaseRows: [{ date: '2026-12-20', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 300000, vat: 0, total: 300000 }] }, // 면세 2건 합 500,000
});
// 홈택스: 세금계산서(과세) 900,000 + 계산서(면세) 500,000 — 일별 전체합(1,400,000) 아님
mod.setHometax('2026-12', [
  { date: '2026-12-31', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 818182, vat: 81818, total: 900000, docType: '세금계산서' },
  { date: '2026-12-31', vendor: '(주)단지푸드', bizNo: '5478102961', supply: 500000, vat: 0, total: 500000, docType: '계산서' },
]);
r = mod.reconcileHometax('2026-12');
check('14) 분리발행 N:1 2건 매칭', (r.matchedN1 || []).length === 2, `matchedN1 ${(r.matchedN1||[]).length}`);
const n1by = {}; (r.matchedN1 || []).forEach(m => n1by[m.total] = m.count);
check('14) 과세 900,000 = 3건 부분집합', n1by[900000] === 3, JSON.stringify(n1by));
check('14) 면세 500,000 = 2건 부분집합', n1by[500000] === 2, JSON.stringify(n1by));
check('14) 입력 5건 모두 묶임(orphan 0)', r.orphanApp.length === 0);
check('14) 홈택스 orphan 0', r.orphanHometax.length === 0);

if (!process.exitCode) console.log('\n전체 통과');
