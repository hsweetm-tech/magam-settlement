// 단위 테스트: 백업 페이로드 round-trip (collect → JSON → apply)
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '일일정산.html'), 'utf8');

const grab = (re, name) => {
  const m = html.match(re);
  if (!m) { console.error('FAIL: ' + name + ' 추출 실패'); process.exit(2); }
  return m[0];
};
const collect = grab(/function collectAppSettings\(\)[\s\S]*?\n\}/, 'collectAppSettings');
const apply = grab(/function applyAppSettings\(s\)[\s\S]*?\n\}/, 'applyAppSettings');

// localStorage 폴리필 (memory-backed)
const src = `
  const store = {};
  const localStorage = {
    setItem(k, v) { store[k] = String(v); },
    getItem(k) { return store[k] == null ? null : store[k]; },
    removeItem(k) { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i]; }
  };
  const PARTNERS_KEY = 'partner_ratios';
  const DIST_DISCOUNT_KEY = 'dist_subtract_discounts';
  const PG_KEY_PREFIX = 'pg_settle_';
  // UI re-render 호출은 no-op (테스트 환경)
  function renderPartners() {}
  function updateHometaxStatus() {}
  function updatePgStatus() {}
  function refreshMonthlyDistribution() {}
  const document = { getElementById: () => null };
  ${collect}
  ${apply}
  return {
    collectAppSettings, applyAppSettings,
    setStore: (key, val) => { localStorage.setItem(key, val); },
    getStore: (key) => localStorage.getItem(key),
    listKeys: () => { const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); return ks; },
    clearStore: () => { for (const k of Object.keys(store)) delete store[k]; }
  };
`;
const mod = new Function(src)();

function check(label, cond, info) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (info ? ' — ' + info : ''));
  if (!cond) process.exitCode = 1;
}

// CASE 1: 빈 상태 collect
let s = mod.collectAppSettings();
check('1) 빈 partners=null', s.partners === null);
check('1) 빈 distSubtract=false', s.distSubtractDiscounts === false);
check('1) 빈 hometax={}', Object.keys(s.hometax).length === 0);
check('1) 빈 pgSettle={}', Object.keys(s.pgSettle).length === 0);

// CASE 2: 모든 데이터 채워서 collect
mod.setStore('partner_ratios', JSON.stringify([{ name: 'A', ratio: 50 }, { name: 'B', ratio: 50 }]));
mod.setStore('dist_subtract_discounts', 'true');
mod.setStore('hometax_2026-05', JSON.stringify([{ date: '2026-05-10', total: 100000 }]));
mod.setStore('hometax_2026-04', JSON.stringify([{ date: '2026-04-12', total: 50000 }]));
mod.setStore('pg_settle_2026-05', JSON.stringify([{ payoutDate: '2026-05-13', net: 166029 }]));
// 다른 키 (백업에서 제외돼야 함)
mod.setStore('dailySettlement_v1', JSON.stringify({}));
mod.setStore('cloud_settings', JSON.stringify({}));

s = mod.collectAppSettings();
check('2) partners 길이=2', s.partners.length === 2);
check('2) partners[0].name=A', s.partners[0].name === 'A');
check('2) distSubtract=true', s.distSubtractDiscounts === true);
check('2) hometax 2개월', Object.keys(s.hometax).length === 2);
check('2) hometax 2026-05', Array.isArray(s.hometax['2026-05']) && s.hometax['2026-05'].length === 1);
check('2) hometax 2026-04 합계', s.hometax['2026-04'][0].total === 50000);
check('2) pgSettle 2026-05', Array.isArray(s.pgSettle['2026-05']) && s.pgSettle['2026-05'][0].net === 166029);

// CASE 3: round-trip → 다른 PC 시뮬레이션 (clear + apply)
const payloadJson = JSON.stringify(s);
mod.clearStore();
check('3) 클리어 직후 키 없음', mod.listKeys().length === 0);
mod.applyAppSettings(JSON.parse(payloadJson));
check('3) partners 복원', mod.getStore('partner_ratios') !== null);
check('3) partners 내용', JSON.parse(mod.getStore('partner_ratios'))[0].ratio === 50);
check('3) distSubtract 복원', mod.getStore('dist_subtract_discounts') === 'true');
check('3) hometax_2026-05 복원', mod.getStore('hometax_2026-05') !== null);
check('3) hometax_2026-04 복원', mod.getStore('hometax_2026-04') !== null);
check('3) pg_settle_2026-05 복원', mod.getStore('pg_settle_2026-05') !== null);
check('3) pg_settle 내용', JSON.parse(mod.getStore('pg_settle_2026-05'))[0].net === 166029);

// CASE 4: null/undefined settings는 안전하게 무시
mod.applyAppSettings(null);
mod.applyAppSettings(undefined);
mod.applyAppSettings('not-an-object');
check('4) 잘못된 입력 → 에러 없이 통과', true);

// CASE 5: 부분 데이터 (partners만)
mod.clearStore();
mod.applyAppSettings({ partners: [{ name: 'X', ratio: 100 }] });
check('5) partners만 적용', JSON.parse(mod.getStore('partner_ratios'))[0].name === 'X');
check('5) distSubtract 기본', mod.getStore('dist_subtract_discounts') == null || mod.getStore('dist_subtract_discounts') === 'false');

// CASE 6: 잘못된 partners 타입(Array가 아닌) → 무시
mod.clearStore();
mod.applyAppSettings({ partners: 'not-array', distSubtractDiscounts: true });
check('6) 잘못된 partners 무시', mod.getStore('partner_ratios') == null);
check('6) distSubtract만 적용', mod.getStore('dist_subtract_discounts') === 'true');

// CASE 7: 잘못된 hometax 항목 무시
mod.clearStore();
mod.applyAppSettings({ hometax: { '2026-05': [{ total: 1 }], '2026-06': 'not-array', '2026-07': null } });
check('7) 유효한 hometax만 적용', mod.getStore('hometax_2026-05') !== null);
check('7) 잘못된 hometax 스킵', mod.getStore('hometax_2026-06') == null && mod.getStore('hometax_2026-07') == null);

if (!process.exitCode) console.log('\n전체 통과');
