// 무역 안전 등급 산정 엔진 — 브라우저와 서버가 같은 파일을 씁니다.
// 공급자(lib/providers/*)가 넘겨준 Profile을 받아 위험 점수 → A~F 등급 → 결제 조건 가이드를 만듭니다.
// 가중치는 아래 RULES 한곳에 모여 있어 사내 여신 정책에 맞게 조정할 수 있습니다.

export const ENGINE_VERSION = '2026.10-2';

export const RULES = {
  thresholds: { A: 8, B: 24, C: 44, D: 69 }, // 위험 점수 이하이면 해당 등급, 초과하면 F
  identity: { under1y: 20, under3y: 8, domainMismatch: 20, addressUnverified: 8, entityInactive: 25, freeMail: 10, domainUnder6m: 15, domainUnder1y: 6, domainUnregistered: 20 },
  sanctions: { watch: 5 }, // 제재·수출통제 일치는 점수와 상관없이 F
  legal: { perFiling: 6, filingsCap: 18, insolvency: 15 },
  // 데이터 충실도: 6개 영역(기업 식별·제재/사기·통관·소송·파산·신용) 중 확인된 영역 수에 따라 최고 등급을 제한
  coverage: { minForA: 5, minForB: 3 }, // 5개 미만이면 최고 B, 3개 미만이면 최고 C
  customs: { none12m: 22, under6: 8, stale180d: 8, noData: 6 },
  courts: { openPayment: 12, openPaymentCap: 24, closedPayment: 5, closedPaymentCap: 10, contract: 3, recentYears: 5 },
  insolvency: { active: 30, closedRecent: 15 },
  credit: { under40: 18, under60: 8, unknown: 5 },
  fraud: { reported: 15 }, // confirmed·impersonation 은 점수와 상관없이 F
};

export const GRADES = {
  A: { label: '안정', color: '#1D5BD6' },
  B: { label: '양호', color: '#5B8BD0' },
  C: { label: '주의', color: '#D98A1C' },
  D: { label: '위험', color: '#C2531F' },
  F: { label: '경보', color: '#8E2418' },
};

const usd = (n) => 'USD ' + Number(n).toLocaleString('en-US');

function monthLabels(now) {
  const out = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${String(m.getFullYear()).slice(2)}.${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function score(profile, now = new Date()) {
  const R = RULES;
  const year = now.getFullYear();
  const signals = [];
  let points = 0;
  const add = (key, pts, s) => {
    points += pts;
    signals.push({ key, points: pts, ...s });
  };

  // 1. 기업 실체
  const c = profile.company;
  const age = c.founded ? year - c.founded : null;
  if (age == null) add('age', 0, { group: '기업 식별', label: '설립 연도', value: '확인 불가', level: 'info' });
  else if (age < 1) add('age', R.identity.under1y, { group: '기업 식별', label: '설립 연도', value: `${c.founded}년 · 1년 미만`, level: 'danger', detail: '설립 1년 미만 법인은 거래 이력이 부족해 위험도가 높습니다.' });
  else if (age < 3) add('age', R.identity.under3y, { group: '기업 식별', label: '설립 연도', value: `${c.founded}년 · ${age}년 차`, level: 'warn', detail: '설립 3년 미만 법인입니다.' });
  else add('age', 0, { group: '기업 식별', label: '설립 연도', value: `${c.founded}년 · ${age}년 차`, level: 'ok' });

  const idn = profile.identity || {};
  const dinfo = profile.domainInfo || null;
  if (idn.domainMatchesCompany === false) add('domain', R.identity.domainMismatch, { group: '기업 식별', label: '도메인 일치', value: '불일치', level: 'danger', detail: '웹사이트 도메인 정보가 등기상 법인 정보와 다릅니다.' });
  else if (idn.domainMatchesCompany === true) add('domain', 0, { group: '기업 식별', label: '도메인 일치', value: '일치', level: 'ok' });
  else if (!dinfo?.freeMail) add('domain', 0, { group: '기업 식별', label: '도메인 일치', value: c.domain ? '회사명과 연관 확인 안 됨' : '웹사이트 미입력', level: 'info', detail: c.domain ? '도메인 이름에 회사명이 들어 있지 않습니다. 공식 웹사이트가 맞는지 확인하세요.' : '바이어 웹사이트나 이메일 주소로 조회하면 도메인 개설 시기도 확인합니다.' });
  if (idn.addressVerified === false) add('address', R.identity.addressUnverified, { group: '기업 식별', label: '등기 주소', value: '확인 안 됨', level: 'warn', detail: '등기 주소를 공개 기록으로 확인하지 못했습니다.' });
  else if (idn.addressVerified === true) add('address', 0, { group: '기업 식별', label: '등기 주소', value: '확인됨', level: 'ok' });
  else add('address', 0, { group: '기업 식별', label: '법인 등기', value: '공개 등기에서 찾지 못함', level: 'info', detail: '중소 바이어는 국제 등록부(LEI)에 없는 경우가 많습니다. 사업자등록증(Trade License) 사본을 요청해 현지 등기와 대조하세요.' });

  const regi = profile.registry;
  if (regi?.entityStatus === 'INACTIVE') add('registry', R.identity.entityInactive, { group: '기업 식별', label: '법인 상태', value: '비활성 (등록부 기준)', level: 'danger', detail: '국제 법인 등록부(GLEIF)에 비활성 법인으로 기록되어 있습니다. 폐업·합병 여부를 확인하세요.' });
  else if (regi?.entityStatus === 'ACTIVE') add('registry', 0, { group: '기업 식별', label: '법인 상태', value: regi.registrationStatus === 'ISSUED' ? '활성 · LEI 유효' : '활성 · LEI 갱신 안 됨', level: 'ok', detail: regi.lei ? `LEI ${regi.lei}` : '' });

  if (dinfo?.notRegistered) add('domain-age', R.identity.domainUnregistered, { group: '기업 식별', label: '웹사이트 도메인', value: `등록되지 않은 도메인 (${dinfo.domain})`, level: 'danger', detail: '바이어가 알려 준 웹사이트·이메일 도메인이 실제로 등록되어 있지 않습니다. 주소 오타가 아니라면 가짜 회사일 가능성이 큽니다.' });
  else if (dinfo?.notFound) add('domain-age', 0, { group: '기업 식별', label: '웹사이트 개설 시기', value: '확인 불가', level: 'info', detail: '이 국가 도메인은 등록 정보가 공개되지 않습니다.' });
  else if (dinfo?.freeMail) add('domain-age', R.identity.freeMail, { group: '기업 식별', label: '연락 이메일', value: `무료 메일 (${dinfo.domain})`, level: 'warn', detail: '회사 도메인이 아닌 무료 메일로 거래하는 바이어는 사칭·사기 사례가 많습니다. 공식 도메인 메일로 연락을 요청하세요.' });
  else if (dinfo?.ageDays != null) {
    const months = Math.floor(dinfo.ageDays / 30.4);
    const v = `${dinfo.registeredAt.slice(0, 10)} 개설 · ${months < 12 ? `${months}개월` : `${Math.floor(months / 12)}년`} 전`;
    if (dinfo.ageDays < 183) add('domain-age', R.identity.domainUnder6m, { group: '기업 식별', label: '웹사이트 개설 시기', value: v, level: 'danger', detail: '최근 6개월 안에 만든 도메인입니다. 유명 회사를 흉내 낸 가짜 도메인에서 흔히 보이는 신호입니다.' });
    else if (dinfo.ageDays < 365) add('domain-age', R.identity.domainUnder1y, { group: '기업 식별', label: '웹사이트 개설 시기', value: v, level: 'warn', detail: '1년이 안 된 도메인입니다.' });
    else add('domain-age', 0, { group: '기업 식별', label: '웹사이트 개설 시기', value: v, level: 'ok' });
  }

  // 2. 통관 이력
  const cov = profile.coverage || {};
  const cu = profile.customs;
  if (!cu || cov.customs === false) {
    add('customs', R.customs.noData, { group: '관세 통관', label: '최근 12개월 통관', value: '정보 제한', level: 'info', detail: '해당 국가의 통관 데이터가 제한적입니다.' });
  } else {
    const total = cu.monthly.reduce((a, b) => a + b, 0);
    if (total === 0) add('customs', R.customs.none12m, { group: '관세 통관', label: '최근 12개월 통관', value: '기록 없음', level: 'danger', detail: '실제 수입 활동이 확인되지 않습니다. 페이퍼 컴퍼니 가능성을 점검하세요.' });
    else if (total < 6) add('customs', R.customs.under6, { group: '관세 통관', label: '최근 12개월 통관', value: `${total}건`, level: 'warn', detail: '수입 실적이 적어 거래 규모 대비 검증이 필요합니다.' });
    else add('customs', 0, { group: '관세 통관', label: '최근 12개월 통관', value: `${total}건`, level: 'ok' });
    if (cu.lastShipmentDaysAgo != null && cu.lastShipmentDaysAgo > 180) add('customs-stale', R.customs.stale180d, { group: '관세 통관', label: '최근 통관일', value: `${cu.lastShipmentDaysAgo}일 전`, level: 'warn', detail: '6개월 넘게 통관 기록이 없습니다.' });
    else if (cu.lastShipmentDaysAgo != null) add('customs-stale', 0, { group: '관세 통관', label: '최근 통관일', value: `${cu.lastShipmentDaysAgo}일 전`, level: 'ok' });
  }

  // 3. 법적 분쟁
  const courts = profile.courts || [];
  const recent = courts.filter((x) => year - x.year <= R.courts.recentYears);
  const openPay = recent.filter((x) => x.kind === 'payment' && x.status === 'open');
  const closedPay = recent.filter((x) => x.kind === 'payment' && x.status === 'closed');
  const contract = recent.filter((x) => x.kind !== 'payment');
  const legal = profile.legal || null;
  if (cov.courts === false) add('courts', 0, { group: '법적 분쟁', label: '대금 관련 소송', value: '정보 제한', level: 'info' });
  else if (legal && !courts.length) {
    const n = legal.filings || 0;
    if (n) add('courts-open', Math.min(n * R.legal.perFiling, R.legal.filingsCap), { group: '법적 분쟁', label: '법적 기록 (소송·판결)', value: `${n}건`, level: 'warn', detail: '신용평가 리포트에 법적 기록이 있습니다. 원문 리포트에서 금액·진행 상태를 확인하세요.' });
    else add('courts-open', 0, { group: '법적 분쟁', label: '법적 기록 (소송·판결)', value: '없음', level: 'ok' });
  } else {
    const p1 = Math.min(openPay.length * R.courts.openPayment, R.courts.openPaymentCap);
    const p2 = Math.min(closedPay.length * R.courts.closedPayment, R.courts.closedPaymentCap);
    const p3 = contract.length * R.courts.contract;
    if (openPay.length) add('courts-open', p1, { group: '법적 분쟁', label: '진행 중인 대금 소송', value: `${openPay.length}건 · ${usd(openPay.reduce((a, b) => a + (b.amountUSD || 0), 0))}`, level: 'danger', detail: '다른 공급사와 대금 문제로 다투고 있습니다.' });
    else add('courts-open', 0, { group: '법적 분쟁', label: '진행 중인 대금 소송', value: '없음', level: 'ok' });
    if (closedPay.length) add('courts-closed', p2, { group: '법적 분쟁', label: `종결된 대금 소송 (최근 ${R.courts.recentYears}년)`, value: `${closedPay.length}건`, level: 'warn' });
    if (contract.length) add('courts-other', p3, { group: '법적 분쟁', label: '기타 계약 분쟁', value: `${contract.length}건`, level: 'info' });
  }

  // 4. 파산·회생
  const ins = profile.insolvency || [];
  const active = ins.filter((x) => x.status === 'active');
  const closedRecent = ins.filter((x) => x.status !== 'active' && year - x.year <= 5);
  if (cov.insolvency === false) add('insolvency', 0, { group: '파산·회생', label: '파산·회생 기록', value: '정보 제한', level: 'info' });
  else if (legal && !ins.length) {
    if (legal.insolvencies) add('insolvency', R.legal.insolvency, { group: '파산·회생', label: '파산·회생 기록', value: `${legal.insolvencies}건`, level: 'danger', detail: '신용평가 리포트에 파산·회생 기록이 있습니다. 진행 중인지 원문에서 확인하세요.' });
    else add('insolvency', 0, { group: '파산·회생', label: '파산·회생 기록', value: '없음', level: 'ok' });
  }
  else if (active.length) add('insolvency', R.insolvency.active, { group: '파산·회생', label: '파산·회생 기록', value: `진행 중 (${active[0].year}년 ${active[0].kind === 'bankruptcy' ? '파산' : '회생'})`, level: 'danger', detail: '법정 절차가 진행 중이라 대금 회수가 제한될 수 있습니다.' });
  else if (closedRecent.length) add('insolvency', R.insolvency.closedRecent, { group: '파산·회생', label: '파산·회생 기록', value: `최근 5년 내 ${closedRecent.length}건 (종결)`, level: 'warn' });
  else add('insolvency', 0, { group: '파산·회생', label: '파산·회생 기록', value: '없음', level: 'ok' });

  // 5. 신용평가
  const cr = profile.credit || {};
  if (cr.score == null || cov.credit === false) add('credit', R.credit.unknown, { group: '신용평가', label: '신용 점수', value: '정보 없음', level: 'info', detail: '신용평가 데이터가 없어 보수적으로 반영했습니다.' });
  else if (cr.score < 40) add('credit', R.credit.under40, { group: '신용평가', label: '신용 점수', value: `${cr.score} / 100`, level: 'danger' });
  else if (cr.score < 60) add('credit', R.credit.under60, { group: '신용평가', label: '신용 점수', value: `${cr.score} / 100`, level: 'warn' });
  else add('credit', 0, { group: '신용평가', label: '신용 점수', value: `${cr.score} / 100`, level: 'ok' });

  // 6. 무역 사기
  const fraud = profile.fraud || [];
  const hard = fraud.filter((f) => f.kind === 'confirmed' || f.kind === 'impersonation');
  const soft = fraud.filter((f) => f.kind === 'reported');
  const sanc = profile.sanctions || [];
  const sancHard = sanc.filter((h) => h.severity === 'sanction');
  const sancWatch = sanc.filter((h) => h.severity === 'watch');
  if (cov.sanctions === false) add('sanctions', 0, { group: '무역 사기', label: '제재·수출통제 명단', value: '확인 안 함', level: 'info', detail: '제재 명단 검색이 연결되지 않았습니다.' });
  else if (sancHard.length) add('sanctions', 0, { group: '무역 사기', label: '제재·수출통제 명단', value: sancHard.map((h) => `${h.name} (일치도 ${Math.round(h.score * 100)}%)`).join(' / '), level: 'danger', detail: '제재·수출통제 대상과 이름이 일치합니다. 거래 시 법적 제재를 받을 수 있어 등급을 F로 고정합니다. 동명이인일 수 있으니 등록번호·주소를 대조하세요.', link: sancHard[0].url });
  else if (sancWatch.length) add('sanctions', R.sanctions.watch, { group: '무역 사기', label: '제재·수출통제 명단', value: `관찰 대상 ${sancWatch.length}건`, level: 'warn', detail: '공개 위험 명단에 비슷한 이름이 있습니다. 세부 내용을 확인하세요.', link: sancWatch[0].url });
  else if (profile.sanctions && sanc.length) add('sanctions', 0, { group: '무역 사기', label: '제재·수출통제 명단', value: '제재 대상 아님 · 사기 관련 명단 일치', level: 'warn', detail: '제재 대상은 아니지만 사기·범죄 관련 공개 명단에 비슷한 이름이 있습니다. 아래 사기 신고 항목을 확인하세요.', link: sanc[0].url });
  else if (profile.sanctions) add('sanctions', 0, { group: '무역 사기', label: '제재·수출통제 명단', value: '일치 없음', level: 'ok' });
  if (hard.length) add('fraud', 0, { group: '무역 사기', label: '사기·사칭 이력', value: hard.map((f) => f.note).join(' / '), level: 'danger', detail: '확인된 사기·사칭 이력이 있어 등급을 F로 고정합니다.' });
  else if (soft.length) add('fraud', R.fraud.reported, { group: '무역 사기', label: '사기 신고', value: `${soft.length}건 (확인 중)`, level: 'warn', detail: soft[0].note });
  else if (cov.sanctions === false) { /* 사기·제재 출처가 없으면 '없음'으로 단정하지 않음 */ }
  else add('fraud', 0, { group: '무역 사기', label: '사기 신고 이력', value: '없음', level: 'ok' });
  if (idn.impersonates) signals.push({ key: 'impersonation', points: 0, group: '무역 사기', label: '사칭 의심', value: idn.impersonates, level: 'danger' });

  const t = RULES.thresholds;
  let grade = points <= t.A ? 'A' : points <= t.B ? 'B' : points <= t.C ? 'C' : points <= t.D ? 'D' : 'F';
  if (hard.length || idn.impersonates || sancHard.length) grade = 'F';

  // 데이터 충실도에 따른 등급 상한 — 확인하지 못한 것을 '문제없음'으로 보지 않기 위해
  const coverage = coverageOf(profile);
  let capped = null;
  const order = ['A', 'B', 'C', 'D', 'F'];
  const cap = coverage.covered < R.coverage.minForB ? 'C' : coverage.covered < R.coverage.minForA ? 'B' : 'A';
  if (order.indexOf(grade) < order.indexOf(cap)) { capped = { from: grade, to: cap }; grade = cap; }
  if (capped) signals.push({ key: 'coverage', points: 0, group: '데이터 충실도', label: '확인된 영역', value: `${coverage.covered} / ${coverage.total}개 영역`, level: 'info', detail: `확인하지 못한 영역(${coverage.missing.join(', ')})이 있어 등급을 ${capped.from}에서 ${capped.to}로 보수적으로 낮췄습니다.` });
  return { grade, points, signals, coverage, capped };
}

export const COVERAGE_AREAS = [
  ['identity', '기업 식별'],
  ['sanctions', '제재·사기 명단'],
  ['customs', '통관 실적'],
  ['courts', '소송'],
  ['insolvency', '파산·회생'],
  ['credit', '신용점수'],
];

export function coverageOf(profile) {
  const cov = profile.coverage || {};
  const ok = {
    identity: cov.identity !== false,
    sanctions: cov.sanctions !== false,
    customs: cov.customs !== false && Boolean(profile.customs),
    courts: cov.courts !== false,
    insolvency: cov.insolvency !== false,
    credit: cov.credit !== false && profile.credit?.score != null,
  };
  const items = COVERAGE_AREAS.map(([key, label]) => ({ key, label, ok: ok[key] }));
  const covered = items.filter((i) => i.ok).length;
  return { covered, total: items.length, items, missing: items.filter((i) => !i.ok).map((i) => i.label), level: covered >= 5 ? 'high' : covered >= 3 ? 'medium' : 'low' };
}

const GUIDES = {
  A: {
    primary: 'TT 후불 수락 가능',
    terms: ['T/T 후불 (B/L 후 30~60일) 수락 가능', '첫 거래 금액이 크면 선수금 10~20%를 함께 요청'],
    alternatives: ['거래가 쌓이면 여신 한도를 단계적으로 늘리세요.'],
    subject: 'Payment terms for our order',
    body: 'Thank you for your order. We are pleased to offer T/T payment within {days} days after the B/L date. Please confirm so we can proceed with production.',
  },
  B: {
    primary: '선수금 30% + 잔금 TT',
    terms: ['선수금 30% (T/T, 생산 착수 전)', '잔금 70% (선적 서류 송부 전 또는 B/L 후 30일 이내)'],
    alternatives: ['첫 거래는 소량으로 진행한 뒤 조건 완화를 검토하세요.', '무역보험(단기수출보험) 인수 가능 여부를 함께 확인하세요.'],
    subject: 'Proposed payment terms',
    body: 'Thank you for your order. For this shipment, we propose 30% advance payment by T/T before production and the remaining 70% by T/T against copy of shipping documents. We look forward to building a long-term partnership.',
  },
  C: {
    primary: 'TT 후불 대신 L/C 또는 100% 선결제',
    terms: ['취소불능 일람출급 신용장 (Irrevocable L/C at sight)', '또는 100% 선결제 (T/T in advance)'],
    alternatives: ['신용장 개설이 어렵다면 선수금 50% + 선적 전 잔금 50%', '첫 주문은 소량으로 제한하고, 순조롭게 끝나면 조건을 다시 검토'],
    subject: 'Payment terms for our first transaction',
    body: 'Thank you for your interest. For our first transaction, we kindly propose payment by an irrevocable L/C at sight, or 100% advance T/T. We would be glad to review deferred terms after a smooth first shipment.',
  },
  D: {
    primary: '100% 선결제만 수락',
    terms: ['100% 선결제 (T/T in advance) 확인 후 생산 착수'],
    alternatives: ['신용장은 확인은행이 붙은 경우(Confirmed L/C)에만 검토', '현재 진행 중인 법정 절차가 끝날 때까지 여신 거래 보류'],
    subject: 'Payment terms',
    body: 'Thank you for your inquiry. Due to our internal credit policy, we can proceed with this order on a 100% advance payment basis (T/T in advance). Production will start upon receipt of payment.',
  },
  F: {
    primary: '거래 보류 권장',
    terms: ['선결제 조건이라도 법인·은행 계좌 실재 여부 확인 전에는 진행하지 마세요.'],
    alternatives: ['사업자등록증·은행 확인서 원본을 요청하고 해당 은행에 직접 확인', '대표 연락처를 공식 등기 정보와 대조', '회사 보안 담당자 또는 KOTRA 해외무역관에 문의'],
    subject: 'Request for company verification documents',
    body: 'Thank you for your inquiry. Before we proceed, our compliance team requires a certified copy of your certificate of incorporation and a bank reference letter issued directly by your bank. We will review the documents and get back to you.',
  },
};

// 요약 문장에 쓰는 짧은 표현 (항목 + 핵심 값)
const strip = (t) => String(t || '').replace(/\s*\([^)]*\)/g, '').trim();
const firstNum = (t) => (String(t || '').match(/\d+/) || [''])[0];
function phrase(s) {
  const v = String(s.value || '');
  switch (s.key) {
    case 'age': return v.includes('1년 미만') ? '설립 1년 미만' : `설립 ${firstNum(v.split('·')[1]) || ''}년 차`;
    case 'domain': return '도메인·회사 정보 불일치';
    case 'customs': return v === '기록 없음' ? '최근 12개월 통관 없음' : `최근 12개월 통관 ${v}`;
    case 'customs-stale': return `마지막 통관 ${v}`;
    case 'courts-open': return `진행 중인 대금 소송 ${firstNum(v)}건`;
    case 'courts-closed': return `최근 종결된 대금 소송 ${firstNum(v)}건`;
    case 'insolvency': return v.startsWith('진행 중') ? '파산·회생 절차 진행 중' : '최근 파산·회생 이력';
    case 'credit': return `신용 점수 ${firstNum(v)}점`;
    case 'domain-age': return v.includes('무료 메일') ? '무료 메일 사용' : v.includes('등록되지') ? '등록되지 않은 도메인' : '최근 개설된 웹사이트';
    case 'registry': return '비활성 법인';
    case 'sanctions': return '제재·수출통제 명단 일치';
    default: return strip(s.label);
  }
}
function summarize(grade, signals) {
  const bad = signals.filter((s) => s.level === 'danger').map(phrase);
  const warn = signals.filter((s) => s.level === 'warn').map(phrase);
  if (grade === 'A') return '실거래 흔적이 꾸준하고 분쟁·파산 기록이 없습니다.';
  if (grade === 'F') return `거래를 보류해야 할 신호가 확인되었습니다: ${bad.slice(0, 3).join(', ') || '사기·사칭 정황'}.`;
  const parts = [...bad, ...warn].slice(0, 3);
  return parts.length ? `확인된 위험 신호: ${parts.join(', ')}.` : '큰 위험 신호는 없지만, 일부 정보가 제한되어 보수적으로 평가했습니다.';
}

// ---------------- 거래 조건 시뮬레이터 ----------------
// 바이어가 요청한 결제 조건으로 진행할 때 '대금을 못 받을 수 있는 금액(위험 노출액)'과
// 등급별 권장 조건으로 진행할 때를 비교합니다.
export const TERMS = {
  tt90: { label: 'T/T 후불 90일', advance: 0, secured: false },
  tt60: { label: 'T/T 후불 60일', advance: 0, secured: false },
  tt30: { label: 'T/T 후불 30일', advance: 0, secured: false },
  adv30: { label: '선수금 30% + 잔금 후불', advance: 0.3, secured: false },
  adv50: { label: '선수금 50% + 선적 전 잔금', advance: 1, secured: false },
  lc: { label: '일람출급 신용장(L/C)', advance: 0, secured: true },
  adv100: { label: '100% 선결제', advance: 1, secured: false },
};

const ACCEPTABLE = {
  A: ['tt90', 'tt60', 'tt30', 'adv30', 'adv50', 'lc', 'adv100'],
  B: ['adv30', 'adv50', 'lc', 'adv100'],
  C: ['adv50', 'lc', 'adv100'],
  D: ['adv100'],
  F: [],
};
const RECOMMENDED = { A: 'tt60', B: 'adv30', C: 'lc', D: 'adv100', F: null };

export function exposureOf(termId, amount) {
  const t = TERMS[termId];
  if (!t) return amount;
  if (t.secured) return 0; // 은행이 지급을 보증
  return Math.round(amount * (1 - t.advance));
}

export function simulateDeal(grade, amount, requestedTerm) {
  const amt = Math.max(0, Number(amount) || 0);
  const reqExposure = exposureOf(requestedTerm, amt);
  const rec = RECOMMENDED[grade];
  const recExposure = rec ? exposureOf(rec, amt) : null;
  const ok = ACCEPTABLE[grade].includes(requestedTerm);
  let verdict, tone;
  if (grade === 'F') { verdict = '거래 보류 권장 — 어떤 조건이든 서류 확인이 먼저입니다.'; tone = 'danger'; }
  else if (ok) { verdict = '요청 조건을 수락해도 되는 수준입니다.'; tone = 'ok'; }
  else { verdict = `이 등급에는 위험한 조건입니다. 권장 조건(${TERMS[rec].label})으로 조정을 제안하세요.`; tone = 'warn'; }
  return {
    amount: amt,
    requested: { id: requestedTerm, label: TERMS[requestedTerm]?.label, exposure: reqExposure },
    recommended: rec ? { id: rec, label: TERMS[rec].label, exposure: recExposure, prepay: Math.round(amt * TERMS[rec].advance) } : null,
    saved: rec ? Math.max(reqExposure - recExposure, 0) : reqExposure,
    acceptable: ok,
    verdict,
    tone,
  };
}

// ---------------- 품의서(결재) 문구 ----------------
export function approvalMemo(report, deal = null) {
  const c = report.company;
  const risky = report.signals.filter((s) => s.level === 'danger' || s.level === 'warn');
  const lines = [
    '[해외 바이어 신용 검증 결과 보고]',
    '',
    `1. 바이어: ${c.name} (${c.country}, ${c.industry || '-'}, 설립 ${c.founded || '-'}년)`,
    `2. 무역 안전 등급: ${report.grade}등급 (${report.gradeLabel}) · 위험 점수 ${report.riskPoints}`,
    `3. 판단 근거: ${risky.length ? risky.map((s) => `${s.label} ${s.value}`).join(', ') : '확인된 위험 신호 없음'}`,
    `4. 통관 실적: ${report.customs ? `최근 12개월 ${report.customs.total12m}건` : '정보 제한'}`,
    `5. 권장 결제 조건: ${report.guide.primary}`,
  ];
  if (deal && deal.amount) {
    const usd = (n) => 'USD ' + Number(n).toLocaleString('en-US');
    lines.push(`6. 거래 예정 금액: ${usd(deal.amount)} · 바이어 요청 ${deal.requested.label} 시 위험 노출 ${usd(deal.requested.exposure)}`);
    if (deal.recommended) lines.push(`   → 권장 조건 '${deal.recommended.label}' 적용 시 위험 노출 ${usd(deal.recommended.exposure)}`);
  }
  lines.push('', `조회 일시: ${new Date(report.createdAt).toLocaleString('ko-KR')} · Trade Checker 리포트 ${report.id || ''}`.trim());
  lines.push('※ 무역 안전 등급은 참고 지표이며 최종 조건은 당사 여신 정책에 따릅니다.');
  return lines.join('\n');
}

export function buildReport(profile, { now = new Date(), providerLabel = '샘플 데이터', id = null } = {}) {
  const { grade, points, signals, coverage, capped } = score(profile, now);
  const g = GUIDES[grade];
  const alternatives = [...g.alternatives];
  if (!coverage.items.find((i) => i.key === 'credit').ok && grade !== 'F') {
    alternatives.push('정식 신용등급이 필요하면 한국무역보험공사(K-SURE) 해외기업 신용조사를 신청하세요. 중소기업은 무료 이용 혜택이 있습니다(조건 확인).');
  }
  const sources = profile.sourcesUsed ? profile.sourcesUsed.map((s) => ({ name: s.name, status: s.status, state: s.state, detail: s.detail, cachedAt: s.cachedAt })) : [
    { name: '관세 통관 기록', status: profile.coverage?.customs === false ? '정보 제한' : '조회됨' },
    { name: '현지 법원 기록', status: profile.coverage?.courts === false ? '정보 제한' : '조회됨' },
    { name: '파산·회생 공고', status: profile.coverage?.insolvency === false ? '정보 제한' : '조회됨' },
    { name: '글로벌 신용평가', status: profile.credit?.score == null ? '정보 없음' : '조회됨' },
    { name: '무역 사기 신고 DB', status: '조회됨' },
  ];
  return {
    id,
    engineVersion: ENGINE_VERSION,
    createdAt: now.toISOString(),
    dataMode: providerLabel,
    company: profile.company,
    grade,
    gradeLabel: GRADES[grade].label,
    gradeColor: GRADES[grade].color,
    riskPoints: points,
    coverage,
    capped,
    thresholds: { ...RULES.thresholds },
    summary: summarize(grade, signals),
    signals,
    customs: profile.customs ? { ...profile.customs, months: monthLabels(now), total12m: profile.customs.monthly.reduce((a, b) => a + b, 0) } : null,
    courts: profile.courts || [],
    insolvency: profile.insolvency || [],
    credit: profile.credit || null,
    fraud: profile.fraud || [],
    guide: {
      primary: g.primary,
      terms: g.terms,
      alternatives,
      emailSubject: g.subject,
      emailBody: g.body.replace('{days}', '60'),
    },
    sources,
    disclaimer: '무역 안전 등급은 거래 판단을 돕는 참고 지표이며, 최종 거래 조건은 귀사의 여신 정책에 따라 결정하세요.',
  };
}
