// 단위 테스트: getHoliday / getDayType / isRainDay / computeWeatherAnalysis
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};

const numFn = grab(/function num\(v\)[\s\S]*?\n\}/, 'num');
const holidaysConst = grab(/const KOREAN_HOLIDAYS = \{[\s\S]*?\n\};/, 'KOREAN_HOLIDAYS');
const codesConst = grab(/const WEATHER_CODE_KO = \{[\s\S]*?\n\};/, 'WEATHER_CODE_KO');
const getInfo = grab(/function getWeatherInfo[\s\S]*?\n\}/, 'getWeatherInfo');
const getHol = grab(/function getHoliday[\s\S]*?\n\}/, 'getHoliday');
const getDt = grab(/function getDayType[\s\S]*?\n\}/, 'getDayType');
const isRain = grab(/function isRainDay[\s\S]*?\n\}/, 'isRainDay');
const compW = grab(/function computeWeatherAnalysis[\s\S]*?\n\}/, 'computeWeatherAnalysis');

const src = `
  ${numFn}
  ${holidaysConst}
  ${codesConst}
  ${getInfo}
  ${getHol}
  ${getDt}
  ${isRain}
  ${compW}
  return { num, getHoliday, getDayType, isRainDay, computeWeatherAnalysis, getWeatherInfo };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// ===== getHoliday / getDayType =====
check('1) 신정 공휴일', mod.getHoliday('2026-01-01') === '신정');
check('1) 어린이날 공휴일', mod.getHoliday('2026-05-05') === '어린이날');
check('1) 대체공휴일 (삼일절)', mod.getHoliday('2026-03-02') === '삼일절 대체공휴일');
check('1) 평일은 null', mod.getHoliday('2026-05-20') === null);

// 2026-05-20 = 수 (평일)
check('2) 수요일 → 평일', mod.getDayType('2026-05-20') === '평일');
// 2026-05-16 = 토
check('2) 토요일 → 주말', mod.getDayType('2026-05-16') === '주말');
// 2026-05-17 = 일
check('2) 일요일 → 주말', mod.getDayType('2026-05-17') === '주말');
// 2026-05-05 = 화 + 어린이날 → 공휴일
check('2) 어린이날 → 공휴일', mod.getDayType('2026-05-05') === '공휴일');
// 2026-03-02 = 월 + 삼일절 대체 → 대체공휴일
check('2) 대체공휴일', mod.getDayType('2026-03-02') === '대체공휴일');
// 빈 값
check('2) 빈 날짜 → 평일', mod.getDayType('') === '평일');
check('2) 잘못된 날짜 → 평일', mod.getDayType('not-a-date') === '평일');

// ===== isRainDay =====
check('3) weathercode 63 (비) → true', mod.isRainDay({ weathercode: 63, precipitation: 5 }) === true);
check('3) weathercode 0 (맑음) + 강수 0 → false', mod.isRainDay({ weathercode: 0, precipitation: 0 }) === false);
check('3) weathercode 0 + 강수 2mm → true (1mm 임계)', mod.isRainDay({ weathercode: 0, precipitation: 2 }) === true);
check('3) weathercode 0 + 강수 0.5mm → false', mod.isRainDay({ weathercode: 0, precipitation: 0.5 }) === false);
check('3) null → false', mod.isRainDay(null) === false);

// ===== getWeatherInfo =====
check('4) code 0 = 맑음', mod.getWeatherInfo(0).label === '맑음');
check('4) code 65 = severe', mod.getWeatherInfo(65).severe === true);
check('4) unknown code 안전', mod.getWeatherInfo(999).label === '?');

// ===== computeWeatherAnalysis =====
// 시나리오: 평일3 + 주말2 + 공휴일1, 일부에 weather
const recs = [
  { date: '2026-05-13', totals: { posTotal: 100000 }, weather: { weathercode: 0, precipitation: 0, temp_avg: 18 } }, // 수 맑음 쾌적
  { date: '2026-05-14', totals: { posTotal: 110000 }, weather: { weathercode: 0, precipitation: 0, temp_avg: 20 } }, // 목 맑음 쾌적
  { date: '2026-05-15', totals: { posTotal: 130000 }, weather: { weathercode: 63, precipitation: 8, temp_avg: 17 } }, // 금 비 쾌적
  { date: '2026-05-16', totals: { posTotal: 200000 }, weather: { weathercode: 0, precipitation: 0, temp_avg: 22 } }, // 토 맑음
  { date: '2026-05-17', totals: { posTotal: 220000 }, weather: { weathercode: 0, precipitation: 0, temp_avg: 23 } }, // 일 맑음
  { date: '2026-05-05', totals: { posTotal: 50000 }, weather: { weathercode: 82, precipitation: 30, temp_avg: 16 } }  // 공휴일 폭우
];
const a = mod.computeWeatherAnalysis(recs);
const find = (arr, k) => arr.find(x => x.label === k);
// 5/13(수)·5/14(목)·5/15(금) = 평일 3 · 5/16(토)·5/17(일) = 주말 2 · 5/5(화 어린이날) = 공휴일 1
check('5) 평일 3건', find(a.byDayType, '평일').count === 3);
check('5) 주말 2건', find(a.byDayType, '주말').count === 2);
check('5) 공휴일 1건', find(a.byDayType, '공휴일').count === 1);

// 비/맑음 (5/15 weathercode 63=비, 5/5 weathercode 82=폭우)
check('6) 맑음 4건', find(a.byRain, '맑음/흐림').count === 4);
check('6) 비 2건 (15+05)', find(a.byRain, '비/눈').count === 2);

// 온도: temp_avg 16,17,18,20,22,23 → 모두 15~25 쾌적
check('7) 쾌적 6건 (16~23)', find(a.byTemp, '쾌적(15~25°)').count === 6);

// severe (폭우 5/5)
check('8) severe 1건 (폭우 5/5)', a.severeDays.length === 1);

// hasWeather
check('9) hasWeatherCount=6 totalCount=6', a.hasWeatherCount === 6 && a.totalCount === 6);

// weather 없는 record
const recs2 = [{ date: '2026-05-13', totals: { posTotal: 100000 } }];
const a2 = mod.computeWeatherAnalysis(recs2);
check('10) weather 없으면 byRain·byTemp 빈배열', a2.byRain.length === 0 && a2.byTemp.length === 0);
check('10) byDayType은 그래도 있음', a2.byDayType.length === 1);

if (!process.exitCode) console.log('\n전체 통과');
