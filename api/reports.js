// 조회 기록 목록 · 리포트 한 건 불러오기 (같은 팀이면 팀원의 리포트도 열람)
import { route, isLive, requireUser, db, query, enc, HttpError } from '../lib/server/core.js';
import { loadProfile, teamUserIds } from '../lib/server/account.js';

const UUID = /^[0-9a-f-]{36}$/i;

export default route(['GET'], async (req) => {
  if (!isLive()) throw new HttpError(400, '데모 모드에서는 조회 기록이 브라우저에만 저장됩니다.');
  const user = await requireUser(req);
  const me = await loadProfile(user);
  const team = await teamUserIds(me);
  const emailOf = Object.fromEntries(team.map((t) => [t.id, t.email]));
  const ids = team.map((t) => t.id).filter((x) => UUID.test(x));
  const q = query(req);
  const id = q.get('id');

  if (id) {
    if (!UUID.test(id)) throw new HttpError(400, '잘못된 리포트 번호입니다.');
    const rows = await db('GET', `reports?id=eq.${enc(id)}&user_id=in.(${ids.join(',')})&select=id,user_id,result,created_at,share_token,share_expires_at`);
    if (!rows.length) throw new HttpError(404, '리포트를 찾을 수 없습니다.');
    const r = rows[0];
    const shareActive = r.share_token && new Date(r.share_expires_at) > new Date();
    return {
      report: { ...r.result, id: r.id },
      owner: { mine: r.user_id === user.id, email: emailOf[r.user_id] || null },
      share: shareActive ? { token: r.share_token, expiresAt: r.share_expires_at } : null,
    };
  }

  const scope = q.get('scope') === 'team' && ids.length > 1 ? 'team' : 'mine';
  const filter = scope === 'team' ? `user_id=in.(${ids.join(',')})` : `user_id=eq.${enc(user.id)}`;
  const rows = await db('GET', `reports?${filter}&select=id,user_id,query,company_id,company_name,country,grade,created_at&order=created_at.desc&limit=300`);
  return {
    scope,
    teamSize: ids.length,
    reports: rows.map((r) => ({ ...r, author: r.user_id === user.id ? null : emailOf[r.user_id] || '팀원' })),
  };
});
