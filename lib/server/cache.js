// 외부 데이터 캐시 — 같은 회사를 여러 사람이 조회해도 유료 API는 정해진 기간에 한 번만 부릅니다.
// Supabase 의 source_cache 테이블을 씁니다. (supabase/migrations/0002_live_data.sql)
// Supabase 가 연결되지 않은 환경(데모·로컬)에서는 프로세스 메모리에만 잠시 보관합니다.
import { createHash } from 'node:crypto';
import { db, isLive } from './core.js';

const memory = new Map();
const inflight = new Map(); // 같은 키를 동시에 조회하면 한 번만 부르고 결과를 나눠 씀

// 출처별 보관 기간 (시간)
export const TTL_HOURS = {
  gleif: 24 * 7,
  rdap: 24 * 7,
  sanctions: 24, // 제재 명단은 매일 바뀔 수 있어 짧게
  creditsafe: 24 * 30,
  customs: 24 * 7,
};

export async function cached(source, key, loader) {
  const hours = TTL_HOURS[source] ?? 24;
  const k = `${source}:${createHash('sha256').update(String(key)).digest('hex')}`; // 긴 이름도 충돌 없이
  const fresh = (at) => Date.now() - new Date(at).getTime() < hours * 3600 * 1000;

  const m = memory.get(k);
  if (m && fresh(m.at)) return { value: m.value, cachedAt: m.at, hit: true };

  if (isLive()) {
    try {
      const rows = await db('GET', `source_cache?key=eq.${encodeURIComponent(k)}&select=payload,fetched_at`);
      if (rows?.[0] && fresh(rows[0].fetched_at)) {
        memory.set(k, { value: rows[0].payload, at: rows[0].fetched_at });
        return { value: rows[0].payload, cachedAt: rows[0].fetched_at, hit: true };
      }
    } catch { /* 캐시 실패는 조회를 막지 않음 */ }
  }

  if (inflight.has(k)) return inflight.get(k);
  const p = load(k, source, loader).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

async function load(k, source, loader) {
  const value = await loader();
  const at = new Date().toISOString();
  memory.set(k, { value, at });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  if (isLive()) {
    // 응답 전에 저장을 끝냄 (서버리스는 응답 뒤 작업이 멈출 수 있음). 저장이 늦으면 2초 뒤 포기.
    await Promise.race([
      db('POST', 'source_cache?on_conflict=key', {
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { key: k, source, payload: value, fetched_at: at },
      }).catch(() => {}),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  }
  return { value, cachedAt: at, hit: false };
}
