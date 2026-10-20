// 서버 공통 도구 — 환경변수, 응답, Supabase REST 호출, 로그인 확인.
// 외부 패키지 없이 Node 18+ 내장 fetch 만 씁니다. (Vercel Node 함수에서 그대로 동작)

export function env() {
  const e = process.env;
  return {
    supabaseUrl: (e.SUPABASE_URL || '').replace(/\/$/, ''),
    anonKey: e.SUPABASE_ANON_KEY || '',
    serviceKey: e.SUPABASE_SERVICE_ROLE_KEY || '',
    tossClientKey: e.TOSS_CLIENT_KEY || '',
    tossSecretKey: e.TOSS_SECRET_KEY || '',
    tossApiBase: (e.TOSS_API_BASE || 'https://api.tosspayments.com').replace(/\/$/, ''),
    cronSecret: e.CRON_SECRET || '',
  };
}

export function isLive() {
  const c = env();
  return Boolean(c.supabaseUrl && c.anonKey && c.serviceKey);
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// 핸들러 감싸기: 허용 메서드 확인 + 오류를 JSON 으로 변환
export function route(methods, fn) {
  return async function handler(req, res) {
    try {
      if (!methods.includes(req.method)) throw new HttpError(405, '허용되지 않은 요청 방식입니다.');
      const out = await fn(req, res);
      if (!res.writableEnded) send(res, 200, out ?? { ok: true });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: status >= 500 ? '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' : err.message, ...(err.extra || {}) });
    }
  };
}

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, '잘못된 요청 형식입니다.'); }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, '잘못된 요청 형식입니다.'); }
}

export function query(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

// ---------------- Supabase ----------------
function keyHeaders(key) {
  const h = { apikey: key };
  // 기존 JWT 형식 키(eyJ...)만 Authorization 에 넣습니다. 새 형식(sb_secret_...)은 apikey 헤더만으로 동작합니다.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function db(method, path, { body: payload, prefer } = {}) {
  const c = env();
  const res = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: { ...keyHeaders(c.serviceKey), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    console.error('Supabase REST error', method, path, res.status, text);
    throw new HttpError(500, 'DB 오류');
  }
  return data;
}

export function rpc(name, args) {
  return db('POST', `rpc/${name}`, { body: args });
}

export async function requireUser(req) {
  const c = env();
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new HttpError(401, '로그인이 필요합니다.');
  const res = await fetch(`${c.supabaseUrl}/auth/v1/user`, { headers: { apikey: c.anonKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const user = await res.json();
  if (!user?.id) throw new HttpError(401, '로그인이 필요합니다.');
  return user;
}

export const enc = encodeURIComponent;
