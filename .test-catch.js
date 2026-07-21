// 단위 테스트: 캐치테이블 정산 — 파일 필드 파싱 헬퍼 + 월 요약·통장 대사 (_catchMonthlySummary)
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');
const grab = (re, name) => { const m = html.match(re); if (!m) { console.error('FAIL extract ' + name); process.exit(2); } return m[0]; };

const src = `
  ${grab(/function num\(v\)[\s\S]*?\n\}/, 'num')}
  ${grab(/function _catchPick[\s\S]*?\n\}/, '_catchPick')}
  ${grab(/function _catchDate[\s\S]*?\n\}/, '_catchDate')}
  ${grab(/function _catchMonthlySummary[\s\S]*?\n\}/, '_catchMonthlySummary')}
  return { _catchPick, _catchDate, _catchMonthlySummary };
`;
const M = new Function(src)();
let pass = 0, fail = 0;
const eq = (g, w, m) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.error(`  ✗ ${m}\n     got=${JSON.stringify(g)}\n    want=${JSON.stringify(w)}`); } };
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

// _catchDate: 캐치테이블 날짜 포맷들
eq(M._catchDate('2026-06-29 20:44:58'), '2026-06-29', 'date 시각 포함');
eq(M._catchDate('2026.06.29'), '2026-06-29', 'date 점 구분');
eq(M._catchDate('미정산'), '', 'date 비날짜 → 빈문자');
eq(M._catchDate(''), '', 'date 빈값');

// _catchPick: 컬럼명 공백 무시 매칭
eq(M._catchPick({ '판매/청구금액(A)': '57,800' }, ['판매/청구금액(A)']), '57,800', 'pick 완전일치');
eq(M._catchPick({ '총 잔여 결제액': 450000 }, ['총잔여결제액']), 450000, 'pick 공백 무시');
eq(M._catchPick({ '지급(예정)일자 ': '2026-07-02' }, ['지급(예정)일자']), '2026-07-02', 'pick 키 공백');
eq(M._catchPick({ a: 1 }, ['없는컬럼']), '', 'pick 미존재 → 빈문자');

// _catchMonthlySummary: 실데이터 축약 시나리오 (6월 캐치페이 + 예약금)
// 취소는 음수 금액의 별도 행(부분취소 포함) — 전량 합산으로 자동 상계되는지 검증
const catchData = {
  txns: [
    { date: '2026-06-28', status: '승인', amount: 61800, fee: 2651, net: 59149, payDate: '2026-07-01' },
    { date: '2026-06-28', status: '승인', amount: 24900, fee: 1068, net: 23832, payDate: '2026-07-01' },
    { date: '2026-06-15', status: '승인', amount: 155400, fee: 6667, net: 148733, payDate: '2026-06-17' },
    { date: '2026-06-13', status: '승인', amount: 50800, fee: 2179, net: 48621, payDate: '2026-06-16' },
    { date: '2026-06-13', status: '취소', amount: -20800, fee: -892, net: -19908, payDate: '2026-06-16' },
  ],
  reserves: [
    { status: '정산완료', startDate: '2026-06-06', endDate: '2026-06-19', amount: 450000, fee: 17550, net: 432450, payDate: '2026-06-24' },
    { status: '신청', startDate: '2026-06-20', endDate: '2026-06-22', amount: 110000, fee: 4290, net: 105710, payDate: '' },
  ]
};
const bankJun = [
  { date: '2026-06-16', desc: '캐치테이블', deposit: 28713, withdraw: 0 },  // 48,621 − 취소 19,908
  { date: '2026-06-17', desc: '캐치테이블', deposit: 148733, withdraw: 0 },
  { date: '2026-06-24', desc: '예약_캐치테이블', deposit: 432450, withdraw: 0 },
  { date: '2026-06-05', desc: '캐치테이블', deposit: 0, withdraw: 92400 },   // 월정액 출금 — 입금 대사에서 제외돼야 함
];
const bankJul = [
  { date: '2026-07-01', desc: '캐치테이블', deposit: 82981, withdraw: 0 },
];
const S = M._catchMonthlySummary(catchData, bankJun, bankJul);
eq(S.okCount, 4, '승인 건수');
eq(S.cancelled, 1, '취소 건수');
eq(S.sales, 61800 + 24900 + 155400 + 50800 - 20800, '판매 합계 (취소 상계)');
eq(S.fee, 2651 + 1068 + 6667 + 2179 - 892, '수수료 합계 (취소 상계)');
eq(S.net, 59149 + 23832 + 148733 + 48621 - 19908, '정산액 합계 (취소 상계)');
// 지급일별 대사
const p616 = S.payRows.find(r => r.payDate === '2026-06-16');
const p617 = S.payRows.find(r => r.payDate === '2026-06-17');
const p701 = S.payRows.find(r => r.payDate === '2026-07-01');
eq(p616 && [p616.expected, p616.got, p616.diff], [28713, 28713, 0], '6/16 취소 차감 후 일치');
eq(p617 && [p617.expected, p617.got, p617.diff], [148733, 148733, 0], '6/17 지급 일치');
eq(p701 && [p701.expected, p701.got, p701.diff], [82981, 82981, 0], '7/1 익월 입금 매칭');
// 예약금: 정산일 입금 매칭 (예약_ prefix)
eq(S.reserves[0].got, 432450, '예약금 1차 입금 매칭');
eq(S.reserves[1].got, 0, '예약금 미정산 → 입금 없음');
eq(S.resSales, 560000, '예약금 매출 합');
eq(S.resFee, 21840, '예약금 수수료 합');

console.log(`캐치테이블 정산 테스트: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
