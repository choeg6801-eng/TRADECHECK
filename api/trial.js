// Team 14일 무료 체험 시작 (계정당 1회, 카드 등록 없음)
import { route, isLive, requireUser, rpc, HttpError } from '../lib/server/core.js';

export default route(['POST'], async (req) => {
  if (!isLive()) throw new HttpError(400, '데모 모드입니다.');
  const user = await requireUser(req);
  const r = await rpc('start_team_trial', { p_user: user.id, p_days: 14 });
  if (!r?.ok) {
    const msg = r?.reason === 'used' ? '무료 체험은 계정당 한 번만 사용할 수 있습니다.' : '이미 유료 요금제를 이용 중입니다.';
    throw new HttpError(409, msg, { code: r?.reason });
  }
  return { ok: true, expiresAt: r.expires_at };
});
