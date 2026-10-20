// 브라우저 공통: 설정 불러오기, Supabase 로그인(REST), 서버 API 호출, 데모 모드 저장소.
// 외부 라이브러리 없이 동작합니다.

let configPromise = null;
export function loadConfig() {
  if (!configPromise && window.TC_PREVIEW) configPromise = Promise.resolve({ mode: 'demo', dataProvider: '샘플 데이터' });
  if (!configPromise) {
    configPromise = fetch('/api/config')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('config'))))
      .catch(() => ({ mode: 'demo', dataProvider: '샘플 데이터' }));
  }
  return configPromise;
}

// ---------------- 세션 ----------------
const SESSION_KEY = 'tc.session';

function safeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function safeSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function getSession() {
  return safeGet(SESSION_KEY);
}

function saveSession(data) {
  if (!data?.access_token) return null;
  const s = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user ? { id: data.user.id, email: data.user.email } : getSession()?.user || null,
  };
  safeSet(SESSION_KEY, s);
  return s;
}

async function authFetch(path, { method = 'POST', body, token } = {}) {
  const cfg = await loadConfig();
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/${path}`, {
    method,
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translateAuthError(data));
  return data;
}

function translateAuthError(d) {
  const m = (d.msg || d.error_description || d.message || d.error || '').toLowerCase();
  if (m.includes('invalid login')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (m.includes('email not confirmed')) return '메일함에서 인증 링크를 먼저 눌러 주세요.';
  if (m.includes('already registered') || m.includes('already been registered')) return '이미 가입된 이메일입니다. 로그인해 주세요.';
  if (m.includes('password') && m.includes('6')) return '비밀번호는 6자 이상이어야 합니다.';
  if (m.includes('rate limit')) return '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
  return d.msg || d.error_description || d.message || '요청을 처리하지 못했습니다.';
}

export async function signIn(email, password) {
  return saveSession(await authFetch('token?grant_type=password', { body: { email, password } }));
}

export async function signUp(email, password, redirectTo) {
  const data = await authFetch('signup' + (redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''), { body: { email, password } });
  if (data.access_token) return { session: saveSession(data) };
  return { needsConfirm: true };
}

export async function sendReset(email, redirectTo) {
  await authFetch('recover' + (redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''), { body: { email } });
}

export async function updatePassword(password) {
  const token = await getToken();
  await authFetch('user', { method: 'PUT', body: { password }, token });
}

export async function signOut() {
  const s = getSession();
  safeSet(SESSION_KEY, null);
  if (s?.access_token) authFetch('logout', { token: s.access_token }).catch(() => {});
}

// 인증 메일·비밀번호 재설정 링크로 돌아왔을 때 주소의 #access_token=... 을 세션으로 저장
export async function sessionFromUrlHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('error_description')) throw new Error(h.get('error_description'));
  if (!h.get('access_token')) return null;
  // Supabase 인증 메일 링크(가입 확인·비밀번호 재설정 등)로 들어온 경우에만 받아들임
  if (!['signup', 'recovery', 'magiclink', 'invite', 'email_change', 'email'].includes(h.get('type') || '')) {
    history.replaceState(null, '', location.pathname + location.search);
    return null;
  }
  const s = saveSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: Number(h.get('expires_in') || 3600) });
  try {
    const user = await authFetch('user', { method: 'GET', token: s.access_token });
    saveSession({ ...s, user, expires_at: s.expires_at });
  } catch {}
  history.replaceState(null, '', location.pathname + location.search);
  return { session: getSession(), type: h.get('type') };
}

export async function getToken() {
  let s = getSession();
  if (!s) return null;
  if (s.expires_at - 60 < Date.now() / 1000) {
    try {
      s = saveSession(await authFetch('token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } }));
    } catch {
      safeSet(SESSION_KEY, null);
      return null;
    }
  }
  return s.access_token;
}

// ---------------- 서버 API ----------------
export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || '요청을 처리하지 못했습니다.');
    this.status = status;
    this.data = data || {};
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------------- 데모 모드 저장소 (이 브라우저에만 저장) ----------------
const DEMO_REPORTS = 'tc.demo.reports';
const DEMO_WATCH = 'tc.demo.watch';

export const demoStore = {
  reports() { return safeGet(DEMO_REPORTS) || []; },
  saveReport(r) {
    const list = this.reports().filter((x) => x.id !== r.id);
    list.unshift(r);
    safeSet(DEMO_REPORTS, list.slice(0, 50));
  },
  report(id) { return this.reports().find((x) => x.id === id) || null; },
  watch() { return safeGet(DEMO_WATCH) || []; },
  saveWatch(list) { safeSet(DEMO_WATCH, list); },
};
