// 샘플 데이터 공급자 — 실제 데이터 업체와 계약하기 전까지 쓰는 가상 데이터입니다.
// 실제 업체를 연결할 때는 같은 두 함수(searchCompanies, getProfile)를 가진 공급자를 만들어
// lib/providers/index.js 에 등록하면 됩니다. 화면·등급 엔진·DB는 바꿀 필요가 없습니다.
//
// 공급자 계약(인터페이스)
//   searchCompanies(query: string) => Promise<Candidate[]>
//     Candidate = { id, name, country, countryCode, industry, city, domain }
//   getProfile(id: string) => Promise<Profile | null>
//     Profile = {
//       company:   { id, name, country, countryCode, industry, city, founded, regNo, domain },
//       identity:  { domainMatchesCompany: boolean, addressVerified: boolean, impersonates: string|null },
//       customs:   { monthly: number[12], lastShipmentDaysAgo: number|null, topProducts: string[], partnerCountries: string[] } | null,
//       courts:    [{ year, kind: 'payment'|'contract'|'other', status: 'open'|'closed', role, amountUSD, court }],
//       insolvency:[{ year, kind: 'bankruptcy'|'restructuring', status: 'active'|'closed' }],
//       credit:    { score: number|null (0~100), provider: string },
//       fraud:     [{ year, kind: 'confirmed'|'impersonation'|'reported', note, source }],
//       coverage:  { customs, courts, insolvency, credit } // false면 리포트에 '정보 제한'으로 표시
//     }

import { COUNTRY_INFO, INDUSTRY_INFO, MAKER_KO, FREE_MAIL, infer, displayName, hash } from './sample-gen.js';
import { countryCodeFrom } from '../countries.js';

export const PROVIDER_ID = 'sample';
export const PROVIDER_LABEL = '샘플 데이터';

const CURATED = [
  {
    aliases: ['northwind', 'northwind global', 'northwind-global', '노스윈드'],
    company: { id: 'nw-global-ae', name: 'Northwind Global Trading LLC', country: '아랍에미리트', countryCode: 'AE', industry: '도매 무역', city: 'Dubai', founded: 2017, regNo: 'DXB-1043877', domain: 'northwind-global.ae' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [3, 4, 2, 5, 3, 6, 4, 2, 5, 7, 4, 8], lastShipmentDaysAgo: 12, topProducts: ['산업용 밸브', '스테인리스 배관 부품', '펌프 부품'], partnerCountries: ['대한민국', '중국', '튀르키예'] },
    courts: [
      { year: 2025, kind: 'payment', status: 'open', role: '피고', amountUSD: 84000, court: 'Dubai Courts (1심)' },
      { year: 2022, kind: 'payment', status: 'closed', role: '피고', amountUSD: 21000, court: 'Dubai Courts (조정 종결)' },
    ],
    insolvency: [],
    credit: { score: 52, provider: '샘플 신용평가' },
    fraud: [],
  },
  {
    aliases: ['northwind', 'northwind trading', '노스윈드'],
    company: { id: 'nw-fze-ae', name: 'Northwind Trading FZE', country: '아랍에미리트', countryCode: 'AE', industry: '물류·중개', city: 'Sharjah', founded: 2024, regNo: 'SAIF-22981', domain: 'northwindfze.com' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0], lastShipmentDaysAgo: 71, topProducts: ['포장재'], partnerCountries: ['중국'] },
    courts: [],
    insolvency: [],
    credit: { score: null, provider: '샘플 신용평가' },
    fraud: [],
  },
  {
    aliases: ['helvetia', 'helvetia industrial', '헬베티아'],
    company: { id: 'helvetia-ch', name: 'Helvetia Industrial Supply AG', country: '스위스', countryCode: 'CH', industry: '산업자재 유통', city: 'Zürich', founded: 1998, regNo: 'CHE-105.442.317', domain: 'helvetia-supply.ch' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [14, 12, 15, 13, 16, 14, 17, 15, 13, 16, 18, 17], lastShipmentDaysAgo: 4, topProducts: ['정밀 베어링', '공작기계 부품', '산업용 센서'], partnerCountries: ['대한민국', '독일', '일본', '대만'] },
    courts: [],
    insolvency: [],
    credit: { score: 84, provider: '샘플 신용평가' },
    fraud: [],
  },
  {
    aliases: ['kestrel', 'kestrel imports', '케스트럴'],
    company: { id: 'kestrel-nl', name: 'Kestrel Imports BV', country: '네덜란드', countryCode: 'NL', industry: '소비재 수입', city: 'Rotterdam', founded: 2012, regNo: 'KVK-55120944', domain: 'kestrelimports.nl' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [6, 5, 7, 6, 4, 5, 6, 7, 5, 6, 4, 5], lastShipmentDaysAgo: 19, topProducts: ['생활가전', '주방용품'], partnerCountries: ['대한민국', '베트남', '중국'] },
    courts: [
      { year: 2023, kind: 'payment', status: 'closed', role: '피고', amountUSD: 12500, court: 'Rechtbank Rotterdam (합의 종결)' },
      { year: 2024, kind: 'contract', status: 'closed', role: '원고', amountUSD: 8000, court: 'Rechtbank Rotterdam' },
    ],
    insolvency: [],
    credit: { score: 57, provider: '샘플 신용평가' },
    fraud: [],
  },
  {
    aliases: ['sahara', 'sahara polymer', '사하라'],
    company: { id: 'sahara-eg', name: 'Sahara Polymer Trading Co.', country: '이집트', countryCode: 'EG', industry: '합성수지 유통', city: 'Cairo', founded: 2009, regNo: 'CR-88412', domain: 'saharapolymer.com' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [5, 4, 3, 3, 2, 2, 1, 2, 1, 1, 0, 1], lastShipmentDaysAgo: 44, topProducts: ['PE 레진', 'PP 레진'], partnerCountries: ['사우디아라비아', '대한민국'] },
    courts: [
      { year: 2025, kind: 'payment', status: 'open', role: '피고', amountUSD: 132000, court: 'Cairo Economic Court' },
      { year: 2026, kind: 'payment', status: 'open', role: '피고', amountUSD: 47000, court: 'Cairo Economic Court' },
    ],
    insolvency: [{ year: 2026, kind: 'restructuring', status: 'active' }],
    credit: { score: 45, provider: '샘플 신용평가' },
    fraud: [],
  },
  {
    aliases: ['brightline', 'brightline import', '브라이트라인'],
    company: { id: 'brightline', name: 'Brightline Import Co.', country: '영국(등기) / 나이지리아(도메인)', countryCode: 'GB', industry: '종합 수입', city: 'London', founded: 2026, regNo: '확인 불가', domain: 'brightline-imports.co' },
    identity: { domainMatchesCompany: false, addressVerified: false, impersonates: 'Brightline Group Ltd (영국 상장사)' },
    customs: { monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], lastShipmentDaysAgo: null, topProducts: [], partnerCountries: [] },
    courts: [],
    insolvency: [],
    credit: { score: null, provider: '샘플 신용평가' },
    fraud: [{ year: 2026, kind: 'impersonation', note: '실존 기업명을 도용한 선결제 사기 신고 2건', source: '무역 사기 신고 DB (샘플)' }],
  },
  // ---------- 테스트용 추가 바이어 (등급·국가·예외 상황별) ----------
  {
    aliases: ['sakura', 'sakura precision', '사쿠라'],
    company: { id: 'sakura-jp', name: 'Sakura Precision Trading Co., Ltd.', country: '일본', countryCode: 'JP', industry: '정밀부품 유통', city: 'Osaka', founded: 1987, regNo: 'JP-4120001033218', domain: 'sakura-precision.co.jp' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [21, 19, 23, 22, 20, 24, 22, 25, 21, 23, 26, 24], lastShipmentDaysAgo: 2, topProducts: ['반도체 장비 부품', '정밀 베어링'], partnerCountries: ['대한민국', '대만', '독일'] },
    courts: [], insolvency: [], credit: { score: 88, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['hanseatic', 'hanseatic maschinen', '한자'],
    company: { id: 'hanseatic-de', name: 'Hanseatic Maschinen GmbH', country: '독일', countryCode: 'DE', industry: '산업기계 수입', city: 'Hamburg', founded: 2001, regNo: 'HRB-77412', domain: 'hanseatic-maschinen.de' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [9, 8, 10, 9, 11, 8, 9, 10, 12, 9, 10, 11], lastShipmentDaysAgo: 6, topProducts: ['CNC 공작기계', '유압 부품'], partnerCountries: ['대한민국', '일본', '이탈리아'] },
    courts: [{ year: 2024, kind: 'contract', status: 'closed', role: '원고', amountUSD: 15000, court: 'Landgericht Hamburg' }],
    insolvency: [], credit: { score: 79, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['pacific coast', 'pacific coast distributors', '퍼시픽'],
    company: { id: 'pacific-us', name: 'Pacific Coast Distributors Inc.', country: '미국', countryCode: 'US', industry: '생활용품 유통', city: 'Los Angeles', founded: 2010, regNo: 'CA-C3318274', domain: 'pacificcoastdist.com' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [15, 17, 14, 16, 18, 15, 19, 17, 16, 18, 20, 19], lastShipmentDaysAgo: 3, topProducts: ['주방용품', '화장품 용기'], partnerCountries: ['대한민국', '중국', '베트남'] },
    courts: [{ year: 2022, kind: 'payment', status: 'closed', role: '피고', amountUSD: 9500, court: 'Superior Court of California (합의 종결)' }],
    insolvency: [], credit: { score: 71, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['orion', 'orion trading', '오리온'],
    company: { id: 'orion-us', name: 'Orion Trading LLC', country: '미국', countryCode: 'US', industry: '전자부품 유통', city: 'Houston', founded: 2015, regNo: 'TX-0802274415', domain: 'oriontradingllc.com' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [8, 7, 9, 8, 10, 9, 8, 11, 9, 10, 9, 12], lastShipmentDaysAgo: 8, topProducts: ['전원 공급장치', '커넥터'], partnerCountries: ['대한민국', '대만'] },
    courts: [], insolvency: [], credit: { score: 74, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['orion', 'mumbai orion', 'orion exports', '뭄바이', '오리온'],
    company: { id: 'orion-in', name: 'Mumbai Orion Exports Pvt Ltd', country: '인도', countryCode: 'IN', industry: '화학원료 수입', city: 'Mumbai', founded: 2008, regNo: 'U51909MH2008PTC181234', domain: 'mumbaiorion.in' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [6, 5, 7, 6, 5, 8, 6, 7, 5, 6, 7, 6], lastShipmentDaysAgo: 15, topProducts: ['석유화학 원료', '안료'], partnerCountries: ['대한민국', '사우디아라비아'] },
    courts: [{ year: 2023, kind: 'payment', status: 'closed', role: '피고', amountUSD: 22000, court: 'Bombay High Court (조정 종결)' }],
    insolvency: [], credit: { score: 58, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['saigon viet star', 'viet star', '사이공'],
    company: { id: 'vietstar-vn', name: 'Saigon Viet Star Trading JSC', country: '베트남', countryCode: 'VN', industry: '화장품 유통', city: 'Ho Chi Minh City', founded: 2019, regNo: 'VN-0315502871', domain: 'vietstar.com.vn' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [2, 3, 2, 4, 3, 2, 3, 4, 2, 3, 3, 2], lastShipmentDaysAgo: 11, topProducts: ['기초 화장품', '마스크팩'], partnerCountries: ['대한민국'] },
    courts: [
      { year: 2024, kind: 'payment', status: 'closed', role: '피고', amountUSD: 18000, court: 'People’s Court of HCMC (합의 종결)' },
      { year: 2025, kind: 'contract', status: 'closed', role: '피고', amountUSD: 6000, court: 'People’s Court of HCMC' },
    ],
    insolvency: [], credit: { score: 57, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['anatolia', 'anatolia yapi', '아나톨리아'],
    company: { id: 'anatolia-tr', name: 'Anatolia Yapı Ticaret A.Ş.', country: '튀르키예', countryCode: 'TR', industry: '건자재 수입', city: 'Istanbul', founded: 2024, regNo: 'TR-482910', domain: 'anatoliayapi.com.tr' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [0, 1, 0, 1, 1, 0, 1, 1, 2, 1, 0, 1], lastShipmentDaysAgo: 24, topProducts: ['단열재', '창호 부품'], partnerCountries: ['대한민국', '중국'] },
    courts: [], insolvency: [], credit: { score: 55, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['riyadh gulf', 'gulf supplies', '리야드'],
    company: { id: 'riyadh-sa', name: 'Riyadh Gulf Supplies Est.', country: '사우디아라비아', countryCode: 'SA', industry: '건설자재 유통', city: 'Riyadh', founded: 2014, regNo: 'CR-1010438827', domain: 'riyadhgulf.sa' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [4, 6, 5, 3, 7, 5, 4, 6, 5, 4, 6, 5], lastShipmentDaysAgo: 18, topProducts: ['철강 배관', '밸브'], partnerCountries: ['대한민국', '인도', '중국'] },
    courts: [
      { year: 2025, kind: 'payment', status: 'open', role: '피고', amountUSD: 64000, court: 'Riyadh Commercial Court' },
      { year: 2023, kind: 'payment', status: 'closed', role: '피고', amountUSD: 12000, court: 'Riyadh Commercial Court (합의 종결)' },
    ],
    insolvency: [], credit: { score: 54, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['jakarta mitra', 'mitra abadi', '자카르타'],
    company: { id: 'mitra-id', name: 'PT Jakarta Mitra Abadi', country: '인도네시아', countryCode: 'ID', industry: '식품 원료 수입', city: 'Jakarta', founded: 2016, regNo: 'NIB-9120004417781', domain: 'mitraabadi.co.id' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0], lastShipmentDaysAgo: 52, topProducts: ['커피 원두'], partnerCountries: ['베트남'] },
    courts: [{ year: 2025, kind: 'payment', status: 'open', role: '피고', amountUSD: 37000, court: 'Central Jakarta District Court' }],
    insolvency: [], credit: { score: 48, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['monterrey', 'monterrey industrial', '몬테레이'],
    company: { id: 'monterrey-mx', name: 'Monterrey Industrial Partners SA de CV', country: '멕시코', countryCode: 'MX', industry: '자동차 부품 유통', city: 'Monterrey', founded: 2005, regNo: 'MIP-050314-AB2', domain: 'monterreyip.com.mx' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [10, 9, 11, 8, 10, 12, 9, 10, 11, 9, 8, 10], lastShipmentDaysAgo: 9, topProducts: ['자동차 내장 부품', '와이어 하네스'], partnerCountries: ['대한민국', '미국'] },
    courts: [
      { year: 2026, kind: 'payment', status: 'open', role: '피고', amountUSD: 91000, court: 'Juzgado de Distrito, Nuevo León' },
      { year: 2024, kind: 'payment', status: 'closed', role: '피고', amountUSD: 27000, court: 'Juzgado de Distrito, Nuevo León (종결)' },
      { year: 2022, kind: 'payment', status: 'closed', role: '피고', amountUSD: 14000, court: 'Juzgado de Distrito, Nuevo León (종결)' },
    ],
    insolvency: [], credit: { score: 59, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['andes andina', 'andina import', '안데스'],
    company: { id: 'andina-pe', name: 'Andes Andina Import SAC', country: '페루', countryCode: 'PE', industry: '농기계 수입', city: 'Lima', founded: 2013, regNo: 'RUC-20556677881', domain: 'andesandina.pe' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: null,
    courts: [], insolvency: [], credit: { score: null, provider: '샘플 신용평가' }, fraud: [],
    coverage: { customs: false, courts: true, insolvency: true, credit: false },
  },
  {
    aliases: ['lagos prime', 'prime commodities', '라고스'],
    company: { id: 'lagos-ng', name: 'Lagos Prime Commodities Ltd', country: '나이지리아', countryCode: 'NG', industry: '원자재 무역', city: 'Lagos', founded: 2018, regNo: 'RC-1498822', domain: 'lagosprime.ng' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1], lastShipmentDaysAgo: 33, topProducts: ['폴리머 원료'], partnerCountries: ['중국', '대한민국'] },
    courts: [
      { year: 2025, kind: 'payment', status: 'open', role: '피고', amountUSD: 58000, court: 'Federal High Court, Lagos' },
      { year: 2026, kind: 'payment', status: 'open', role: '피고', amountUSD: 120000, court: 'Federal High Court, Lagos' },
    ],
    insolvency: [{ year: 2026, kind: 'bankruptcy', status: 'active' }],
    credit: { score: 41, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['warsaw tech', 'tech components', '바르샤바'],
    company: { id: 'warsaw-pl', name: 'Warsaw Tech Components Sp. z o.o.', country: '폴란드', countryCode: 'PL', industry: '전자부품 수입', city: 'Warsaw', founded: 2011, regNo: 'KRS-0000391882', domain: 'warsawtech.pl' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [7, 6, 5, 6, 4, 5, 3, 4, 3, 2, 3, 2], lastShipmentDaysAgo: 27, topProducts: ['PCB 기판', '디스플레이 모듈'], partnerCountries: ['대한민국', '대만'] },
    courts: [{ year: 2026, kind: 'payment', status: 'open', role: '피고', amountUSD: 45000, court: 'Sąd Okręgowy w Warszawie' }],
    insolvency: [{ year: 2026, kind: 'restructuring', status: 'active' }],
    credit: { score: 44, provider: '샘플 신용평가' }, fraud: [],
  },
  {
    aliases: ['sinoglobal', 'sinoglobal holdings', '시노글로벌'],
    company: { id: 'sinoglobal-hk', name: 'Sinoglobal Holdings Group Ltd', country: '홍콩', countryCode: 'HK', industry: '중개 무역', city: 'Hong Kong', founded: 2020, regNo: 'HK-2948117', domain: 'sinoglobal-group.hk' },
    identity: { domainMatchesCompany: true, addressVerified: true, impersonates: null },
    customs: { monthly: [3, 2, 4, 3, 2, 3, 4, 2, 3, 2, 3, 3], lastShipmentDaysAgo: 20, topProducts: ['전자제품'], partnerCountries: ['중국', '대한민국'] },
    courts: [], insolvency: [], credit: { score: 61, provider: '샘플 신용평가' },
    fraud: [{ year: 2025, kind: 'confirmed', note: '선적 후 대금 미지급·연락 두절 확인 3건', source: '무역 사기 신고 DB (샘플)' }],
  },
  {
    aliases: ['apex petrochem', 'apex petro', '에이펙스'],
    company: { id: 'apex-ae', name: 'Apex Petrochem FZE', country: '아랍에미리트', countryCode: 'AE', industry: '석유화학 중개', city: 'Ajman', founded: 2026, regNo: '확인 불가', domain: 'apex-petrochem.net' },
    identity: { domainMatchesCompany: false, addressVerified: false, impersonates: null },
    customs: { monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], lastShipmentDaysAgo: null, topProducts: [], partnerCountries: [] },
    courts: [], insolvency: [], credit: { score: null, provider: '샘플 신용평가' },
    fraud: [{ year: 2026, kind: 'reported', note: '무료 이메일 도메인으로 대량 주문 후 서류 위조 의심 신고 1건 (확인 중)', source: '무역 사기 신고 DB (샘플)' }],
  },
];

const COVERAGE_ALL = { customs: true, courts: true, insolvency: true, credit: true };

// ---------------- 유틸 ----------------
export function normalize(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.(com|net|org|co|ae|ch|nl|eg|uk|de|cn|jp|kr|vn|in|io|biz|info)(\.[a-z]{2})?$/i, '')
    .replace(/\b(llc|ltd|limited|inc|incorporated|corp|corporation|co|gmbh|ag|aktiengesellschaft|bv|nv|fze|fzco|sa|sas|srl|spa|pte|plc|company|pvt|sdn|bhd|pty|jsc|ltda|kk)\b\.?/g, ' ')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

// 목록에 없는 회사 → 국가·업종을 추론해 서로 맞는 가상 프로필 생성 (같은 입력이면 항상 같은 결과)
function generated(spec) {
  const raw = String(spec.n || '').trim().slice(0, 120);
  const freeMail = Boolean(spec.d && FREE_MAIL.includes(spec.d));
  const hangul = /[가-힣]/.test(raw);
  const inf = freeMail && !spec.c ? { cc: 'XX', ind: 'general', known: false, city: null, domain: null } : infer({ name: raw, domain: freeMail ? null : spec.d, country: spec.c });
  const { cc, ind, known, city: cityHit } = inf;
  const info = COUNTRY_INFO[cc];
  const inds = INDUSTRY_INFO[ind];
  const key = `${normalize(raw) || raw}|${cc}|${spec.d || ''}`;
  const r = rng(hash(key));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const city = cityHit || pick(info.cities);
  const roll = r();
  // 잘 알려진 실제 기업 이름이면 위험 정보를 지어내지 않음 (항상 깨끗한 프로필)
  const archetype = known ? 'A' : roll < 0.3 ? 'A' : roll < 0.6 ? 'B' : roll < 0.82 ? 'C' : roll < 0.94 ? 'D' : 'F';
  // 이름: 무료 메일이면 회사명 미확인, 한글로 입력하면 입력 그대로, 그 외에는 그 나라 법인 형태를 맞춰 붙임
  // 잘 알려진 기업: 웹사이트나 브랜드명만 넣었으면 정식 이름으로, 그 외에는 입력한 이름 그대로(법인 형태를 덧붙이지 않음)
  const name = freeMail ? `회사명 미확인 (${raw}@${spec.d})` : hangul ? raw
    : known ? (inf.knownName && (spec.d || normalize(raw) === inf.knownKey) ? inf.knownName : raw.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase()))
    : displayName(raw, cc);
  const nowYear = new Date().getFullYear();
  const founded = archetype === 'F' ? nowYear - Math.floor(r() * 2) : nowYear - 3 - Math.floor(r() * 25);
  const base = { A: 12, B: 7, C: 4, D: 2, F: 0 }[archetype];
  const monthly = Array.from({ length: 12 }, () => Math.max(0, Math.round(base + (r() - 0.5) * base * 0.8)));
  const court = info.court.replace('{city}', city);
  const courts = [];
  if (archetype === 'B' || archetype === 'C') courts.push({ year: nowYear - 2, kind: 'payment', status: 'closed', role: '피고', amountUSD: Math.round(5 + r() * 25) * 1000, court });
  if (archetype === 'C') courts.push({ year: nowYear - 1, kind: 'contract', status: 'closed', role: '원고', amountUSD: Math.round(5 + r() * 20) * 1000, court });
  if (archetype === 'C' || archetype === 'D') courts.push({ year: nowYear - 1, kind: 'payment', status: 'open', role: '피고', amountUSD: Math.round(30 + r() * 120) * 1000, court });
  if (archetype === 'D') courts.push({ year: nowYear, kind: 'payment', status: 'open', role: '피고', amountUSD: Math.round(20 + r() * 80) * 1000, court });
  const insolvency = archetype === 'D' ? [{ year: nowYear, kind: 'restructuring', status: 'active' }] : [];
  const creditScore = { A: 68 + r() * 26, B: 46 + r() * 16, C: 40 + r() * 16, D: 40 + r() * 15, F: null }[archetype];
  // 품목은 업종 목록에서, 거래 국가는 업종의 주요 공급국에서 (자기 나라는 제외, 대한민국은 항상 포함)
  const prods = [...inds.products].sort(() => r() - 0.5).slice(0, base ? 2 + Math.floor(r() * 2) : 0);
  const partners = base ? [...(cc === 'KR' ? [] : ['대한민국']), ...inds.partners.filter((x) => x !== '대한민국' && x !== info.ko).sort(() => r() - 0.5).slice(0, 1 + Math.floor(r() * 2))] : [];
  const slug = normalize(raw).replace(/\s+/g, '-').slice(0, 40);
  const domain = spec.d || inf.domain || (slug && !hangul && info.tld ? `${slug}.${info.tld}` : '');
  return {
    company: {
      id: genId({ n: raw, c: spec.c || null, d: spec.d || null }),
      name, country: info.ko, countryCode: cc, industry: known ? MAKER_KO[ind] || inds.ko : inds.ko, city, founded,
      regNo: `${cc}-${String(hash(key + 'r')).slice(0, 8)}`, domain, generated: true, knownCompany: known,
    },
    identity: { domainMatchesCompany: freeMail || !domain ? null : archetype !== 'F', addressVerified: archetype !== 'F', impersonates: null },
    ...(freeMail ? { domainInfo: { domain: spec.d, freeMail: true, ageDays: null } } : {}),
    customs: { monthly, lastShipmentDaysAgo: base ? Math.round(3 + r() * 40) : null, topProducts: prods, partnerCountries: partners },
    courts,
    insolvency,
    credit: { score: creditScore == null ? null : Math.round(creditScore), provider: '샘플 신용평가' },
    fraud: archetype === 'F' ? [{ year: nowYear, kind: 'reported', note: '선결제 후 연락 두절 신고 1건 (확인 중)', source: '무역 사기 신고 DB (샘플)' }] : [],
    coverage: { ...COVERAGE_ALL, credit: archetype !== 'F' },
  };
}

const genId = (o) => 'gen:' + encodeURIComponent(JSON.stringify(o));
function parseGen(id) {
  const rest = id.slice(4);
  try {
    const o = JSON.parse(decodeURIComponent(rest));
    if (o && typeof o.n === 'string' && normalize(o.n)) {
      const c = typeof o.c === 'string' && COUNTRY_INFO[o.c.toUpperCase()] ? o.c.toUpperCase() : null;
      const d = typeof o.d === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(o.d) ? o.d : null;
      return { n: o.n, c, d };
    }
  } catch { /* 예전 형식(gen:슬러그) */ }
  const slug = normalize(rest);
  return slug ? { n: slug, c: null, d: null } : null;
}

// ---------------- 이름 비교 ----------------
const GENERIC = new Set(['trading', 'trade', 'group', 'global', 'international', 'intl', 'company', 'import', 'imports', 'export', 'exports', 'holding', 'holdings', 'the', 'and', 'of', 'enterprise', 'enterprises', 'corporation', 'est']);
const tokens = (s) => normalize(s).split(' ').filter((t) => t.length >= 2);
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const tokMatch = (q, t) => q === t || (q.length >= 4 && t.startsWith(q)) || (q.length >= 5 && lev(q, t) <= (q.length >= 8 ? 2 : 1));
// 검색어의 모든 '구별되는 단어'가 회사 이름·별칭에 있어야 같은 회사로 봄 (흔한 단어 하나로 엉뚱한 회사가 잡히지 않게)
function matchScore(query, p) {
  const raw = String(query || '').trim();
  if (/[가-힣]/.test(raw)) return p.aliases.some((a) => /[가-힣]/.test(a) && (raw === a || (a.length >= 3 && raw.startsWith(a)))) ? 10 : 0;
  const q = tokens(raw).filter((t) => !GENERIC.has(t));
  if (!q.length) return 0;
  const pool = new Set([...tokens(p.company.name), ...p.aliases.flatMap((a) => tokens(a))]);
  let hit = 0;
  for (const t of q) if ([...pool].some((x) => tokMatch(t, x))) hit++;
  if (hit < q.length) return 0;
  return hit + (normalize(raw) === normalize(p.company.name) ? 100 : 0);
}

function toCandidate(p) {
  const c = p.company;
  return { id: c.id, name: c.name, country: c.country, countryCode: c.countryCode, industry: c.industry + (c.generated ? ' · 가상 데이터' : ''), city: c.city, domain: c.domain };
}

// ---------------- 공급자 함수 ----------------
export async function searchCompanies(query, { country } = {}) {
  let raw = String(query || '').trim();
  let cc = countryCodeFrom(country);
  // "회사명, Germany" 처럼 국가를 붙여 쓴 경우
  const m = raw.match(/^(.*?)[,(]\s*([A-Za-z가-힣 .]{2,})\)?\s*$/);
  if (m && countryCodeFrom(m[2])) { cc = cc || countryCodeFrom(m[2]); raw = m[1].trim(); }
  const q = normalize(raw);
  if (!q || q.length < 2) return [];
  // 사업자(법인)등록번호로 찾기: 기호·공백을 무시하고 비교
  const compact = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cq = compact(raw);
  if (cq.length >= 5) {
    const byReg = CURATED.filter((p) => compact(p.company.regNo) === cq || (compact(p.company.regNo).length > 6 && compact(p.company.regNo).endsWith(cq)));
    if (byReg.length) return byReg.map(toCandidate);
  }
  // 웹사이트·이메일이면 도메인으로 찾기
  const em = raw.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  const isDomain = !/\s/.test(raw) && (em || /\.[a-z]{2,}(\/|$)/i.test(raw));
  const domain = isDomain ? (em ? em[1] : raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]) : null;
  if (domain) {
    const byDomain = CURATED.filter((p) => p.company.domain === domain || normalize(p.company.domain) === normalize(domain));
    if (byDomain.length) return byDomain.map(toCandidate);
  }
  const scored = CURATED.map((p) => ({ p, s: matchScore(domain ? domain.split('.')[0].replace(/-/g, ' ') : raw, p) }))
    .filter((x) => x.s > 0 && (!cc || x.p.company.countryCode === cc))
    .sort((a, b) => b.s - a.s);
  if (scored.length) {
    const exact = scored.filter((x) => x.s >= 100);
    return (exact.length ? exact : scored).map((x) => toCandidate(x.p));
  }
  if (domain && FREE_MAIL.includes(domain)) return [toCandidate(generated({ n: (em ? raw.split('@')[0] : 'buyer').slice(0, 40), c: cc, d: domain }))];
  const name = domain ? domain.split('.')[0].replace(/-/g, ' ') : raw;
  return [toCandidate(generated({ n: name, c: cc, d: domain }))];
}

export async function getProfile(id) {
  if (!id) return null;
  if (id.startsWith('gen:')) {
    const spec = parseGen(id);
    return spec ? generated(spec) : null;
  }
  const p = CURATED.find((x) => x.company.id === id);
  if (!p) return null;
  return { ...structuredClone(p), coverage: p.coverage ? { ...p.coverage } : { ...COVERAGE_ALL, credit: p.credit.score != null } };
}
