// Creditsafe 계약 후 1회 실행: 국가별 신용 리포트 형식(JSON 스키마)과 샘플 검색 결과를 내려받아
// lib/sources/creditsafe.js 의 FIELD_PATHS 가 맞는지 확인합니다.
//   CREDITSAFE_USERNAME=… CREDITSAFE_PASSWORD=… node tools/creditsafe-schema.mjs AE "Company Name"
import fs from 'node:fs';
const base = (process.env.CREDITSAFE_API_BASE || 'https://connect.sandbox.creditsafe.com/v1').replace(/\/$/, '');
const [country = 'GB', name = 'test'] = process.argv.slice(2);
const j = async (url, init) => { const r = await fetch(url, init); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return JSON.parse(t); };
const { token } = await j(`${base}/authenticate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.CREDITSAFE_USERNAME, password: process.env.CREDITSAFE_PASSWORD }) });
const h = { headers: { Authorization: `Bearer ${token}` } };
const schema = await j(`${base}/companies/schema/${country}?section=CompanyReportResponse`, h);
fs.writeFileSync(`creditsafe-schema-${country}.json`, JSON.stringify(schema, null, 2));
const search = await j(`${base}/companies?countries=${country}&name=${encodeURIComponent(name)}&pageSize=3`, h);
fs.writeFileSync(`creditsafe-search-${country}.json`, JSON.stringify(search, null, 2));
console.log(`저장: creditsafe-schema-${country}.json, creditsafe-search-${country}.json`);
console.log('검색 결과 첫 회사의 키:', Object.keys(search.companies?.[0] || {}));
