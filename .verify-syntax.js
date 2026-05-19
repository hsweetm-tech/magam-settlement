// Phase 1-A 검증 스크립트 (ONBOARDING.md 6장 1번 절차)
// 일일정산.html의 인라인 <script>를 추출해 new Function으로 문법 검사.
const fs = require('fs');
const path = require('path');
const htmlPath = path.join(__dirname, '일일정산.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// 인라인 <script> 추출: src 속성 없는 빈 <script>...</script> 블록만
const re = /<script>([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(html)) !== null) {
  blocks.push({ idx: m.index, code: m[1] });
}

if (blocks.length === 0) {
  console.error('FAIL: 인라인 <script> 블록을 찾지 못했습니다.');
  process.exit(2);
}

let allOk = true;
blocks.forEach((b, i) => {
  try {
    new Function(b.code);
    console.log(`Block ${i} @${b.idx}: SYNTAX_OK (${b.code.length} chars)`);
  } catch (e) {
    allOk = false;
    console.error(`Block ${i} @${b.idx}: SYNTAX_ERROR — ${e.message}`);
  }
});

process.exit(allOk ? 0 : 1);
