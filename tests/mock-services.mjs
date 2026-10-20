// 테스트 전용: 가짜 Supabase(Auth + REST)와 가짜 토스 결제 승인 서버.
// REST·RPC 요청은 실제 Postgres(psql)로 실행하므로 migrations/0001_init.sql 의 함수·제약을 그대로 검증합니다.
//   PG="psql -h /tmp/pgt -p 54329 -U postgres -d tc" node tests/mock-services.mjs
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const PG = (process.env.PG || 'psql -h /tmp/pgt -p 54329 -U postgres -d tc').split(' ');
const SB_PORT = 54400, TOSS_PORT = 54401;
export const ANON = 'test-anon-key', SERVICE = 'test-service-key', TOSS_SECRET = 'test_gsk_mock';

function sql(q) {
  const r = spawnSync(PG[0], [...PG.slice(1), '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim();
}
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad ident ' + s); return s; };

const users = new Map(); // email -> {id, email, password}
const tokens = new Map(); // token -> user

function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d ? JSON.parse(d) : {})); });
}
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function session(user) {
  const t = 'tok_' + crypto.randomBytes(12).toString('hex');
  tokens.set(t, user);
  return { access_token: t, refresh_token: 'ref_' + t, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email: user.email } };
}

// PostgREST 필터 일부 흉내: eq, in, is.null, ilike, or=(a.eq.x,b.eq.y)
function cond(k, v) {
  let m;
  if ((m = v.match(/^eq\.(.*)$/))) return `${ident(k)}::text = ${lit(m[1])}`;
  if ((m = v.match(/^neq\.(.*)$/))) return `${ident(k)}::text is distinct from ${lit(m[1])}`;
  if ((m = v.match(/^gte\.(.*)$/))) return `${ident(k)} >= ${lit(m[1])}`;
  if ((m = v.match(/^in\.\((.*)\)$/))) return `${ident(k)}::text in (${m[1].split(',').map((x) => lit(x)).join(',')})`;
  if (v === 'is.null') return `${ident(k)} is null`;
  if ((m = v.match(/^ilike\.(.*)$/))) return `${ident(k)}::text ilike ${lit(m[1].replace(/\*/g, '%'))}`;
  throw new Error('unsupported filter ' + k + '=' + v);
}
function where(params) {
  const conds = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      const parts = v.replace(/^\(|\)$/g, '').split(',').map((x) => { const [col, op, ...rest] = x.split('.'); return cond(col, `${op}.${rest.join('.')}`); });
      conds.push('(' + parts.join(' or ') + ')');
      continue;
    }
    conds.push(cond(k, v));
  }
  return conds.length ? ' where ' + conds.join(' and ') : '';
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  try {
    // ---------- Auth ----------
    if (url.pathname.startsWith('/auth/v1/')) {
      if (req.headers.apikey !== ANON) return send(res, 401, { msg: 'bad apikey' });
      const p = url.pathname.slice(9);
      if (p === 'signup') {
        const { email, password } = await readBody(req);
        if (users.has(email)) return send(res, 400, { msg: 'User already registered' });
        const id = crypto.randomUUID();
        const u = { id, email, password };
        users.set(email, u);
        sql(`insert into auth.users(id,email,email_confirmed_at) values (${lit(id)},${lit(email)},now())`);
        return send(res, 200, session(u)); // 이메일 인증 없이 바로 로그인되는 설정을 흉내
      }
      if (p === 'token') {
        const b = await readBody(req);
        if (url.searchParams.get('grant_type') === 'password') {
          const u = users.get(b.email);
          if (!u || u.password !== b.password) return send(res, 400, { error_description: 'Invalid login credentials' });
          return send(res, 200, session(u));
        }
        const u = tokens.get(String(b.refresh_token).replace(/^ref_/, ''));
        return u ? send(res, 200, session(u)) : send(res, 400, { msg: 'invalid refresh' });
      }
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      const u = tokens.get(tok);
      if (p === 'user') return u ? send(res, 200, { id: u.id, email: u.email }) : send(res, 401, { msg: 'invalid token' });
      if (p === 'logout') { tokens.delete(tok); return send(res, 204); }
      return send(res, 404, {});
    }
    // ---------- REST (service role only) ----------
    if (url.pathname.startsWith('/rest/v1/')) {
      if (req.headers.apikey !== SERVICE) return send(res, 401, { message: 'service key required' });
      const tail = url.pathname.slice(9);
      if (tail.startsWith('rpc/')) {
        const fn = ident(tail.slice(4));
        const args = await readBody(req);
        const list = Object.entries(args).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ');
        const isSet = fn === 'watchlist_for_alerts';
        const out = isSet ? sql(`select coalesce(json_agg(t),'[]') from public.${fn}(${list}) t`) : sql(`select to_json(public.${fn}(${list}))`);
        return send(res, 200, out ? JSON.parse(out) : null);
      }
      const table = ident(tail);
      const sp = url.searchParams;
      if (req.method === 'GET') {
        const cols = (sp.get('select') || '*').split(',').map((c) => (c === '*' ? '*' : ident(c))).join(',');
        let q = `select ${cols} from public.${table}${where(sp)}`;
        if (sp.get('order')) { const [c, d] = sp.get('order').split('.'); q += ` order by ${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }
        if (sp.get('limit')) q += ` limit ${Number(sp.get('limit'))}`;
        return send(res, 200, JSON.parse(sql(`select coalesce(json_agg(t),'[]') from (${q}) t`)));
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const rows = Array.isArray(b) ? b : [b];
        const out = [];
        for (const r of rows) {
          const keys = Object.keys(r);
          const oc = sp.get('on_conflict');
          const pref = req.headers.prefer || '';
          const conflict = oc ? (pref.includes('merge-duplicates') ? ` on conflict (${ident(oc)}) do update set ${keys.filter((k) => k !== oc).map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}` : ` on conflict (${ident(oc)}) do nothing`) : '';
          const row = sql(`insert into public.${table}(${keys.map(ident).join(',')}) values (${keys.map((k) => lit(r[k])).join(',')})${conflict} returning row_to_json(${table}.*)`);
          if (row) out.push(JSON.parse(row));
        }
        return send(res, 201, (req.headers.prefer || '').includes('return=representation') ? out : undefined);
      }
      if (req.method === 'PATCH') {
        const b = await readBody(req);
        const set = Object.entries(b).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(', ');
        const out = sql(`with u as (update public.${table} set ${set}${where(sp)} returning *) select coalesce(json_agg(u),'[]') from u`);
        return send(res, 200, (req.headers.prefer || '').includes('return=representation') ? JSON.parse(out) : undefined);
      }
      if (req.method === 'DELETE') { sql(`delete from public.${table}${where(sp)}`); return send(res, 204); }
    }
    send(res, 404, {});
  } catch (e) {
    console.error('[mock-supabase]', e.message);
    send(res, 400, { message: e.message });
  }
}).listen(SB_PORT, () => console.log('mock supabase :' + SB_PORT));

// ---------- 가짜 토스 결제 승인 ----------
export const confirmed = [];
const payments = new Map(); // orderId -> payment
http.createServer(async (req, res) => {
  const b = req.method === 'POST' ? await readBody(req) : {};
  const expected = 'Basic ' + Buffer.from(TOSS_SECRET + ':').toString('base64');
  // 테스트용: 가상계좌 입금 처리
  if (req.url.startsWith('/__deposit/')) {
    const p = payments.get(decodeURIComponent(req.url.split('/')[2]));
    if (p) p.status = 'DONE';
    return send(res, 200, { ok: Boolean(p) });
  }
  if (req.url.startsWith('/__cancel/')) {
    const p = payments.get(decodeURIComponent(req.url.split('/')[2]));
    if (p) p.status = 'CANCELED';
    return send(res, 200, { ok: Boolean(p) });
  }
  if (req.headers.authorization !== expected) return send(res, 401, { code: 'UNAUTHORIZED_KEY', message: '인증되지 않은 키입니다.' });
  if (req.method === 'GET' && req.url.startsWith('/v1/payments/orders/')) {
    const p = payments.get(decodeURIComponent(req.url.split('/').pop()));
    return p ? send(res, 200, p) : send(res, 404, { code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제입니다.' });
  }
  if (req.url !== '/v1/payments/confirm') return send(res, 404, {});
  if (String(b.paymentKey).startsWith('reject')) return send(res, 400, { code: 'REJECT_CARD_COMPANY', message: '카드사에서 결제를 거절했습니다.' });
  if (payments.has(b.orderId)) return send(res, 400, { code: 'ALREADY_PROCESSED_PAYMENT', message: '이미 처리된 결제 입니다.' });
  confirmed.push(b);
  const vbank = String(b.paymentKey).startsWith('vbank');
  const p = { paymentKey: b.paymentKey, orderId: b.orderId, status: vbank ? 'WAITING_FOR_DEPOSIT' : 'DONE', method: vbank ? '가상계좌' : '카드', totalAmount: b.amount, approvedAt: vbank ? null : new Date().toISOString(), receipt: { url: 'https://example.com/receipt/' + b.orderId }, ...(vbank ? { virtualAccount: { bankCode: '88', accountNumber: 'X1234567890', dueDate: new Date(Date.now() + 86400000).toISOString() } } : {}) };
  payments.set(b.orderId, p);
  send(res, 200, p);
}).listen(TOSS_PORT, () => console.log('mock toss :' + TOSS_PORT));
