// 리포트 공유 링크 — 팀장·재무팀 등 계정이 없는 사람도 읽기 전용으로 볼 수 있습니다. 기본 14일 뒤 만료.
//   POST   { reportId }   링크 만들기(이미 있으면 기한 연장)
//   DELETE ?id=리포트id    링크 끄기
//   GET    ?t=토큰         (로그인 없이) 공유된 리포트 보기
import { route, body, isLive, requireUser, db, query, enc, HttpError } from '../lib/server/core.js';
import { loadProfile, teamUserIds } from '../lib/server/account.js';

const UUID = /^[0-9a-f-]{36}$/i;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const DAYS = 14;

// 공유 링크로 보여 줄 때 숨기는 정보
//  - 검색어(사내 메모일 수 있음)
//  - 유료 신용평가 업체의 원자료(점수·법적 기록 수): 업체 계약상 제3자 재배포가 제한될 수 있어 등급·판단만 보여 줌
export function maskLicensed(result) {
  const { query: _q, ...r } = result || {};
  const licensed = r.credit?.provider && !/샘플/.test(r.credit.provider);
  if (!licensed) return r;
  return {
    ...r,
    credit: { provider: r.credit.provider, score: null, masked: true },
    signals: (r.signals || []).map((s) => (['credit', 'courts-open', 'courts-closed', 'courts-other', 'insolvency'].includes(s.key) && s.level !== 'ok'
      ? { ...s, value: '공유 링크에서는 비공개', detail: '세부 내용은 조회한 회사 계정의 리포트에서 확인하세요.' }
      : s)),
  };
}

const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');

async function findOwnReport(user, id) {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, '잘못된 리포트 번호입니다.');
  const ids = (await teamUserIds(await loadProfile(user))).map((t) => t.id).filter((x) => UUID.test(x));
  const rows = await db('GET', `reports?id=eq.${enc(id)}&user_id=in.(${ids.join(',')})&select=id,share_token,share_expires_at`);
  if (!rows.length) throw new HttpError(404, '리포트를 찾을 수 없습니다.');
  return rows[0];
}

export default route(['GET', 'POST', 'DELETE'], async (req) => {
  if (!isLive()) throw new HttpError(400, '공유 링크는 실서비스 모드에서 쓸 수 있습니다.');

  if (req.method === 'GET') {
    const t = query(req).get('t') || '';
    if (!TOKEN.test(t)) throw new HttpError(404, '공유 링크가 올바르지 않습니다.');
    const rows = await db('GET', `reports?share_token=eq.${enc(t)}&select=id,result,share_expires_at`);
    if (!rows.length || new Date(rows[0].share_expires_at) <= new Date()) throw new HttpError(404, '만료되었거나 취소된 공유 링크입니다.');
    return { report: { ...maskLicensed(rows[0].result), id: rows[0].id }, expiresAt: rows[0].share_expires_at };
  }

  const user = await requireUser(req);
  if (req.method === 'DELETE') {
    const r = await findOwnReport(user, query(req).get('id'));
    await db('PATCH', `reports?id=eq.${enc(r.id)}`, { body: { share_token: null, share_expires_at: null } });
    return { ok: true };
  }

  const { reportId } = await body(req);
  const r = await findOwnReport(user, reportId);
  // 아직 유효한 링크면 그대로(기한 연장 없이), 만료됐으면 새 링크 — 예전 링크가 다시 살아나지 않게
  if (r.share_token && TOKEN.test(r.share_token) && new Date(r.share_expires_at) > new Date()) {
    return { token: r.share_token, path: `/share.html?t=${r.share_token}`, expiresAt: r.share_expires_at };
  }
  const token = newToken();
  const expiresAt = new Date(Date.now() + DAYS * 86400000).toISOString();
  await db('PATCH', `reports?id=eq.${enc(r.id)}`, { body: { share_token: token, share_expires_at: expiresAt } });
  return { token, path: `/share.html?t=${token}`, expiresAt };
});
