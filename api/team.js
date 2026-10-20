// Team 좌석: 멤버 목록 · 초대 · 초대 수락 · 내보내기/나가기
// Team 요금제 소유자 포함 최대 5명. 멤버는 소유자의 월 조회 한도를 함께 쓰고, 서로의 조회 기록을 볼 수 있습니다.
import { route, body, isLive, requireUser, db, rpc, enc, query, HttpError } from '../lib/server/core.js';
import { loadAccount } from '../lib/server/account.js';
import { sendEmail, emailEnabled } from '../lib/server/notify.js';

const UUID = /^[0-9a-f-]{36}$/i;
const REASONS = {
  email: '이메일 주소 형식을 확인해 주세요.',
  plan: '팀원 초대는 Team 요금제(체험 포함)에서 할 수 있습니다.',
  member: '다른 팀의 멤버는 초대할 수 없습니다. 팀 소유자에게 요청하세요.',
  self: '본인은 초대할 수 없습니다.',
  exists: '이미 초대한 이메일입니다.',
  seats: '좌석이 모두 찼습니다. (소유자 포함 5명)',
  no_invite: '수락할 수 있는 초대가 없습니다. 초대가 취소되었거나 팀 요금제가 끝났을 수 있습니다.',
  already: '이미 다른 팀에 속해 있습니다. 먼저 팀에서 나가 주세요.',
  owner: '팀원이 있는 소유자 계정은 다른 팀에 합류할 수 없습니다.',
  forbidden: '권한이 없습니다.',
  unconfirmed: '이메일 인증을 마친 뒤 초대를 수락할 수 있습니다. 메일함의 인증 링크를 눌러 주세요.',
  own_plan: '지금 결제한 본인 요금제를 쓰는 중이라 팀에 합류할 수 없습니다. 요금제 기간이 끝난 뒤 수락해 주세요.',
  rate: '초대는 하루 20건까지 보낼 수 있습니다. 내일 다시 시도해 주세요.',
};
const fail = (r, status = 409) => new HttpError(status, REASONS[r?.reason] || '처리하지 못했습니다.', { code: r?.reason });

export default route(['GET', 'POST', 'DELETE'], async (req) => {
  if (!isLive()) throw new HttpError(400, '데모 모드에서는 팀 기능을 쓸 수 없습니다.');
  const user = await requireUser(req);
  const acc = await loadAccount(user);

  if (req.method === 'GET') {
    if (acc.summary.role === 'member' || acc.summary.role === 'stale') return { role: acc.summary.role, ownerEmail: acc.summary.teamOwnerEmail, active: acc.summary.teamActive };
    const members = await db('GET', `profiles?team_owner=eq.${enc(user.id)}&select=id,email,created_at&order=created_at.asc`);
    const invites = await db('GET', `team_invites?owner_id=eq.${enc(user.id)}&accepted_at=is.null&select=id,email,created_at&order=created_at.asc`);
    return { role: acc.summary.plan === 'team' ? 'owner' : 'solo', members, invites, seats: 5 };
  }

  if (req.method === 'DELETE') {
    const q = query(req);
    const member = q.get('member');
    const invite = q.get('invite');
    if ((member && !UUID.test(member)) || (invite && !UUID.test(invite)) || (!member && !invite)) throw new HttpError(400, '잘못된 요청입니다.');
    const r = await rpc('remove_team_member', { p_actor: user.id, p_member: member || null, p_invite: invite || null });
    if (!r?.ok) throw fail(r, 403);
    return { ok: true };
  }

  const { action, email } = await body(req);
  if (action === 'invite') {
    const to = String(email || '').trim().toLowerCase().slice(0, 200);
    const r = await rpc('invite_team_member', { p_owner: user.id, p_email: to });
    if (!r?.ok) throw fail(r);
    let emailed = false;
    if (emailEnabled()) {
      const site = (process.env.SITE_URL || '').replace(/\/$/, '');
      const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      await sendEmail({
        to,
        subject: `[Trade Checker] ${acc.me.email || '동료'}님이 팀에 초대했습니다`,
        html: `<div style="font-family:system-ui,sans-serif;color:#0B1A2E;max-width:520px"><h2 style="font-size:18px">Trade Checker 팀 초대</h2><p>${esc(acc.me.email || '')}님이 해외 바이어 신용 검증 서비스 Trade Checker의 Team 요금제에 초대했습니다.</p><p>이 이메일 주소(${esc(to)})로 가입하거나 로그인한 뒤, 화면 위쪽의 <b>초대 수락</b>을 눌러 주세요.</p>${site ? `<p><a href="${esc(site)}/login.html?mode=signup" style="display:inline-block;background:#1D5BD6;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">가입·로그인하기</a></p>` : ''}<p style="color:#8a95a5;font-size:12px">초대를 원하지 않으면 이 메일을 무시하세요. 수락하기 전에는 아무것도 공유되지 않습니다.</p></div>`,
      }).then(() => (emailed = true)).catch((e) => console.error('invite email failed', e.message));
    }
    return { ok: true, emailed };
  }
  if (action === 'accept') {
    const r = await rpc('accept_team_invite', { p_user: user.id });
    if (!r?.ok) throw fail(r);
    return { ok: true };
  }
  if (action === 'decline') {
    await rpc('decline_team_invite', { p_user: user.id });
    return { ok: true };
  }
  if (action === 'leave') {
    const r = await rpc('remove_team_member', { p_actor: user.id, p_member: user.id, p_invite: null });
    if (!r?.ok) throw fail(r);
    return { ok: true };
  }
  throw new HttpError(400, '알 수 없는 요청입니다.');
});
