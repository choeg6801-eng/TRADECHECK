// 매일 실행되는 예약 작업: Team 요금제(소유자·멤버)의 관심 거래처를 다시 평가하고,
// 등급이 바뀐 거래처를 사람별로 묶어 이메일로 알립니다. (RESEND_API_KEY 설정 시)
// vercel.json 의 crons 설정으로 호출되며, CRON_SECRET 이 맞아야 실행됩니다.
// 시간 제한 안에서 오래 확인하지 않은 거래처부터 처리하고, 남은 건 다음 실행 때 이어서 합니다.
import { route, env, isLive, rpc, db, enc, HttpError } from '../../lib/server/core.js';
import { recheckItem } from '../../lib/server/recheck.js';
import { sendEmail, gradeChangeEmail, emailEnabled } from '../../lib/server/notify.js';

// 함수 최대 실행 시간(60초) - 조회 1건 최대 시간 - 여유 5초 안에서만 새 거래처를 시작
const BUDGET_MS = Number(process.env.CRON_BUDGET_MS || Math.max(10000, 60000 - Number(process.env.LIVE_DEADLINE_MS || 20000) - 5000));
const CONCURRENCY = 4;

export default route(['GET'], async (req) => {
  const { cronSecret } = env();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) throw new HttpError(401, 'unauthorized');
  if (!isLive()) return { skipped: 'demo' };
  const started = Date.now();
  const items = (await rpc('watchlist_due', { p_limit: 300 })) || [];
  const pendingByEmail = new Map(); // 알림 보낼 거래처 (이번에 바뀐 것 + 지난번에 못 보낸 것)
  const queue = (email, row) => {
    if (!email) return;
    if (!pendingByEmail.has(email)) pendingByEmail.set(email, []);
    pendingByEmail.get(email).push(row);
  };
  let checked = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < items.length && Date.now() - started < BUDGET_MS) {
      const item = items[next++];
      try {
        const r = await recheckItem(item, { minIntervalMin: 600 });
        checked++;
        if (r.changed || (item.alert_pending && !r.error)) queue(item.email, { ...item, ...r });
      } catch (e) {
        failed++;
        console.error('recheck failed', item.id, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 메일은 보낸 뒤에만 '대기' 표시를 지움 → 실패하면 다음 실행 때 다시 보냄
  let emailed = 0;
  if (emailEnabled()) {
    for (const [to, list] of pendingByEmail) {
      try {
        await sendEmail({ to, ...gradeChangeEmail(list) });
        emailed++;
        const ids = list.map((x) => x.id).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
        if (ids.length) await db('PATCH', `watchlist?id=in.(${ids.join(',')})`, { body: { alert_pending: false, alerted_at: new Date().toISOString() } });
      } catch (e) { console.error('alert email failed', to, e.message); }
    }
  }
  const changed = [...pendingByEmail.values()].reduce((a, l) => a + l.length, 0);
  return { due: items.length, checked, failed, changed, emailed, remaining: items.length - checked - failed };
});
