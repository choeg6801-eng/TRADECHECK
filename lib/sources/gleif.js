// GLEIF — 전 세계 법인식별기호(LEI) 공개 등록부. 무료, 키 필요 없음.
// 문서: https://www.gleif.org/en/lei-data/gleif-api
// 한계: LEI는 금융거래·상장·대기업 위주로 발급되어 중소 바이어는 없는 경우가 많습니다.
import { fetchJson } from './http.js';

const base = () => (process.env.GLEIF_API_BASE || 'https://api.gleif.org/api/v1').replace(/\/$/, '');
export const enabled = () => process.env.GLEIF_DISABLED !== '1';

function toCompany(rec) {
  const a = rec.attributes || {};
  const e = a.entity || {};
  const addr = e.legalAddress || e.headquartersAddress || {};
  const created = e.creationDate ? new Date(e.creationDate) : null;
  return {
    lei: a.lei,
    name: e.legalName?.name || '',
    countryCode: addr.country || null,
    city: addr.city || null,
    addressLines: addr.addressLines || [],
    founded: created && !isNaN(created) ? created.getUTCFullYear() : null,
    regNo: e.registeredAs || null,
    entityStatus: e.status || null, // ACTIVE | INACTIVE
    registrationStatus: a.registration?.status || null, // ISSUED | LAPSED | RETIRED ...
    lastUpdate: a.registration?.lastUpdateDate || null,
  };
}

// 이름(또는 등록번호)으로 후보 찾기
// 1순위: autocompletions (이름 관련도 순으로 정렬되어 모회사가 앞에 옴) → LEI 별 상세 조회
// 2순위: fulltext (autocompletions 가 비었을 때). fulltext 는 관련도 정렬이 약해 엉뚱한 회사가 섞일 수 있습니다.
export async function search(query, { limit = 5, deadline = null } = {}) {
  let records = [];
  try {
    const ac = await fetchJson('GLEIF', `${base()}/autocompletions?field=fulltext&q=${encodeURIComponent(query)}`, { deadline, timeoutMs: 5000 });
    const ids = [...new Set((ac?.data || []).map((d) => d.relationships?.['lei-records']?.data?.id).filter(Boolean))].slice(0, limit + 1);
    const got = await Promise.allSettled(ids.map((id) => getByLei(id, { deadline })));
    records = got.filter((g) => g.status === 'fulfilled' && g.value).map((g) => g.value);
  } catch { /* autocompletions 실패 시 fulltext 로 */ }
  if (!records.length) {
    const url = `${base()}/lei-records?filter[fulltext]=${encodeURIComponent(query)}&page[size]=${Math.min(limit * 2, 20)}`;
    const data = await fetchJson('GLEIF', url, { deadline, timeoutMs: 5000 });
    records = (data?.data || []).map(toCompany);
  }
  return records
    .filter((c) => c.lei && c.name)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.entityStatus === 'ACTIVE' ? 0 : 1) - (b.c.entityStatus === 'ACTIVE' ? 0 : 1) || a.i - b.i)
    .map((x) => x.c)
    .slice(0, limit);
}

export async function getByLei(lei, { deadline = null } = {}) {
  if (!/^[A-Z0-9]{20}$/.test(String(lei || ''))) return null;
  const data = await fetchJson('GLEIF', `${base()}/lei-records/${lei}`, { deadline, timeoutMs: 5000 });
  return data?.data ? toCompany(data.data) : null;
}
