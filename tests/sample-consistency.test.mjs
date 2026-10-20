// 샘플 데이터 일관성 점검: 회사명·국가·도시·도메인·업종·품목·거래국·법원이 서로 맞는지 수백 건을 돌려 확인합니다.
//   실행: node tests/sample-consistency.test.mjs
import assert from 'node:assert/strict';
import * as s from '../lib/providers/sample.js';
import { COUNTRY_INFO, INDUSTRY_INFO, KNOWN } from '../lib/providers/sample-gen.js';
import { buildReport } from '../lib/engine.js';

let passed = 0, checked = 0;
const fails = [];
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { fails.push(name); console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };
const KO2CC = Object.fromEntries(Object.entries(COUNTRY_INFO).map(([k, v]) => [v.ko, k]));
const ALL_PRODUCTS = new Set(Object.values(INDUSTRY_INFO).flatMap((i) => i.products));

function checkGenerated(q, p, { country } = {}) {
  const c = p.company;
  const cc = KO2CC[c.country];
  const info = COUNTRY_INFO[cc];
  const where = `[${q}] ${c.name} / ${c.country} / ${c.city} / ${c.domain}`;
  assert.ok(info, where + ' 국가 정보 없음');
  if (country) assert.equal(cc, country, where + ' 선택한 국가와 다름');
  const knownCity = Object.values(KNOWN).some((k) => k.city === c.city);
  assert.ok(info.cities.includes(c.city) || knownCity, where + ' 도시가 국가와 맞지 않음');
  if (c.domain && info.tld && !/@/.test(q) && !/\./.test(q) && !Object.values(KNOWN).some((k) => k.domain === c.domain)) assert.ok(c.domain.endsWith('.' + info.tld), where + ' 도메인 끝이 국가와 맞지 않음');
  for (const pr of p.customs.topProducts) assert.ok(ALL_PRODUCTS.has(pr), where + ' 알 수 없는 품목 ' + pr);
  const ind = Object.values(INDUSTRY_INFO).find((i) => p.customs.topProducts.every((x) => i.products.includes(x)));
  if (p.customs.topProducts.length) assert.ok(ind, where + ' 품목이 한 업종에 속하지 않음');
  assert.ok(!p.customs.partnerCountries.includes(c.country), where + ' 거래국에 자기 나라');
  if (p.customs.partnerCountries.length && cc !== 'KR') assert.equal(p.customs.partnerCountries[0], '대한민국');
  for (const ct of p.courts) assert.ok(cc === 'XX' || ct.court.includes(c.city) || !info.court.includes('{city}'), where + ' 법원 위치가 도시와 다름: ' + ct.court);
  checked++;
}

console.log('샘플 데이터 일관성 테스트');

await test('잘 알려진 실제 기업 29곳: 국가·본사 도시·업종이 맞고, 위험 정보를 지어내지 않음', async () => {
  for (const [k, v] of Object.entries(KNOWN)) {
    const [cand] = await s.searchCompanies(k.replace(/\b\w/g, (m) => m.toUpperCase()));
    const p = await s.getProfile(cand.id);
    const r = buildReport(p);
    assert.equal(KO2CC[p.company.country], v.cc, k + ' 국가');
    assert.equal(p.company.city, v.city, k + ' 도시');
    assert.equal(p.company.domain, v.domain, k + ' 도메인');
    assert.equal(r.grade, 'A', k + ' 등급');
    assert.equal(p.courts.length + p.fraud.length + p.insolvency.length, 0, k + ' 위험 정보');
    assert.ok(cand.industry.includes('가상 데이터'));
    checkGenerated(k, p);
  }
});

await test('법인 형태·웹사이트·도시로 국가 추론', async () => {
  const cases = [
    ['Kraft Werkzeug GmbH', 'DE'], ['Rossi Meccanica S.p.A.', 'IT'], ['Ortiz Distribuciones S.A. de C.V.', 'MX'], ['Sharma Polymers Pvt Ltd', 'IN'],
    ['PT Sinar Jaya Abadi', 'ID'], ['Gulf Star FZE', 'AE'], ['Van Dijk Handel B.V.', 'NL'], ['Yilmaz Insaat A.Ş.', 'TR'], ['Nowak Elektro Sp. z o.o.', 'PL'],
    ['Silva Comercio Ltda', 'BR'], ['Tan Brothers Pte Ltd', 'SG'], ['Lim Trading Sdn Bhd', 'MY'], ['Koala Imports Pty Ltd', 'AU'], ['Dupont Négoce SAS', 'FR'],
    ['brightfoods.co.uk', 'GB'], ['nordic-steel.se', 'SE'], ['saigon-kitchen.com.vn', 'VN'], ['Jeddah Medical Supplies', 'SA'], ['Istanbul Textile House', 'TR'],
    ['Lagos Agro Commodities', 'NG'], ['Osaka Electronics', 'JP'], ['Shenzhen Smart Display', 'CN'],
  ];
  for (const [q, cc] of cases) {
    const [cand] = await s.searchCompanies(q);
    const p = await s.getProfile(cand.id);
    assert.equal(KO2CC[p.company.country], cc, `${q} → ${p.company.country}`);
    checkGenerated(q, p);
  }
});

await test('업종 단어로 품목 추론 (의료기기·제약·전기·방위·화학·철강·자동차·화장품·식품·섬유)', async () => {
  const cases = [['Nordic Medical Devices', '의료기기'], ['Alpine Pharma', '의약품'], ['Delta Electric Power', '전기'], ['Falcon Defense Systems', '방산'],
    ['Ocean Polymer Chemicals', '화학'], ['Iron Bridge Steel', '철강'], ['Prime Auto Parts', '자동차'], ['Glow Beauty Cosmetics', '화장품'], ['Green Valley Foods', '식품'], ['Silk Road Textile', '섬유']];
  for (const [q, word] of cases) {
    const [cand] = await s.searchCompanies(q);
    const p = await s.getProfile(cand.id);
    assert.ok(p.company.industry.includes(word), `${q} → ${p.company.industry}`);
    checkGenerated(q, p);
  }
});

await test('선택한 국가를 따름 (검색창 국가 선택 · "이름, 국가" 입력)', async () => {
  for (const [q, opts, cc] of [['Blue Ocean Trading', { country: 'DE' }, 'DE'], ['Blue Ocean Trading, Vietnam', {}, 'VN'], ['Blue Ocean Trading (Mexico)', {}, 'MX'], ['Pfizer', { country: 'DE' }, 'DE']]) {
    const [cand] = await s.searchCompanies(q, opts);
    const p = await s.getProfile(cand.id);
    assert.equal(KO2CC[p.company.country], cc, q);
    checkGenerated(q, p, { country: cc });
  }
});

await test('흔한 단어 하나 때문에 목록의 다른 회사가 잡히지 않음', async () => {
  for (const q of ['Monterrey Steel', 'Pacific Basin Shipping', 'ABC Tech Components Inc', 'Orion Pharma Oy', 'Sahara Foods', 'Apex Medical', 'Gulf Supplies Kuwait', 'Prime Commodities Kenya', 'Warsaw Bakery', 'Global Trading']) {
    const c = await s.searchCompanies(q);
    assert.equal(c.length, 1, q);
    assert.ok(c[0].id.startsWith('gen:'), `${q} → 목록 회사 ${c[0].name}`);
  }
});

await test('목록 회사는 여전히 정확히 찾음 (정식 이름·별칭·오타·번호·웹사이트·한글)', async () => {
  const cases = [['Sakura Precision Trading Co., Ltd.', 'sakura-jp'], ['Sakura Precison Trading', 'sakura-jp'], ['sakura', 'sakura-jp'], ['사쿠라', 'sakura-jp'],
    ['Northwind Global Trading LLC', 'nw-global-ae'], ['northwind-global.ae', 'nw-global-ae'], ['https://www.sakura-precision.co.jp/en/about', 'sakura-jp'],
    ['HRB-77412', 'hanseatic-de'], ['Monterrey Industrial Partners', 'monterrey-mx'], ['Riyadh Gulf Supplies', 'riyadh-sa'], ['Apex Petrochem', 'apex-ae']];
  for (const [q, id] of cases) {
    const c = await s.searchCompanies(q);
    assert.ok(c.some((x) => x.id === id), `${q} → ${c.map((x) => x.name).join(', ')}`);
    assert.equal(c[0].id, id, `${q} 첫 후보`);
  }
  assert.equal((await s.searchCompanies('Orion')).length, 2);
  assert.equal((await s.searchCompanies('Northwind')).length, 2);
  assert.equal((await s.searchCompanies('Northwind', { country: 'AE' })).length, 2);
});

await test('무료 메일·한글 입력은 회사·국가를 지어내지 않음', async () => {
  let [cand] = await s.searchCompanies('buyer.kim@gmail.com');
  let p = await s.getProfile(cand.id);
  assert.match(p.company.name, /회사명 미확인/); assert.equal(p.company.country, '국가 미확인');
  assert.ok(buildReport(p).signals.some((x) => x.key === 'domain-age' && /무료 메일/.test(x.value)));
  [cand] = await s.searchCompanies('한빛무역');
  p = await s.getProfile(cand.id);
  assert.equal(p.company.name, '한빛무역'); assert.equal(p.company.domain, '');
});

await test('무작위 이름 400건: 모든 항목이 서로 맞고, 같은 입력은 항상 같은 결과', async () => {
  const A = ['Blue', 'Golden', 'Silver', 'Red Sea', 'Atlas', 'Nova', 'Summit', 'Harbor', 'Eagle', 'Lotus', 'Crown', 'Delta', 'Zenith', 'Vertex', 'Coral'];
  const B = ['Medical', 'Pharma', 'Electric', 'Steel', 'Foods', 'Textile', 'Auto Parts', 'Cosmetics', 'Logistics', 'Machinery', 'Trading', 'Chemicals', 'Electronics', 'Defense', 'Building'];
  const C = ['', ' GmbH', ' Ltd', ' Inc.', ' LLC', ' S.A. de C.V.', ' Pvt Ltd', ' Co., Ltd', ' B.V.', ' A.Ş.', ' Sp. z o.o.', ' S.p.A.', ' Pte Ltd', ' FZE', ' SAS'];
  const CC = [null, 'US', 'DE', 'VN', 'AE', 'IN', 'MX', 'JP', 'BR', 'TR'];
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const q = `${A[i % A.length]} ${B[(i * 7) % B.length]}${C[(i * 11) % C.length]}`;
    const country = CC[(i * 3) % CC.length];
    const c1 = await s.searchCompanies(q, { country });
    const c2 = await s.searchCompanies(q, { country });
    assert.deepEqual(c1, c2, q + ' 결과가 매번 다름');
    for (const cand of c1) {
      const p = await s.getProfile(cand.id);
      assert.equal(p.company.name, cand.name);
      if (cand.id.startsWith('gen:')) checkGenerated(q, p, { country: country || undefined });
      n++;
    }
  }
  assert.ok(n >= 400);
});

console.log(`\n${passed}개 통과 · 가상 프로필 ${checked}건 점검${fails.length ? ' · 실패: ' + fails.join(', ') : ''}`);
