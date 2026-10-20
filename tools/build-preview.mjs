// 미리보기용 단일 HTML 만들기: 랜딩 + 앱(데모 모드) + 사진 + 스크립트를 한 파일로 묶습니다.
// 사용: node tools/build-preview.mjs [출력경로]   (기본: preview/trade-checker-preview.html)
// 결과 파일은 서버 없이 더블클릭으로 열립니다. 로그인·결제는 빠지고 샘플 데이터로 모든 화면을 체험할 수 있습니다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'preview', 'trade-checker-preview.html');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// ---------- 1. 자바스크립트 모듈 묶기 ----------
// [모듈 이름, 실제 파일] — 실데이터 모드는 서버 캐시 대신 브라우저 캐시를 씁니다.
const MODULES = [
  '/lib/products.js', '/lib/countries.js', '/lib/engine.js', '/lib/providers/sample-gen.js', '/lib/providers/sample.js',
  '/lib/sources/http.js', '/lib/sources/gleif.js', '/lib/sources/rdap.js', '/lib/sources/opensanctions.js', '/lib/sources/creditsafe.js', '/lib/sources/importgenius.js',
  ['/lib/server/cache.js', '/lib/browser/cache.js'], '/lib/providers/live.js',
  '/assets/js/client.js', '/assets/js/landing.js', '/assets/js/app.js',
].map((m) => (Array.isArray(m) ? m : [m, m]));

function transform(file, code) {
  const exportsList = [];
  const abs = (from) => (from.startsWith('.') ? path.posix.resolve(path.posix.dirname(file), from) : from);
  code = code.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';?$/gm, (_, name, from) => `const ${name} = __mods[${JSON.stringify(abs(from))}];`);
  code = code.replace(/^import\s+\{([^}]+)\}\s+from\s+'([^']+)';?$/gm, (_, names, from) => `const {${names.replace(/\s+as\s+/g, ': ')}} = __mods[${JSON.stringify(abs(from))}];`);
  if (/^import\s/m.test(code)) throw new Error('처리하지 못한 import: ' + file);
  code = code.replace(/^export\s+(async\s+function|function|const|let|class)\s+(\w+)/gm, (_, kind, name) => { exportsList.push(name); return `${kind} ${name}`; });
  if (/^export\s/m.test(code)) throw new Error('처리하지 못한 export: ' + file);
  return `__mods[${JSON.stringify(file)}] = (() => {\n${code}\nreturn { ${exportsList.join(', ')} };\n})();`;
}

const bundle = ['const __mods = {};', 'globalThis.process = globalThis.process || { env: {} }; var process = globalThis.process;', ...MODULES.flatMap(([name, file]) => [transform(name, read(file.slice(1))), ...(name === '/lib/providers/live.js' ? ["window.TC_LIVE = __mods['/lib/providers/live.js'];"] : [])])].join('\n\n').replace(/<\/script/gi, '<\\/script');

// ---------- 2. 사진을 파일 안에 넣기 ----------
const imgCache = {};
function dataUri(p) {
  if (!imgCache[p]) {
    const buf = readFileSync(path.join(root, p.replace(/^\//, '')));
    const type = p.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
    imgCache[p] = `data:${type};base64,${buf.toString('base64')}`;
  }
  return imgCache[p];
}
const inlineAssets = (html) => html.replace(/\/assets\/(img\/[\w.-]+\.jpg|favicon\.svg)/g, (m) => dataUri(m));

// ---------- 3. 랜딩 페이지 ----------
const landingSrc = read('index.html');
const landingHead = landingSrc.match(/<head>([\s\S]*?)<\/head>/)[1];
let landingBody = landingSrc.match(/<body>([\s\S]*?)<\/body>/)[1];
landingBody = landingBody
  .replace(/<script type="module" src="\/assets\/js\/landing\.js"><\/script>/, '')
  .replace(/href="\/app\/#\//g, 'href="#/')
  .replace(/href="\/app\/"/g, 'href="#/search"')
  .replace(/href="\/login\.html[^"]*"/g, 'href="#/search"')
  .replace(/href="mailto:[^"]*"/g, 'href="#faq"')
  .replace(/href="\/(terms|privacy)\.html"/g, 'href="#faq" title="배포 후 열리는 페이지입니다"');
const headStyles = (landingHead.match(/<link[^>]+fonts\.googleapis[^>]*>/g) || []).join('\n') + '\n' + (landingHead.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');

// ---------- 4. 앱 화면 ----------
const appSrc = read('app/index.html');
let appBody = appSrc.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script type="module" src="\/assets\/js\/app\.js"><\/script>/, '');
appBody = appBody.replace('<div class="shell" id="appShell">', '<div class="shell" id="appShell" hidden>').replace(/href="\/"/g, 'href="#top"');
appBody = appBody.replace('<b>데모 모드</b> · 샘플 데이터로 체험 중입니다. 조회 기록은 이 브라우저에만 저장됩니다.', '<b>미리보기</b> · 회원가입·결제는 배포 후 동작합니다. 조회 화면에서 샘플 데이터와 실데이터를 바꿔 볼 수 있습니다. <a href="#top" style="color:#fff">← 소개 페이지</a>');
// 앱 CSS의 전역 규칙이 같은 파일 안의 랜딩 페이지에 영향을 주지 않도록 앱 화면 범위로 좁힙니다.
// :where() 는 우선순위를 높이지 않으므로 .btn 같은 클래스 규칙은 그대로 이깁니다.
const SCOPE = [
  ['* { box-sizing: border-box; }', ':where(#appShell), :where(#appShell) *, .toast { box-sizing: border-box; }'],
  ["body { margin: 0; background: var(--bg); color: var(--ink); font-family: 'IBM Plex Sans KR', system-ui, sans-serif; word-break: keep-all; line-height: 1.5; }",
   "body { margin: 0; }\n#appShell, .toast { background: var(--bg); color: var(--ink); font-family: 'IBM Plex Sans KR', system-ui, sans-serif; word-break: keep-all; line-height: 1.5; }\n.toast { background: var(--ink); color: #fff; }"],
  ['a { color: var(--accent); }', ':where(#appShell) a { color: var(--accent); }'],
  ['a:hover { color: var(--accent-ink); }', ':where(#appShell) a:hover { color: var(--accent-ink); }'],
  ['button, input, select { font: inherit; }', ':where(#appShell) :is(button, input, select) { font: inherit; }'],
  ['h1, h2, h3 { letter-spacing: -0.03em; line-height: 1.3; margin: 0; }', ':where(#appShell) :is(h1, h2, h3) { letter-spacing: -0.03em; line-height: 1.3; margin: 0; }'],
];
let appCss = read('assets/css/app.css');
for (const [from, to] of SCOPE) {
  if (!appCss.includes(from)) throw new Error('앱 CSS 범위 지정 실패: ' + from);
  appCss = appCss.replace(from, to);
}

// ---------- 5. 합치기 ----------
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trade Checker — 미리보기</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
${headStyles}
<style>
${appCss}
</style>
<style>html{scroll-behavior:smooth}body{overflow-x:hidden}#landing[hidden],#appShell[hidden]{display:none!important}</style>
</head>
<body>
<div id="landing">
${landingBody}
</div>
${appBody}
<script>window.TC_PREVIEW = true;</script>
<script type="module">
${bundle}
</script>
</body>
</html>
`;

const final = inlineAssets(html);
const dupIds = [...final.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
if (dupIds.length) throw new Error('중복 id: ' + [...new Set(dupIds)].join(', '));
// 실서비스 전용 경로('/api/…', '/login.html' 등)는 미리보기에서는 실행되지 않는 코드에만 남습니다.
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, final);
console.log(`미리보기 생성: ${out} (${Math.round(final.length / 1024)} KB)`);
