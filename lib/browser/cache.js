// 미리보기(단일 HTML) 전용 캐시 — lib/server/cache.js 와 같은 모양. 브라우저 localStorage 에 잠시 보관합니다.
export const TTL_HOURS = { gleif: 24 * 7, rdap: 24 * 7, sanctions: 24, creditsafe: 24 * 30, customs: 24 * 7 };
const PREFIX = 'tc.src.';

export async function cached(source, key, loader) {
  const hours = TTL_HOURS[source] ?? 24;
  const k = PREFIX + `${source}:${key}`.slice(0, 200);
  try {
    const hit = JSON.parse(localStorage.getItem(k) || 'null');
    if (hit && Date.now() - new Date(hit.at).getTime() < hours * 3600 * 1000) return { value: hit.value, cachedAt: hit.at, hit: true };
  } catch { /* 저장소를 못 쓰면 매번 조회 */ }
  const value = await loader();
  const at = new Date().toISOString();
  try { localStorage.setItem(k, JSON.stringify({ value, at })); } catch { /* 용량 초과 등은 무시 */ }
  return { value, cachedAt: at, hit: false };
}
