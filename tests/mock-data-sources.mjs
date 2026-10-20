// 실데이터 출처 가짜 서버 — GLEIF·RDAP·OpenSanctions·Creditsafe 와 같은 응답 형식
// 테스트에서 import 하거나, 단독 실행하면 54402 포트로 뜹니다:  node tests/mock-data-sources.mjs
import http from 'node:http';

export const state = { gleifDown: false };
export const hits = {};
const count = (k) => (hits[k] = (hits[k] || 0) + 1);

const lei = (id, name, cc, status, created, regAs = null, regStatus = 'ISSUED') => ({
  type: 'lei-records', id,
  attributes: {
    lei: id,
    entity: { legalName: { name, language: 'en' }, legalAddress: { addressLines: ['1 Test Street'], city: 'Dubai', country: cc, postalCode: null }, registeredAs: regAs, status, creationDate: created },
    registration: { status: regStatus, lastUpdateDate: '2026-05-01T00:00:00Z' },
  },
});
const RECORDS = {
  ACME00000000000000A1: lei('ACME00000000000000A1', 'ACME GLOBAL TRADING L.L.C', 'AE', 'ACTIVE', '2011-03-02T00:00:00Z', 'DED-551200'),
  ACME00000000000000B2: lei('ACME00000000000000B2', 'ACME GLOBAL TRADING FZE', 'AE', 'INACTIVE', '2019-07-10T00:00:00Z', null, 'LAPSED'),
  ROGUE0000000000000C3: lei('ROGUE0000000000000C3', 'ROGUE ARMS EXPORT LLC', 'AE', 'ACTIVE', '2016-01-01T00:00:00Z'),
  CREDIT000000000000D4: lei('CREDIT000000000000D4', 'CREDITWORTHY MACHINERY GMBH', 'DE', 'ACTIVE', '1990-01-01T00:00:00Z', 'HRB 12345'),
};
const DOMAINS = {
  'acmeglobal.ae': '2009-05-20T08:00:00Z',
  'acme-global-trading.com': '2026-08-20T08:00:00Z', // 2개월 된 도메인
  'creditworthy.de': '1999-01-01T00:00:00Z',
};

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  let body = '';
  for await (const c of req) body += c;

  // ---- GLEIF autocompletions ----
  if (url.pathname === '/gleif/autocompletions') {
    count('gleif');
    if (state.gleifDown) return json(503, { errors: [{ status: '503' }] });
    const q = (url.searchParams.get('q') || '').toLowerCase().split(' ')[0];
    const data = Object.values(RECORDS).filter((r) => r.attributes.entity.legalName.name.toLowerCase().includes(q))
      .map((r) => ({ type: 'autocompletions', attributes: { value: r.attributes.entity.legalName.name }, relationships: { 'lei-records': { data: { type: 'lei-records', id: r.id } } } }));
    return json(200, { data });
  }
  // ---- GLEIF ----
  if (url.pathname.startsWith('/gleif/lei-records')) {
    count('gleif');
    if (state.gleifDown) return json(503, { errors: [{ status: '503' }] });
    const id = url.pathname.split('/')[3];
    if (id) return RECORDS[id] ? json(200, { data: RECORDS[id] }) : json(404, { errors: [{ status: '404' }] });
    const q = (url.searchParams.get('filter[fulltext]') || '').toLowerCase();
    const data = Object.values(RECORDS).filter((r) => r.attributes.entity.legalName.name.toLowerCase().includes(q.split(' ')[0]));
    return json(200, { meta: { pagination: { total: data.length } }, data });
  }
  // ---- RDAP ----
  if (url.pathname.startsWith('/rdap/domain/')) {
    count('rdap');
    const d = decodeURIComponent(url.pathname.split('/').pop());
    if (!DOMAINS[d]) return json(404, { errorCode: 404 });
    return json(200, {
      objectClassName: 'domain', ldhName: d.toUpperCase(), status: ['client transfer prohibited'],
      events: [{ eventAction: 'registration', eventDate: DOMAINS[d] }, { eventAction: 'expiration', eventDate: '2027-05-20T08:00:00Z' }, { eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' }],
      entities: [{ objectClassName: 'entity', roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Test Registrar Inc.']]] }],
    });
  }
  // ---- OpenSanctions ----
  if (url.pathname === '/os/match/default' && req.method === 'POST') {
    count('sanctions');
    if (req.headers.authorization !== 'ApiKey test-os-key') return json(401, { detail: 'bad key' });
    const q = JSON.parse(body).queries.q;
    const name = q.properties.name[0].toLowerCase();
    const results = [];
    if (name.includes('rogue')) results.push({ id: 'NK-rogue', caption: 'Rogue Arms Export LLC', schema: 'Company', properties: { name: ['Rogue Arms Export LLC'], topics: ['sanction', 'export.control'] }, datasets: ['us_ofac_sdn', 'eu_fsf'], score: 0.97, match: true });
    if (name.includes('shady')) results.push({ id: 'NK-shady', caption: 'Shady Imports Ltd', schema: 'Company', properties: { topics: ['crime.fraud'] }, datasets: ['interpol_red_notices'], score: 0.88, match: true });
    if (name.includes('acme')) results.push({ id: 'NK-weak', caption: 'Acme Holdings', schema: 'Company', properties: { topics: ['sanction'] }, datasets: ['x'], score: 0.51, match: false });
    return json(200, { responses: { q: { status: 200, results, total: { value: results.length } } }, limit: 5 });
  }
  // ---- Creditsafe (형식 가정) ----
  if (url.pathname === '/cs/authenticate') { count('cs-auth'); return json(200, { token: 'cs-token' }); }
  if (url.pathname.startsWith('/cs/companies')) {
    if (req.headers.authorization !== 'Bearer cs-token') return json(401, {});
    const id = url.pathname.split('/')[3];
    if (!id) {
      count('cs-search');
      const name = (url.searchParams.get('name') || '').toLowerCase();
      const companies = name.includes('creditworthy') ? [{ id: 'DE-X-1', name: 'CREDITWORTHY MACHINERY GMBH', regNo: 'HRB 12345', country: 'DE', address: { simpleValue: 'Hauptstr 1, Berlin', city: 'Berlin' }, status: 'Active' }] : [];
      return json(200, { totalSize: companies.length, companies });
    }
    count('cs-report');
    return json(200, { report: {
      creditScore: { currentCreditRating: { commonValue: 'A', providerValue: { maxValue: '100', minValue: '1', value: '82' } } },
      companyIdentification: { basicInformation: { companyRegistrationDate: '1990-02-01T00:00:00Z', companyStatus: { status: 'Active' } } },
      negativeInformation: { legalFilings: [{ date: '2024-01-01' }], insolvencyDetails: [] },
    } });
  }
  json(404, {});
});


if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(Number(process.env.PORT || 54402), () => console.log('mock data sources on', server.address().port));
}
