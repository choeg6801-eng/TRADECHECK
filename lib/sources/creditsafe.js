// Creditsafe Connect API — 글로벌 기업 신용평가·등기·소송·파산 (유료 계약 필요)
// 문서: https://doc.creditsafe.com/connect-apis-catalog/product-catalog/connect-api-full/connectapi
//
// 문서로 확인된 부분 (2026-10 기준)
//   - 서버: 운영 https://connect.creditsafe.com/v1 · 샌드박스 https://connect.sandbox.creditsafe.com/v1
//   - 인증: POST /authenticate {username, password} → 토큰 (Bearer)
//   - 회사 검색: GET /companies?countries=AE,US&name=…&regNo=…&website=…  → { totalSize, companies[] }
//   - 신용 리포트: GET /companies/{connectId}
//   - 리포트 형식(국가별): GET /companies/schema/{countryCode}?section=CompanyReportResponse
//
// 계약 후 확인해야 하는 부분
//   검색 결과 companies[] 의 필드 이름과 리포트 안의 신용점수·소송·파산 필드 위치는 공개 문서에 나와 있지 않습니다.
//   아래 FIELD_PATHS 는 '후보 경로'이며, 샌드박스 계정이 생기면
//   `node tools/creditsafe-schema.mjs AE` 로 실제 형식을 내려받아 확인·수정하세요.
//   경로가 맞지 않으면 값이 비어 있을 뿐 오류가 나지 않고, 리포트에는 '정보 없음'으로 표시됩니다.
import { fetchJson, SourceError } from './http.js';

const base = () => (process.env.CREDITSAFE_API_BASE || 'https://connect.sandbox.creditsafe.com/v1').replace(/\/$/, '');
export const enabled = () => Boolean(process.env.CREDITSAFE_USERNAME && process.env.CREDITSAFE_PASSWORD);

// 계약 후 실제 형식에 맞춰 고치는 곳 (점 표기 경로, 여러 개면 앞에서부터 시도)
export const FIELD_PATHS = {
  search: {
    id: ['id', 'connectId'],
    name: ['name', 'companyName'],
    regNo: ['regNo', 'registrationNumber'],
    country: ['country', 'countryCode'],
    city: ['address.city'],
    address: ['address.simpleValue'],
    status: ['status'],
  },
  report: {
    // 0~100 공통 점수 (Creditsafe 'common value' A~E 또는 숫자 점수)
    score: ['report.creditScore.currentCreditRating.providerValue.value', 'report.creditScore.currentCreditRating.commonValue'],
    scoreMax: ['report.creditScore.currentCreditRating.providerValue.maxValue'],
    registrationDate: ['report.companyIdentification.basicInformation.companyRegistrationDate'],
    status: ['report.companyIdentification.basicInformation.companyStatus.status'],
    legalFilings: ['report.negativeInformation.legalFilings', 'report.negativeInformation.ccjDetails'],
    insolvency: ['report.negativeInformation.insolvencyDetails'],
  },
};

const get = (obj, paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null) return v;
  }
  return null;
};

let tokenCache = { value: null, until: 0 };
async function token(deadline) {
  if (!enabled()) throw new SourceError('Creditsafe', 'not_configured', '계정 정보 없음');
  if (tokenCache.value && Date.now() < tokenCache.until) return tokenCache.value;
  const data = await fetchJson('Creditsafe', `${base()}/authenticate`, {
    method: 'POST',
    body: { username: process.env.CREDITSAFE_USERNAME, password: process.env.CREDITSAFE_PASSWORD },
    retries: 0,
    timeoutMs: 5000,
    deadline,
  });
  if (!data?.token) throw new SourceError('Creditsafe', 'http', '인증 토큰을 받지 못했습니다');
  tokenCache = { value: data.token, until: Date.now() + 50 * 60 * 1000 }; // 토큰 유효시간보다 짧게 재사용
  return data.token;
}

const auth = async (deadline) => ({ Authorization: `Bearer ${await token(deadline)}` });

export async function search({ name, countryCode, regNo, website }, { deadline = null } = {}) {
  if (!countryCode) return []; // countries 는 필수 파라미터
  const p = new URLSearchParams({ countries: countryCode.toUpperCase(), pageSize: '5' });
  if (regNo) p.set('regNo', regNo);
  else if (website) p.set('website', website);
  else p.set('name', name);
  const data = await fetchJson('Creditsafe', `${base()}/companies?${p}`, { headers: await auth(deadline), deadline, timeoutMs: 6000, retries: 0 });
  const F = FIELD_PATHS.search;
  return (data?.companies || []).map((c) => ({
    connectId: get(c, F.id),
    name: get(c, F.name),
    regNo: get(c, F.regNo),
    countryCode: get(c, F.country),
    city: get(c, F.city),
    address: get(c, F.address),
    status: get(c, F.status),
  })).filter((c) => c.connectId && c.name);
}

// 리포트 1건 = 계약상 과금 단위인 경우가 많습니다. 캐시를 꼭 거쳐 호출하세요.
export async function report(connectId, { deadline = null } = {}) {
  const data = await fetchJson('Creditsafe', `${base()}/companies/${encodeURIComponent(connectId)}?language=en`, { headers: await auth(deadline), timeoutMs: 9000, deadline, retries: 0 });
  return mapReport(data);
}

export function mapReport(data) {
  const F = FIELD_PATHS.report;
  let score = get(data, F.score);
  const max = Number(get(data, F.scoreMax)) || 100;
  if (typeof score === 'string') score = { A: 90, B: 70, C: 50, D: 30, E: 10 }[score.trim().toUpperCase()] ?? Number(score);
  score = Number.isFinite(Number(score)) ? Math.round((Number(score) / max) * 100) : null;
  const reg = get(data, F.registrationDate);
  const filings = get(data, F.legalFilings);
  const ins = get(data, F.insolvency);
  return {
    score,
    founded: reg ? new Date(reg).getUTCFullYear() || null : null,
    status: get(data, F.status),
    // 소송·파산은 국가별 형식이 달라 '건수' 만 안전하게 사용합니다. 세부 매핑은 계약 후 추가하세요.
    legalCount: Array.isArray(filings) ? filings.length : null,
    insolvencyCount: Array.isArray(ins) ? ins.length : null,
    raw: process.env.CREDITSAFE_KEEP_RAW === '1' ? data : undefined,
  };
}
