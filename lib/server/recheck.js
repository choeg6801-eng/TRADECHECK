// 관심 거래처 재평가 — 화면의 '다시 확인' 버튼과 매일 도는 예약 작업(api/cron/recheck)이 함께 씁니다.
// 재평가는 조회 한도를 차감하지 않습니다.
import { db, enc } from './core.js';
import { getProvider } from '../providers/index.js';
import { buildReport } from '../engine.js';
import { emailEnabled } from './notify.js';

const markError = async (item, error) => {
  await db('PATCH', `watchlist?id=eq.${enc(item.id)}`, { body: { checked_at: new Date().toISOString(), last_error: String(error).slice(0, 300) } }).catch(() => {});
  return { ...item, error };
};

// 재평가는 조회 한도를 차감하지 않으므로, 같은 거래처를 1시간 안에 다시 확인하면 외부 API를 부르지 않습니다.
export async function recheckItem(item, { minIntervalMin = 60 } = {}) {
  const interval = item.last_error ? Math.min(minIntervalMin, 10) : minIntervalMin; // 실패한 건은 10분 뒤부터 다시 시도
  if (item.checked_at && Date.now() - new Date(item.checked_at).getTime() < interval * 60000 && (item.last_report_id || item.last_error)) {
    return { ...item, changed: false, recent: true };
  }
  const provider = getProvider();
  let profile;
  try { profile = await provider.getProfile(item.company_id, { allowPaid: true }); }
  catch (e) { return markError(item, e.message || 'fetch_failed'); }
  if (!profile) return markError(item, 'not_found');
  const report = buildReport(profile, { providerLabel: provider.PROVIDER_LABEL });
  const changed = item.last_grade && item.last_grade !== report.grade;
  const now = new Date().toISOString();
  let reportId = item.last_report_id;
  if (changed || !reportId) {
    const [row] = await db('POST', 'reports', {
      prefer: 'return=representation',
      body: { user_id: item.user_id, query: '관심 거래처 재평가', company_id: report.company.id, company_name: report.company.name, country: report.company.country, grade: report.grade, risk_points: report.riskPoints, result: report },
    });
    reportId = row.id;
  }
  const patch = {
    last_grade: report.grade,
    checked_at: now,
    last_report_id: reportId,
    last_error: null,
    ...(changed ? { prev_grade: item.last_grade, changed_at: now, alert_pending: emailEnabled() } : {}),
  };
  const [updated] = await db('PATCH', `watchlist?id=eq.${enc(item.id)}`, { prefer: 'return=representation', body: patch });
  return { ...updated, changed: Boolean(changed) };
}
