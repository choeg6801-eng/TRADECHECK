// 계정 요약: 본인 프로필 + (Team 멤버라면) 소유자의 요금제를 합쳐 '실제로 쓰는 요금제'를 계산합니다.
import { db, enc } from './core.js';
import { PLANS } from '../products.js';

const isActive = (p) => Boolean(p && p.plan !== 'free' && p.plan_expires_at && new Date(p.plan_expires_at) > new Date());

export async function loadProfile(user) {
  let rows = await db('GET', `profiles?id=eq.${enc(user.id)}&select=*`);
  if (!rows.length) rows = await db('POST', 'profiles?on_conflict=id', { prefer: 'resolution=ignore-duplicates,return=representation', body: { id: user.id, email: user.email } });
  if (!rows.length) rows = await db('GET', `profiles?id=eq.${enc(user.id)}&select=*`);
  return rows[0];
}

export async function loadAccount(user) {
  const me = await loadProfile(user);
  let ownerRow = null;
  if (me.team_owner) [ownerRow] = await db('GET', `profiles?id=eq.${enc(me.team_owner)}&select=*`);
  const teamActive = Boolean(ownerRow && ownerRow.plan === 'team' && isActive(ownerRow) && !ownerRow.team_owner);
  // DB의 payer_of 와 같은 규칙: 본인 유효 요금제 → 활성 Team 소유자 → 본인
  const owner = !isActive(me) && teamActive ? ownerRow : null;
  const payer = owner || me;
  const summary = summarize(me, payer, owner);
  summary.teamOwnerId = me.team_owner || null;
  summary.teamOwnerEmail = ownerRow?.email || null;
  summary.teamActive = teamActive;
  if (me.team_owner && !owner) summary.role = 'stale'; // 팀 연결은 남아 있지만 지금은 본인 요금제·무료로 사용 중
  return { me, owner, payer, summary };
}

export function summarize(me, payer = me, owner = null) {
  const active = isActive(payer);
  const plan = PLANS[active ? payer.plan : 'free'];
  const periodExpired = Date.now() - new Date(payer.period_start).getTime() >= 30 * 86400000;
  const used = periodExpired ? 0 : payer.period_used;
  return {
    email: me.email,
    plan: plan.id,
    planLabel: plan.label + (active && payer.is_trial ? ' 체험' : ''),
    planExpiresAt: active ? payer.plan_expires_at : null,
    isTrial: Boolean(active && payer.is_trial),
    monthlyQuota: plan.monthlyQuota,
    periodUsed: plan.monthlyQuota ? used : 0,
    periodRemaining: Math.max(plan.monthlyQuota - used, 0),
    credits: me.credits + (owner ? owner.credits : 0),
    watchLimit: plan.watchLimit,
    alerts: plan.alerts,
    trialUsed: Boolean(me.trial_used),
    role: owner ? 'member' : plan.id === 'team' ? 'owner' : 'solo',
    teamOwnerEmail: owner ? owner.email : null,
  };
}

// 같은 팀(소유자 + 멤버)의 사용자 id 목록. 팀이 아니거나 소유자의 Team 요금제가 끝났으면 본인만.
export async function teamUserIds(me) {
  const self = [{ id: me.id, email: me.email }];
  let rootId = me.id;
  if (me.team_owner && !isActive(me)) rootId = me.team_owner; // 본인 요금제를 쓰는 동안은 팀 공유에서 빠짐
  else if (me.team_owner) return self;
  const root = rootId === me.id ? me : (await db('GET', `profiles?id=eq.${enc(rootId)}&select=*`))[0];
  if (!root || root.plan !== 'team' || !isActive(root) || (rootId !== me.id && root.team_owner)) return self;
  const rows = await db('GET', `profiles?or=(id.eq.${enc(rootId)},team_owner.eq.${enc(rootId)})&select=id,email`);
  return rows.some((r) => r.id === me.id) ? rows : [...rows, ...self];
}
