// 실데이터 공급자(live) 통합 테스트
// 실제 API와 같은 응답 형식을 돌려주는 가짜 서버를 띄워, 연결·합치기·등급 산정·캐시·장애 대응을 확인합니다.
// GLEIF·RDAP·OpenSanctions 응답 형식은 공개 문서·실제 응답으로 확인한 구조입니다.
// Creditsafe 리포트 형식은 계약 전이라 lib/sources/creditsafe.js 의 FIELD_PATHS 가정을 따릅니다.
//   실행: node tests/live-sources.test.mjs
import assert from 'node:assert/strict';

const NOW = new Date('2026-10-19T00:00:00Z');
import { server, hits, state } from './mock-data-sources.mjs';

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
Object.assign(process.env, {
  GLEIF_API_BASE: `${base}/gleif`, RDAP_BASE: `${base}/rdap`, OPENSANCTIONS_API_BASE: `${base}/os`, OPENSANCTIONS_API_KEY: 'test-os-key',
});
delete process.env.SUPABASE_URL; // 캐시는 메모리 모드

const live = await import('../lib/providers/live.js');
const { buildReport } = await import('../lib/engine.js');
const report = async (id) => buildReport(await live.getProfile(id, { now: NOW }), { now: NOW, providerLabel: live.PROVIDER_LABEL });

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

console.log('실데이터 공급자 테스트');

await test('입력 해석: 국가 접미사 · 이메일 · LEI', () => {
  assert.deepEqual(live.parseQuery('Acme Global, UAE'), { name: 'Acme Global', domain: null, lei: null, countryCode: 'AE' });
  assert.equal(live.parseQuery('buyer@acmeglobal.ae').domain, 'acmeglobal.ae');
  assert.equal(live.parseQuery('https://www.acmeglobal.ae/about').domain, 'acmeglobal.ae');
  assert.equal(live.parseQuery('ACME00000000000000A1').lei, 'ACME00000000000000A1');
  assert.equal(live.parseQuery('Acme', '독일').countryCode, 'DE');
});

await test('회사명 검색 → 등록부 후보(활성 우선) + "등기 없이 조회" 후보', async () => {
  const c = await live.searchCompanies('acme global');
  assert.equal(c.length, 3);
  assert.match(c[0].id, /^lei:ACME00000000000000A1/);
  assert.match(c[0].industry, /활성 법인/);
  assert.match(c[1].industry, /비활성/);
  assert.match(c[2].id, /^q:/);
});

await test('국가 필터: 독일로 고르면 UAE 법인은 빠짐', async () => {
  const c = await live.searchCompanies('acme global', { country: 'DE' });
  assert.equal(c.length, 1);
  assert.match(c[0].id, /^q:/);
});

await test('활성 법인 + 오래된 도메인 + 제재 없음 → 신용·통관 미연결이라 등급 상한 C', async () => {
  const r = await report('lei:ACME00000000000000A1~d=acmeglobal.ae');
  assert.equal(r.company.founded, 2011);
  assert.equal(r.coverage.covered, 2);
  assert.deepEqual(r.capped, { from: 'B', to: 'C' });
  assert.equal(r.grade, 'C');
  const sig = Object.fromEntries(r.signals.map((s) => [s.key, s]));
  assert.equal(sig['domain-age'].level, 'ok');
  assert.equal(sig.domain.value, '일치');
  assert.equal(sig.sanctions.value, '일치 없음');
  assert.ok(r.guide.alternatives.some((a) => a.includes('K-SURE')));
  assert.equal(r.sources.find((s) => s.name.startsWith('신용평가')).state, 'off');
});

await test('일치도 낮은 명단 결과(match:false)는 무시', async () => {
  const p = await live.getProfile('lei:ACME00000000000000A1', { now: NOW });
  assert.deepEqual(p.sanctions, []);
});

await test('비활성 법인 → 위험 신호 +25', async () => {
  const r = await report('lei:ACME00000000000000B2');
  const s = r.signals.find((x) => x.key === 'registry');
  assert.equal(s.level, 'danger');
  assert.equal(s.points, 25);
});

await test('2개월 된 도메인 → 위험 신호 +15', async () => {
  const r = await report('lei:ACME00000000000000A1~d=acme-global-trading.com');
  const s = r.signals.find((x) => x.key === 'domain-age');
  assert.equal(s.level, 'danger');
  assert.equal(s.points, 15);
});

await test('제재 명단 일치 → 점수와 상관없이 F + 근거 링크', async () => {
  const r = await report('lei:ROGUE0000000000000C3');
  assert.equal(r.grade, 'F');
  const s = r.signals.find((x) => x.key === 'sanctions');
  assert.equal(s.level, 'danger');
  assert.match(s.link, /^https:\/\/www\.opensanctions\.org\/entities\/NK-rogue/);
});

await test('사기 관련 명단 일치 → 사기 신고로 반영(+15)', async () => {
  const c = await live.searchCompanies('Shady Imports');
  const r = await report(c[c.length - 1].id);
  assert.ok(r.signals.find((x) => x.key === 'fraud' && x.points === 15));
});

await test('무료 메일로 조회 → 등록부 후보 없이 바로 조회, 무료 메일 경고', async () => {
  const c = await live.searchCompanies('buyer.kim@gmail.com');
  assert.equal(c.length, 1);
  const r = await report(c[0].id);
  const s = r.signals.find((x) => x.key === 'domain-age');
  assert.equal(s.level, 'warn');
  assert.match(s.value, /무료 메일/);
  assert.ok(['C', 'D', 'F'].includes(r.grade));
});

await test('Creditsafe 연결 → 신용점수·법적 기록 반영, 충실도 5/6 (상한 B)', async () => {
  Object.assign(process.env, { CREDITSAFE_API_BASE: `${base}/cs`, CREDITSAFE_USERNAME: 'u', CREDITSAFE_PASSWORD: 'p' });
  const c = await live.searchCompanies('Creditworthy Machinery', { country: 'DE' });
  assert.match(c[0].id, /^cs:DE-X-1/);
  assert.match(c[0].id, /lei=CREDIT000000000000D4/);
  const r = await report(c[0].id);
  assert.equal(r.credit.score, 82);
  assert.equal(r.coverage.covered, 5);
  assert.ok(r.signals.find((x) => x.key === 'courts-open' && x.points === 6));
  assert.ok(['A', 'B'].includes(r.grade) && r.grade === 'B');
  for (const k of ['CREDITSAFE_API_BASE', 'CREDITSAFE_USERNAME', 'CREDITSAFE_PASSWORD']) delete process.env[k];
});

await test('캐시: 같은 회사를 다시 조회하면 외부 API를 다시 부르지 않음', async () => {
  const before = { ...hits };
  await report('lei:ACME00000000000000A1~d=acmeglobal.ae');
  assert.equal(hits.gleif, before.gleif);
  assert.equal(hits.rdap, before.rdap);
  assert.equal(hits.sanctions, before.sanctions);
});

await test('등록부 장애 → 검색은 "등기 없이 조회"로 계속, 리포트에 실패 표시', async () => {
  state.gleifDown = true;
  const c = await live.searchCompanies('Totally New Buyer');
  assert.equal(c.length, 1);
  assert.match(c[0].id, /^q:/);
  const p = await live.getProfile('lei:ACME00000000000000B2~d=nothing.ae', { now: NOW }).catch((e) => e);
  assert.ok(p === null || p.company, '장애 시 오류로 멈추지 않음');
  state.gleifDown = false;
});

await test('제재 명단 키가 없으면 "확인 안 함"으로 표시하고 "사기 이력 없음"이라 단정하지 않음', async () => {
  delete process.env.OPENSANCTIONS_API_KEY;
  const r = await report(live.searchCompanies ? (await live.searchCompanies('Unlisted Buyer Co'))[0].id : '');
  assert.equal(r.signals.find((x) => x.key === 'sanctions').value, '확인 안 함');
  assert.equal(r.signals.find((x) => x.key === 'fraud'), undefined);
  assert.equal(r.coverage.covered, 0);
  assert.equal(r.grade, 'C');
  process.env.OPENSANCTIONS_API_KEY = 'test-os-key';
});

await test('리뷰 반영: 다른 회사를 같은 회사로 합치지 않음 (엄격 비교)', () => {
  assert.notEqual(live.strictName('Sun Trading LLC'), live.strictName('Sun Holdings Ltd'));
  assert.equal(live.strictName('ACME GLOBAL TRADING L.L.C'), live.strictName('Acme Global Trading LLC'));
});

await test('리뷰 반영: 웹사이트 경로(/de)를 국가로 읽지 않음', () => {
  const p = live.parseQuery('https://example.com/de');
  assert.equal(p.domain, 'example.com'); assert.equal(p.countryCode, null);
});

await test('리뷰 반영: 조작된 id는 오류 없이 null', async () => {
  for (const bad of ['lei:ACME00000000000000A1~n=%E0%A4%A', 'q:%7B%22d%22%3A12345%7D', 'q:' + encodeURIComponent('{"n":"x y","c":{"x":1}}'), 'cs:../../etc', 'lei:short', 'q:' + encodeURIComponent('{"n":"   "}'), 'x'.repeat(2000)]) {
    const p = await live.getProfile(bad, { now: NOW }).catch((e) => 'THROW ' + e.message);
    assert.ok(p === null || (p && p.company.countryCode === ''), bad + ' → ' + JSON.stringify(p)?.slice(0, 80));
  }
});

await test('리뷰 반영: 등록되지 않은 .com 도메인 → 위험 신호, 국가 도메인은 확인 불가로만 표시', async () => {
  const r1 = await report('q:' + encodeURIComponent(JSON.stringify({ n: 'Ghost Buyer', d: 'ghost-buyer-xyz.com' })));
  const s1 = r1.signals.find((x) => x.key === 'domain-age');
  assert.equal(s1.level, 'danger'); assert.equal(s1.points, 20);
  const r2 = await report('q:' + encodeURIComponent(JSON.stringify({ n: 'Some Buyer', d: 'somebuyer.ae' })));
  assert.equal(r2.signals.find((x) => x.key === 'domain-age').level, 'info');
});

await test('리뷰 반영: allowPaid=false 이면 유료 출처(제재 명단)를 부르지 않음', async () => {
  const before = hits.sanctions || 0;
  const p = await live.getProfile('q:' + encodeURIComponent(JSON.stringify({ n: 'Rogue Arms Export' })), { now: NOW, allowPaid: false });
  assert.equal(hits.sanctions || 0, before);
  assert.equal(p.sanctions, null);
});

await test('후보 순서: 입력한 이름과 같은 법인이 맨 앞', async () => {
  const c = await live.searchCompanies('acme global trading fze');
  assert.match(c[0].name, /FZE/);
  const c2 = await live.searchCompanies('acme global trading llc');
  assert.match(c2[0].name, /L\.L\.C/);
});

await test('업종은 회사명으로 추정해 "추정"이라고 표시', async () => {
  const p = await live.getProfile('lei:CREDIT000000000000D4', { now: NOW, allowPaid: false });
  assert.match(p.company.industry, /기계·설비.*추정/);
});

await test('잘못된 id는 null', async () => {
  assert.equal(await live.getProfile('xx:1'), null);
  assert.equal(await live.getProfile('q:%%%'), null);
});

console.log(`\n${passed}개 통과`);
server.close();
