// OpenSanctions — 전 세계 제재·수출통제·사기/범죄 명단 통합 검색.
// 문서: https://www.opensanctions.org/docs/api/  (POST /match/{dataset}, 헤더 Authorization: ApiKey …)
// 비용: 비상업 무료, 상업 서비스는 데이터 라이선스 + 선불 크레딧(조회 1건 = 1크레딧).
import { fetchJson, SourceError } from './http.js';

const base = () => (process.env.OPENSANCTIONS_API_BASE || 'https://api.opensanctions.org').replace(/\/$/, '');
export const enabled = () => Boolean(process.env.OPENSANCTIONS_API_KEY);

// 토픽 분류 (OpenSanctions topic 값)
const HARD = ['sanction', 'sanction.linked', 'sanction.counter', 'export.control', 'export.risk'];
const SOFT = ['crime.fraud', 'crime', 'crime.fin', 'debarment', 'reg.action', 'reg.warn'];

export async function screenCompany({ name, countryCode, regNo, website }, { deadline = null } = {}) {
  if (!enabled()) throw new SourceError('OpenSanctions', 'not_configured', 'API 키 없음');
  const properties = { name: [name] };
  if (countryCode) properties.country = [countryCode.toLowerCase()];
  if (regNo) properties.registrationNumber = [regNo];
  if (website) properties.website = [website];
  const threshold = Number(process.env.OPENSANCTIONS_THRESHOLD || 0.75);
  const data = await fetchJson('OpenSanctions', `${base()}/match/default?threshold=${threshold}&limit=5`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${process.env.OPENSANCTIONS_API_KEY}` },
    body: { queries: { q: { schema: 'Company', properties } } },
    deadline,
    timeoutMs: 6000,
    retries: 0, // 조회당 과금이라 자동 재시도하지 않음
  });
  const results = data?.responses?.q?.results || [];
  return results
    .filter((r) => r.match)
    .map((r) => {
      const topics = r.properties?.topics || [];
      return {
        id: r.id,
        name: String(r.caption || ''),
        score: Math.round((r.score || 0) * 100) / 100,
        topics,
        datasets: r.datasets || [],
        severity: topics.some((t) => HARD.includes(t)) ? 'sanction' : topics.some((t) => SOFT.includes(t)) ? 'fraud' : 'watch',
        url: `https://www.opensanctions.org/entities/${encodeURIComponent(r.id)}/`,
      };
    });
}
