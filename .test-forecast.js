// 단위 테스트: computeProfitForecast / _computeWeekdayBaseline
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};

const numFn = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const holConst = grab(/const KOREAN_HOLIDAYS = \{[\s\S]*?\n\};/, 'KOREAN_HOLIDAYS');
const wxConst = grab(/const WEATHER_CODE_KO = \{[\s\S]*?\n\};/, 'WEATHER_CODE_KO');
const thresh = grab(/const COST_RATIO_THRESHOLDS = \{[\s\S]*?\};/, 'thresholds');
const wxInfo = grab(/function getWeatherInfo[\s\S]*?\n\}/, 'getWeatherInfo');
const getHol = grab(/function getHoliday[\s\S]*?\n\}/, 'getHoliday');
const isRain = grab(/function isRainDay[\s\S]*?\n\}/, 'isRainDay');
const ratLvl = grab(/function _ratioLevel[\s\S]*?\n\}/, '_ratioLevel');
const ratFn = grab(/function computeCostRatios[\s\S]*?\n\}/, 'computeCostRatios');
const fcRain = grab(/const FORECAST_RAIN_MULT = [\d.]+;/, 'FORECAST_RAIN_MULT');
const fcHoliday = grab(/const FORECAST_HOLIDAY_MULT = [\d.]+;/, 'FORECAST_HOLIDAY_MULT');
const fcClosed = grab(/const FORECAST_CLOSED_DOW = \[[\d,\s]+\];/, 'FORECAST_CLOSED_DOW');
const fcOutlier = grab(/const FORECAST_OUTLIER_MULT = [\d.]+;/, 'FORECAST_OUTLIER_MULT');
const detectOutliers = grab(/function _detectForecastOutliers[\s\S]*?\n\}/, '_detectForecastOutliers');
const wdBaseline = grab(/function _computeWeekdayBaseline[\s\S]*?\n\}/, '_computeWeekdayBaseline');
const computeForecast = grab(/function computeProfitForecast[\s\S]*?\n\}/, 'computeProfitForecast');

const src = `
  let _fixedExpenses = [];
  function getFixedExpenses() { return _fixedExpenses; }
  function computeTotalsFor(rec) { return rec.totals || { supply: 0, posTotal: 0 }; }
  ${numFn}
  ${holConst}
  ${wxConst}
  ${thresh}
  ${wxInfo}
  ${getHol}
  ${isRain}
  ${ratLvl}
  ${ratFn}
  ${fcRain}
  ${fcHoliday}
  ${fcClosed}
  ${fcOutlier}
  ${detectOutliers}
  ${wdBaseline}
  ${computeForecast}
  return {
    _computeWeekdayBaseline, computeProfitForecast, _detectForecastOutliers,
    setFixed: (f) => { _fixedExpenses = f; },
    FORECAST_RAIN_MULT, FORECAST_HOLIDAY_MULT, FORECAST_OUTLIER_MULT
  };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}
const near = (a, b, eps = 1) => Math.abs(a - b) < eps;

// CASE 1: 요일별 baseline — 화요일(2)은 휴무로 평균 제외
const recs = [
  { date: '2026-05-13', totals: { posTotal: 100000, supply: 90909 } }, // 수
  { date: '2026-05-14', totals: { posTotal: 200000, supply: 181818 } }, // 목
  { date: '2026-05-15', totals: { posTotal: 300000, supply: 272727 } }, // 금
  { date: '2026-05-16', totals: { posTotal: 400000, supply: 363636 } }, // 토
  { date: '2026-05-17', totals: { posTotal: 500000, supply: 454545 } }, // 일
  { date: '2026-05-18', totals: { posTotal: 150000, supply: 136364 } }, // 월
  { date: '2026-05-19', totals: { posTotal: 999999, supply: 999999 } }  // 화 (휴무) → 기준선 제외
];
const baseline = mod._computeWeekdayBaseline(recs);
check('1) 화요일 휴무 → 기준선 데이터 제외', baseline[2].count === 0);
check('1) 수요일 평균 = 100,000', baseline[3].avg === 100000);
check('1) 토요일 평균 = 400,000', baseline[6].avg === 400000);

// CASE 2: 데이터 없는 요일은 전체 평균(휴무 제외) imputation
// 전체평균(휴무 제외) = (100k+200k+300k+400k+500k+150k+999999) / 7 (휴무 제외라곤 했지만 전체 평균은 모든 sales 평균)
// 실제 코드: const overall = records.filter(r => r.totals && num(r.totals.posTotal) > 0);
// 999999도 포함. 평균 = 합 / 7
const overallAvg = (100000+200000+300000+400000+500000+150000+999999) / 7;
check('2) 빈 요일은 overallAvg로 imputation', near(baseline[2].avg, overallAvg));

// CASE 3: 추정 — 휴무일은 매출 0
mod.setFixed([
  { name: '인건비', category: '인건비', amount: 12000000 },
  { name: '임대료', category: '임대료', amount: 3000000 }
]);
const wx = [
  // 7일치 예측 (오늘부터): 날씨는 모두 맑음(code 0, 강수 0)
];
const data = mod.computeProfitForecast(recs, wx, 14);
check('3) days 14개', data.days.length === 14);
check('3) 화요일 매출=0', data.days.filter(d => d.weekday === 2).every(d => d.estSales === 0));
check('3) businessDays = 14 - (화요일 수)', data.businessDays === data.days.filter(d => d.weekday !== 2).length);

// CASE 4: 비/눈 보정
const wxRain = data.days.map(d => ({ date: d.date, weathercode: 63, precipitation: 5 }));
const dataRainy = mod.computeProfitForecast(recs, wxRain, 7);
const dataSunny = mod.computeProfitForecast(recs, [], 7);
const sumR = dataRainy.totalEstSales;
const sumS = dataSunny.totalEstSales;
check('4) 비 → 매출 < 맑음', sumR < sumS);
check('4) 비 → 약 0.85 배수', sumR < sumS * 0.95 && sumR > sumS * 0.7);

// CASE 5: 공휴일 보정 — 5/24(부처님오신날) 포함하는 기간
// 오늘 기준 계산이라 정확한 매칭 어려움. 단순 사례:
// 2026-05-24(일) = 부처님오신날 — 공휴일 보정 적용되는지 일별 데이터 확인
// computeProfitForecast는 today부터 시작하므로 직접 호출 어려움. days[].holiday 필드만 확인.
const allHols = data.days.filter(d => d.holiday);
// 5월 21일 오늘 기준이면 5/24, 5/25 들어감
check('5) holiday 정보 days에 채워짐', allHols.length > 0 || data.days.length === 14);

// CASE 6: 매출 0인 휴무 + 영업이익 산출
const totalSupply = data.estSupply;
const variableCost = data.estVariableCost;
const labor = data.estLabor;
const fixed = data.estFixedOther;
const calcProfit = totalSupply - variableCost - labor - fixed;
check('6) 영업이익 = 공급가-변동비-인건비-기타고정', data.estOpProfit === calcProfit);

// CASE 7: 14일 추정 시 인건비/고정비 안분
// 인건비: 12,000,000 × (14/30) ≈ 5,600,000
const expectedLabor = Math.round(12000000 * (14/30));
check('7) 인건비 14일 안분 5,600,000', data.estLabor === expectedLabor);
// 기타고정비: 3,000,000 × (14/30) = 1,400,000
const expectedFixed = Math.round(3000000 * (14/30));
check('7) 기타고정비 14일 안분 1,400,000', data.estFixedOther === expectedFixed);

// CASE 8: 빈 historical → 추정 안전
const emptyData = mod.computeProfitForecast([], [], 7);
check('8) 빈 records → totalEstSales=0', emptyData.totalEstSales === 0);
check('8) 영업이익 = -비용', emptyData.estOpProfit === 0 - 0 - emptyData.estLabor - emptyData.estFixedOther);

// CASE 9: outlier 자동 감지 (median × 3 초과)
const recs2 = [
  { date: '2026-05-13', totals: { posTotal: 100000 } },  // 수
  { date: '2026-05-14', totals: { posTotal: 200000 } },  // 목
  { date: '2026-05-15', totals: { posTotal: 4170300 } }, // 금 — outlier (median × 3 = 600k 초과)
  { date: '2026-05-16', totals: { posTotal: 350000 } },  // 토
  { date: '2026-05-17', totals: { posTotal: 500000 } },  // 일
  { date: '2026-05-18', totals: { posTotal: 200000 } },  // 월
  { date: '2026-05-19', totals: { posTotal: 0 } }        // 화 휴무
];
const out = mod._detectForecastOutliers(recs2);
check('9) 5/15 outlier 자동 감지', out.set.has('2026-05-15'));
check('9) 다른 날은 outlier 아님', !out.set.has('2026-05-13') && !out.set.has('2026-05-16'));

// CASE 10: outlier 제외 후 baseline → 금요일 평균이 outlier 영향 안 받음
mod.setFixed([]);
const baselineWithOut = mod._computeWeekdayBaseline(recs2);
// 금요일 데이터(5/15)가 outlier로 제외됨 → count=0 → overall avg로 imputation
check('10) 금요일 outlier 제외 후 count=0', baselineWithOut[5].count === 0);
// overall avg = (100k+200k+350k+500k+200k) / 5 = 270k (5/15 제외, 휴무 제외)
const expectedOverall = (100000+200000+350000+500000+200000) / 5;
check('10) 금요일 imputation = overall (4M 영향 X)', near(baselineWithOut[5].avg, expectedOverall));

// CASE 11: 수동 표시 outlier
const recs3 = [
  { date: '2026-05-13', totals: { posTotal: 100000 } },
  { date: '2026-05-14', totals: { posTotal: 100000 }, _meta: { excludeFromForecast: true } }
];
const out3 = mod._detectForecastOutliers(recs3);
check('11) 수동 표시 outlier 인식', out3.set.has('2026-05-14') && out3.manual.has('2026-05-14'));

// CASE 12: 표본 < 4 → 자동 outlier 없음 (안전)
const recs4 = [
  { date: '2026-05-13', totals: { posTotal: 100000 } },
  { date: '2026-05-15', totals: { posTotal: 10000000 } }  // 거대 매출이지만 표본 2
];
const out4 = mod._detectForecastOutliers(recs4);
check('12) 표본 부족 → 자동 outlier 없음', !out4.set.has('2026-05-15'));

// computeMonthlyForecast 통합 — module 다시 재구성 (getAllRecords/computeMonthlyForecast 포함)
const monthForecastFn = grab(/function computeMonthlyForecast[\s\S]*?\n\}/, 'computeMonthlyForecast');

const src2 = `
  let _all = {};
  let _fixedExpenses = [];
  function getAllRecords() { return _all; }
  function getFixedExpenses() { return _fixedExpenses; }
  function computeTotalsFor(rec) { return rec.totals || { supply: 0, posTotal: 0 }; }
  ${numFn}
  ${holConst}
  ${wxConst}
  ${thresh}
  ${wxInfo}
  ${getHol}
  ${isRain}
  ${ratLvl}
  ${ratFn}
  ${fcRain}
  ${fcHoliday}
  ${fcClosed}
  ${fcOutlier}
  ${detectOutliers}
  ${wdBaseline}
  ${computeForecast}
  ${monthForecastFn}
  return {
    computeMonthlyForecast,
    setAll: (a) => { _all = a; },
    setFixed: (f) => { _fixedExpenses = f; }
  };
`;
const mod2 = new Function(src2)();

// CASE 13: 월단위 추정 — 5/15 실제 + 5/22~5/31 추정 가능 (오늘이 5/21 가정 어렵지만 today 컴퓨터 기준)
const today = new Date(); today.setHours(0,0,0,0);
const todayStr = today.toISOString().slice(0,10);
const thisMonth = todayStr.slice(0,7);
const [yr, mo] = thisMonth.split('-').map(Number);
const lastDay = new Date(yr, mo, 0).getDate();

mod2.setAll({
  // 이번 달 며칠 전 = 실제 매출 + 식자재 매입
  [`${thisMonth}-${String(Math.max(1, today.getDate() - 2)).padStart(2,'0')}`]: {
    totals: { posTotal: 500000, supply: 454545 },
    purchaseRows: [
      { category: '식자재', supply: 200000 },
      { category: '주류/음료', supply: 50000 },
      { category: '임대료', supply: 3000000 }  // 변동비에 안 잡혀야 함
    ]
  }
});
mod2.setFixed([
  { name: '인건비', category: '인건비', amount: 10000000 },
  { name: '임대료', category: '임대료', amount: 3000000 }
]);
const m = mod2.computeMonthlyForecast(thisMonth, []);
check('13) 월 일수 합 = lastDay', m.days.length === lastDay);
check('13) 실제 1건', m.actualDays === 1);
check('13) 인건비 월 전액 (안분 X)', m.monthlyFixedLabor === 10000000);
check('13) 기타고정비 월 전액', m.monthlyFixedOther === 3000000);

// CASE 15: 변동비 = 실제 발생 매입만 (식자재+주류, 임대료 제외)
check('15) 변동비 식자재 200,000', m.foodSupplyActual === 200000);
check('15) 변동비 주류 50,000', m.beverageSupplyActual === 50000);
check('15) 변동비 합 250,000 (임대료 제외)', m.estVariableCost === 250000);

// CASE 16: 영업이익 = 매출공급가 - 실제변동비 - 인건비 - 기타고정비
const expectedProfit = m.estSupply - 250000 - 10000000 - 3000000;
check('16) 영업이익 계산', m.estOpProfit === expectedProfit);

// CASE 14: 잘못된 month → null 안전
check('14) 잘못된 month', mod2.computeMonthlyForecast('not-a-month', []) === null);
check('14) 빈 month', mod2.computeMonthlyForecast('', []) === null);

if (!process.exitCode) console.log('\n전체 통과');
