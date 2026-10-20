// 관심 거래처: 목록 · 추가 · 삭제 · 다시 확인
import { route, body, isLive, requireUser, db, query, enc, HttpError } from '../lib/server/core.js';
import { recheckItem } from '../lib/server/recheck.js';
import { loadAccount, teamUserIds } from '../lib/server/account.js';

const UUID = /^[0-9a-f-]{36}$/i;
// Team 멤버는 소유자의 요금제 기준 한도를 씁니다.
const watchLimit = async (user) => (await loadAccount(user)).summary.watchLimit;

export default route(['GET', 'POST', 'DELETE'], async (req) => {
  if (!isLive()) throw new HttpError(400, '데모 모드에서는 관심 거래처가 브라우저에만 저장됩니다.');
  const user = await requireUser(req);

  if (req.method === 'GET') {
    const items = await db('GET', `watchlist?user_id=eq.${user.id}&select=*&order=created_at.desc`);
    return { items, limit: await watchLimit(user) };
  }

  if (req.method === 'DELETE') {
    const id = query(req).get('id');
    if (!UUID.test(String(id || ''))) throw new HttpError(400, '삭제할 항목이 없습니다.');
    await db('DELETE', `watchlist?id=eq.${enc(id)}&user_id=eq.${user.id}`);
    return { ok: true };
  }

  const { reportId, action, id } = await body(req);

  if (action === 'recheck') {
    if (!UUID.test(String(id || ''))) throw new HttpError(400, '잘못된 요청입니다.');
    const rows = await db('GET', `watchlist?id=eq.${enc(id)}&user_id=eq.${user.id}&select=*`);
    if (!rows.length) throw new HttpError(404, '관심 거래처를 찾을 수 없습니다.');
    return { item: await recheckItem(rows[0]) };
  }

  if (!reportId) throw new HttpError(400, '추가할 리포트가 없습니다.');
  if (!/^[0-9a-f-]{36}$/i.test(String(reportId))) throw new HttpError(400, '잘못된 리포트 번호입니다.');
  const acc = await loadAccount(user);
  const teamIds = (await teamUserIds(acc.me)).map((t) => t.id).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const reports = await db('GET', `reports?id=eq.${enc(reportId)}&user_id=in.(${teamIds.join(',')})&select=id,company_id,company_name,country,grade`);
  if (!reports.length) throw new HttpError(404, '리포트를 찾을 수 없습니다.');
  const r = reports[0];

  const existing = await db('GET', `watchlist?user_id=eq.${user.id}&company_id=eq.${enc(r.company_id)}&select=id`);
  if (existing.length) return { item: existing[0], already: true };

  const limit = acc.summary.watchLimit;
  const count = await db('GET', `watchlist?user_id=eq.${user.id}&select=id`);
  if (count.length >= limit) throw new HttpError(402, `현재 요금제에서는 관심 거래처를 ${limit}곳까지 등록할 수 있습니다.`, { code: 'watch_limit' });

  const [item] = await db('POST', 'watchlist', {
    prefer: 'return=representation',
    body: { user_id: user.id, company_id: r.company_id, company_name: r.company_name, country: r.country, last_grade: r.grade, last_report_id: r.id, checked_at: new Date().toISOString() },
  });
  return { item };
});
