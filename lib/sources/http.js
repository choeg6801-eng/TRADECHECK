// 외부 데이터 API 호출 공통: 시간 제한, 재시도, 오류 구분
export class SourceError extends Error {
  constructor(source, kind, message) {
    super(`[${source}] ${message}`);
    this.source = source;
    this.kind = kind; // 'not_configured' | 'not_found' | 'timeout' | 'http' | 'network'
  }
}

// deadline: 이 시각(ms)까지 끝나야 함 — 여러 출처를 부르는 조회 전체의 시간 제한을 지키기 위해 사용
export async function fetchJson(source, url, { method = 'GET', headers = {}, body, timeoutMs = 7000, retries = 1, deadline = null } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const left = deadline ? deadline - Date.now() : timeoutMs;
    if (left < 300) throw new SourceError(source, 'timeout', '응답 시간 초과');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, left));
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (res.status === 404) throw new SourceError(source, 'not_found', '찾을 수 없음');
      if (res.status === 429 || res.status >= 500) {
        lastErr = new SourceError(source, 'http', `HTTP ${res.status}`);
        if (attempt < retries) { clearTimeout(timer); await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
        throw lastErr;
      }
      if (!res.ok) throw new SourceError(source, 'http', `HTTP ${res.status}`);
      const text = await res.text(); // 본문을 다 받을 때까지 시간 제한 유지
      clearTimeout(timer);
      try { return text ? JSON.parse(text) : null; } catch { throw new SourceError(source, 'http', '응답 형식 오류'); }
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof SourceError) throw e;
      lastErr = new SourceError(source, e.name === 'AbortError' ? 'timeout' : 'network', e.name === 'AbortError' ? '응답 시간 초과' : e.message);
      if (attempt < retries && lastErr.kind !== 'timeout') continue; // 시간 초과는 다시 시도하지 않음
      throw lastErr;
    }
  }
  throw lastErr;
}
