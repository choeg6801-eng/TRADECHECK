// 내 요금제 · 남은 조회 수 · 결제 내역 · 받은 팀 초대
import { route, isLive, requireUser, db, rpc, enc, HttpError } from '../lib/server/core.js';
import { loadAccount, summarize } from '../lib/server/account.js';

// 이전 버전 호환 (테스트·다른 모듈에서 사용)
export const summarizeProfile = (p) => summarize(p);

export default route(['GET'], async (req) => {
  if (!isLive()) throw new HttpError(400, '데모 모드입니다.');
  const user = await requireUser(req);
  const acc = await loadAccount(user);
  const orders = await db('GET', `orders?user_id=eq.${enc(user.id)}&status=eq.paid&select=id,product_id,amount,method,approved_at&order=approved_at.desc&limit=20`);
  // 활성 Team 소유자에게서 온 초대만 (이미 그 팀에서 쓰는 중이면 표시하지 않음)
  const invite = acc.summary.role === 'member' ? null : await rpc('pending_invite', { p_user: user.id }).catch(() => null);
  return { profile: acc.summary, orders, invite };
});
