// 바이어 조회: 후보 검색(무료) → 사용자가 회사를 고르면 조회 1건 차감 → 데이터 수집 → 리포트 생성·저장
// 유료 데이터(제재 명단·신용평가)는 한도를 먼저 차감한 뒤에만 부르고, 실패하면 차감을 되돌립니다.
import { route, body, isLive, requireUser, rpc, db, enc, HttpError } from '../lib/server/core.js';
import { getProvider } from '../lib/providers/index.js';
import { buildReport } from '../lib/engine.js';
import { loadAccount } from '../lib/server/account.js';

const PER_MINUTE = Number(process.env.SEARCH_RATE_PER_MIN || 12);

export default route(['POST'], async (req) => {
  const { query = '', companyId = null, country = '', autoPick = false } = await body(req);
  const live = isLive();
  const user = live ? await requireUser(req) : null;
  const provider = getProvider();
  const q = String(query ?? '').trim().slice(0, 200);
  const opts = { country: String(country || '').slice(0, 40), allowPaid: live }; // 데모 모드에서는 무료 출처만

  if (companyId != null && (typeof companyId !== 'string' || companyId.length > 1000)) throw new HttpError(400, '잘못된 회사 정보입니다.');

  let id = companyId;
  if (!id) {
    if (q.length < 2) throw new HttpError(400, '회사명, 사업자번호 또는 URL을 2자 이상 입력해 주세요.');
    // 남은 조회가 없는 사용자는 후보 검색에서도 유료 출처를 부르지 않음
    let searchOpts = opts;
    if (live) {
      const s = (await loadAccount(user)).summary;
      if (s.periodRemaining + s.credits <= 0) searchOpts = { ...opts, allowPaid: false };
    }
    const candidates = await provider.searchCompanies(q, searchOpts);
    if (!candidates.length) throw new HttpError(404, '일치하는 회사를 찾지 못했습니다. 영문 회사명이나 웹사이트 주소로 다시 검색해 보세요.');
    // 사용자가 직접 검색 버튼을 누른 경우(autoPick)에만 후보 1곳을 바로 조회합니다.
    // 링크로 열린 검색(?q=)은 항상 후보를 보여 주어, 링크만으로 조회 건수가 차감되지 않게 합니다.
    if (candidates.length > 1 || !autoPick) return { candidates };
    id = candidates[0].id;
  }

  if (!live) {
    const profile = await provider.getProfile(id, opts);
    if (!profile) throw new HttpError(404, '회사 정보를 불러오지 못했습니다.');
    const report = buildReport(profile, { providerLabel: provider.PROVIDER_LABEL, id: 'demo-' + Date.now().toString(36) });
    return { report, usage: { source: 'demo' } };
  }

  // 짧은 시간에 과도한 조회 방지 (유료 API 비용 보호)
  const since = new Date(Date.now() - 60000).toISOString();
  const recent = await db('GET', `reports?user_id=eq.${enc(user.id)}&created_at=gte.${enc(since)}&select=id`);
  if (recent.length >= PER_MINUTE) throw new HttpError(429, '잠시 후 다시 조회해 주세요. (1분에 최대 ' + PER_MINUTE + '건)');

  const usage = await rpc('consume_search', { p_user: user.id });
  if (!usage?.ok) {
    throw new HttpError(402, '이번 달 조회 한도를 모두 사용했습니다. 요금제를 올리거나 추가 조회를 구매해 주세요.', { code: 'quota', plan: usage?.plan });
  }

  try {
    const profile = await provider.getProfile(id, opts);
    if (!profile) throw new HttpError(404, '회사 정보를 불러오지 못했습니다. 차감된 조회 건수는 되돌렸습니다.');
    const report = buildReport(profile, { providerLabel: provider.PROVIDER_LABEL });
    const [row] = await db('POST', 'reports', {
      prefer: 'return=representation',
      body: {
        user_id: user.id,
        query: q,
        company_id: report.company.id,
        company_name: report.company.name,
        country: report.company.country,
        grade: report.grade,
        risk_points: report.riskPoints,
        result: report,
      },
    });
    report.id = row.id;
    return { report, usage };
  } catch (err) {
    await rpc('refund_search', { p_user: user.id, p_source: usage.source, p_payer: usage.payer || null }).catch(() => {});
    throw err;
  }
});
