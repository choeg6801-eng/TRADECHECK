// RDAP — 도메인 등록 정보(WHOIS의 표준 후속). 무료, 키 필요 없음.
// rdap.org 가 도메인 끝(.com, .ae 등)에 맞는 등록기관 서버로 안내합니다.
// 사기 신호: 바이어 웹사이트가 최근에 만들어졌거나(예: 6개월 이내) 등록 정보가 없으면 주의.
import { fetchJson, SourceError } from './http.js';

const base = () => (process.env.RDAP_BASE || 'https://rdap.org').replace(/\/$/, '');
export const enabled = () => process.env.RDAP_DISABLED !== '1';

const FREE_MAIL = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'mail.com', 'qq.com', '163.com', '126.com', 'yandex.ru', 'naver.com', 'daum.net', 'gmx.com', 'proton.me', 'protonmail.com', 'icloud.com', 'live.com'];

export function extractDomain(input) {
  const s = String(input || '').trim().toLowerCase();
  const fromEmail = s.match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  const raw = fromEmail ? fromEmail[1] : s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw) ? raw : null;
}

export const isFreeMail = (domain) => FREE_MAIL.includes(String(domain || '').toLowerCase());

// 일반 최상위 도메인(gTLD)은 RDAP 제공이 의무라, 여기서 '없음'이면 실제로 등록되지 않은 도메인입니다.
const GTLD = ['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'xyz', 'online', 'site', 'shop', 'store', 'app', 'dev', 'global', 'group', 'trade', 'company', 'ltd', 'llc'];
export const isGtld = (domain) => GTLD.includes(String(domain || '').split('.').pop());

// 등록일 등 원자료만 돌려줍니다. 도메인 나이는 읽는 시점에 계산하세요 (캐시 때문에 늦어지지 않도록).
export async function lookup(domain, { deadline = null } = {}) {
  let data;
  try {
    data = await fetchJson('RDAP', `${base()}/domain/${encodeURIComponent(domain)}`, { timeoutMs: 5000, deadline });
  } catch (e) {
    if (e instanceof SourceError && e.kind === 'not_found') return { domain, notFound: true, notRegistered: isGtld(domain), registeredAt: null };
    throw e;
  }
  const ev = (action) => (data?.events || []).find((e) => e.eventAction === action)?.eventDate || null;
  const registrar = (data?.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const vcardName = registrar?.vcardArray?.[1]?.find?.((f) => f[0] === 'fn')?.[3] || null;
  return {
    domain,
    registeredAt: ev('registration'),
    expiresAt: ev('expiration'),
    registrar: typeof vcardName === 'string' ? vcardName : null,
    status: Array.isArray(data?.status) ? data.status : [],
  };
}

export const ageDaysOf = (registeredAt, now = new Date()) => {
  const t = registeredAt ? new Date(registeredAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86400000) : null;
};
