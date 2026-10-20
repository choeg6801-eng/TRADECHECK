// 실서비스 모드 API 통합 테스트 (가짜 Supabase·토스 + 실제 Postgres 함수)
// 실행: tests/run-live-tests.sh
import assert from 'node:assert/strict';

const APP = 'http://127.0.0.1:3100';
const SB = 'http://127.0.0.1:54400';
let pass = 0;
const ok = (name) => { pass++; console.log('  ✓ ' + name); };

async function signup(email) {
  const r = await fetch(`${SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'test-anon-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'secret123' }) });
  return (await r.json()).access_token;
}
async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${APP}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const cfg = await call('config');
assert.equal(cfg.data.mode, 'live');
assert.ok(!JSON.stringify(cfg.data).includes('test-service-key') && !JSON.stringify(cfg.data).includes('test_gsk'), 'secrets must not leak');
ok('config: live 모드, 비밀키 노출 없음');

assert.equal((await call('me')).status, 401);
assert.equal((await call('search', { method: 'POST', body: { query: 'acme' } })).status, 401);
ok('로그인 없이 API 접근 차단 (401)');

const t1 = await signup('buyer1@test.com');
let me = (await call('me', { token: t1 })).data.profile;
assert.equal(me.plan, 'free'); assert.equal(me.credits, 3);
ok('가입 → 무료 3건');

let r = await call('search', { token: t1, method: 'POST', body: { query: 'Northwind' } });
assert.equal(r.data.candidates.length, 2);
assert.equal((await call('me', { token: t1 })).data.profile.credits, 3);
ok('동명 법인 후보 2곳 반환, 후보 단계에서는 차감 없음');

r = await call('search', { token: t1, method: 'POST', body: { query: 'Northwind', companyId: 'nw-global-ae' } });
assert.equal(r.status, 200); assert.equal(r.data.report.grade, 'C');
const reportId = r.data.report.id;
assert.match(reportId, /^[0-9a-f-]{36}$/);
assert.equal(r.data.usage.source, 'credit');
ok('조회 → C등급 리포트 저장, 크레딧 1건 차감');

assert.equal((await call('search', { token: t1, method: 'POST', body: { query: 'x' } })).status, 400);
r = await call('search', { token: t1, method: 'POST', body: { query: 'Sakura Precision' } });
assert.equal(r.data.candidates.length, 1, '링크로 열린 검색은 후보 1곳이어도 차감하지 않음');
assert.equal((await call('search', { token: t1, method: 'POST', body: { companyId: { x: 1 } } })).status, 400);
assert.equal((await call('me', { token: t1 })).data.profile.credits, 2);
ok('잘못된 입력은 400, 차감 없음');

r = await call('reports', { token: t1 });
assert.equal(r.data.reports.length, 1);
r = await call('reports?id=' + reportId, { token: t1 });
assert.equal(r.data.report.company.name, 'Northwind Global Trading LLC');
ok('조회 기록 목록·리포트 상세');

const t2 = await signup('other@test.com');
assert.equal((await call('reports?id=' + reportId, { token: t2 })).status, 404);
assert.equal((await call('reports?id=1;drop', { token: t2 })).status, 400);
ok('다른 회원의 리포트 접근 불가, 잘못된 ID 거부');

r = await call('watchlist', { token: t1, method: 'POST', body: { reportId } });
assert.ok(r.data.item.id);
const wid = r.data.item.id;
assert.equal((await call('watchlist', { token: t1, method: 'POST', body: { reportId } })).data.already, true);
r = await call('watchlist', { token: t1, method: 'POST', body: { action: 'recheck', id: wid } });
assert.equal(r.data.item.last_grade, 'C'); assert.equal(r.data.item.changed, false);
assert.equal((await call('me', { token: t1 })).data.profile.credits, 2);
r = await call('watchlist', { token: t1 });
assert.equal(r.data.items.length, 1); assert.equal(r.data.limit, 3);
ok('관심 거래처 추가·중복 방지·다시 확인(차감 없음)');

await call('search', { token: t1, method: 'POST', body: { query: 'Helvetia', autoPick: true } });
await call('search', { token: t1, method: 'POST', body: { query: 'Kestrel', autoPick: true } });
r = await call('search', { token: t1, method: 'POST', body: { query: 'Sahara', autoPick: true } });
assert.equal(r.status, 402); assert.equal(r.data.code, 'quota');
ok('무료 3건 소진 후 402 (한도 초과)');

// ---- 결제 ----
let o = (await call('payments/prepare', { token: t1, method: 'POST', body: { productId: 'single' } })).data;
assert.equal(o.amount, 10890); assert.match(o.orderId, /^[A-Za-z0-9_=-]{6,64}$/);
assert.equal((await call('payments/prepare', { token: t1, method: 'POST', body: { productId: 'free_stuff' } })).status, 400);
r = await call('payments/confirm', { token: t1, method: 'POST', body: { paymentKey: 'pk_test_1', orderId: o.orderId, amount: 100 } });
assert.equal(r.status, 400);
assert.equal((await call('me', { token: t1 })).data.profile.credits, 0);
ok('결제 준비(부가세 포함 10,890원), 금액 위조 시 승인 거부');

o = (await call('payments/prepare', { token: t1, method: 'POST', body: { productId: 'single' } })).data;
assert.equal((await call('payments/confirm', { token: t2, method: 'POST', body: { paymentKey: 'pk_x', orderId: o.orderId, amount: o.amount } })).status, 404);
r = await call('payments/confirm', { token: t1, method: 'POST', body: { paymentKey: 'pk_test_2', orderId: o.orderId, amount: o.amount } });
assert.equal(r.status, 200); assert.equal(r.data.productId, 'single');
assert.equal((await call('me', { token: t1 })).data.profile.credits, 1);
r = await call('payments/confirm', { token: t1, method: 'POST', body: { paymentKey: 'pk_test_2', orderId: o.orderId, amount: o.amount } });
assert.equal(r.data.already, true);
assert.equal((await call('me', { token: t1 })).data.profile.credits, 1);
ok('단건 결제 승인 → 크레딧 +1, 다른 회원 주문 승인 불가, 중복 승인 무시');

o = (await call('payments/prepare', { token: t1, method: 'POST', body: { productId: 'starter_month' } })).data;
r = await call('payments/confirm', { token: t1, method: 'POST', body: { paymentKey: 'reject_me', orderId: o.orderId, amount: o.amount } });
assert.equal(r.status, 400); assert.match(r.data.error, /거절/);
ok('카드사 거절 시 오류 메시지 전달, 요금제 미적용');

assert.equal((await call('trial', { token: t1, method: 'POST' })).status, 200);
me = (await call('me', { token: t1 })).data.profile;
assert.equal(me.plan, 'team'); assert.equal(me.monthlyQuota, 150); assert.equal(me.watchLimit, 50);
assert.equal((await call('trial', { token: t1, method: 'POST' })).status, 409);
r = await call('search', { token: t1, method: 'POST', body: { query: 'Sahara', autoPick: true } });
assert.equal(r.data.report.grade, 'D'); assert.equal(r.data.usage.source, 'plan');
ok('Team 14일 체험 시작(1회 한정) → 구독 한도로 조회');

o = (await call('payments/prepare', { token: t1, method: 'POST', body: { productId: 'team_month' } })).data;
assert.equal(o.amount, 218900);
r = await call('payments/confirm', { token: t1, method: 'POST', body: { paymentKey: 'pk_test_3', orderId: o.orderId, amount: o.amount } });
assert.equal(r.status, 200);
const days = (new Date((await call('me', { token: t1 })).data.profile.planExpiresAt) - Date.now()) / 86400000;
assert.ok(days > 42 && days < 45, 'team extended ~44 days, got ' + days);
ok('Team 결제 218,900원 → 체험 기간 뒤로 30일 연장');

// ---- 예약 작업 ----
assert.equal((await call('cron/recheck')).status, 401);
r = await fetch(`${APP}/api/cron/recheck`, { headers: { Authorization: 'Bearer test-cron' } }).then((x) => x.json());
assert.ok(r.checked >= 1, 'checked ' + r.checked); // 이전 실행에서 남은 Team 계정이 있으면 더 많을 수 있음
ok('관심 거래처 자동 재평가 (CRON_SECRET 필요)');

// ---- 팀 좌석 ----
const RUN = Date.now().toString(36);
const memEmail = `mem_${RUN}@test.com`; // 밑줄 포함 이메일도 초대가 보여야 함
assert.equal((await call('team', { token: t1, method: 'POST', body: { action: 'invite', email: memEmail } })).status, 200);
assert.equal((await call('team', { token: t1, method: 'POST', body: { action: 'invite', email: memEmail } })).status, 409);
const tm = await signup(memEmail);
assert.equal((await call('me', { token: tm })).data.profile.role, 'solo'); // 동의 없이 자동 합류하지 않음
assert.equal((await call('me', { token: tm })).data.invite.ownerEmail, 'buyer1@test.com');
assert.equal((await call('team', { token: tm, method: 'POST', body: { action: 'accept' } })).status, 200);
me = (await call('me', { token: tm })).data.profile;
assert.equal(me.role, 'member'); assert.equal(me.plan, 'team'); assert.equal(me.watchLimit, 50);
r = await call('search', { token: tm, method: 'POST', body: { query: 'Sakura Precision', autoPick: true } });
assert.equal(r.data.usage.source, 'plan');
const memReport = r.data.report.id;
ok('Team 초대 → 본인이 수락해야 합류(자동 합류 없음), 소유자 한도로 조회');

r = await call('reports?scope=team', { token: t1 });
assert.ok(r.data.reports.some((x) => x.id === memReport && x.author === memEmail));
assert.equal(r.data.scope, 'team');
r = await call('reports?id=' + memReport, { token: t1 });
assert.equal(r.status, 200); assert.equal(r.data.owner.mine, false);
assert.equal((await call('reports?id=' + memReport, { token: t2 })).status, 404);
assert.equal((await call('reports?scope=team', { token: t2 })).data.reports.length, 0);
ok('팀원 리포트는 팀 안에서만 열람 (외부인 404)');

assert.equal((await call('payments/prepare', { token: tm, method: 'POST', body: { productId: 'team_month' } })).status, 409);
assert.equal((await call('payments/prepare', { token: t2, method: 'POST', body: { productId: 'addon10_team' } })).status, 409);
assert.equal((await call('payments/prepare', { token: t2, method: 'POST', body: { productId: 'constructor' } })).status, 400);
const before = (await call('me', { token: t1 })).data.profile.credits;
o = (await call('payments/prepare', { token: t1, method: 'POST', body: { productId: 'addon10_team' } })).data;
assert.equal(o.amount, 22000);
assert.equal((await call('payments/confirm', { token: t1, method: 'POST', body: { paymentKey: 'pk_addon', orderId: o.orderId, amount: o.amount } })).status, 200);
assert.equal((await call('me', { token: t1 })).data.profile.credits, before + 10);
ok('멤버는 요금제 결제 불가, 무료 회원은 추가 묶음 불가, Team 추가 10건 22,000원 반영');

for (const n of [1, 2, 3]) assert.equal((await call('team', { token: t1, method: 'POST', body: { action: 'invite', email: `x${n}-${RUN}@test.com` } })).status, 200);
r = await call('team', { token: t1, method: 'POST', body: { action: 'invite', email: `x4-${RUN}@test.com` } });
assert.equal(r.status, 409); assert.equal(r.data.code, 'seats');
r = await call('team', { token: t1 });
assert.equal(r.data.members.length, 1); assert.equal(r.data.invites.length, 3);
assert.equal((await call('team?invite=' + r.data.invites[0].id, { token: t1, method: 'DELETE' })).status, 200);
assert.equal((await call('team?member=' + r.data.members[0].id, { token: t2, method: 'DELETE' })).status, 403);
assert.equal((await call('team', { token: tm, method: 'POST', body: { action: 'leave' } })).status, 200);
assert.equal((await call('me', { token: tm })).data.profile.role, 'solo');
ok('좌석 5명 제한, 초대 취소, 남의 팀원 삭제 불가, 멤버 나가기');

// ---- 가상계좌: 입금 전에는 반영하지 않고, 웹훅으로 입금 확인 후 반영 ----
const c2 = (await call('me', { token: t2 })).data.profile.credits;
o = (await call('payments/prepare', { token: t2, method: 'POST', body: { productId: 'single' } })).data;
r = await call('payments/confirm', { token: t2, method: 'POST', body: { paymentKey: 'vbank_1', orderId: o.orderId, amount: o.amount } });
assert.equal(r.status, 200); assert.equal(r.data.waiting, true);
assert.equal((await call('me', { token: t2 })).data.profile.credits, c2);
assert.equal((await call('payments/webhook', { method: 'POST', body: { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: o.orderId, status: 'DONE' } } })).data.state, 'waiting');
assert.equal((await call('me', { token: t2 })).data.profile.credits, c2, '웹훅 본문만으로는 반영되지 않음');
await fetch('http://127.0.0.1:54401/__deposit/' + o.orderId);
assert.equal((await call('payments/webhook', { method: 'POST', body: { data: { orderId: o.orderId } } })).data.state, 'paid');
assert.equal((await call('me', { token: t2 })).data.profile.credits, c2 + 1);
assert.equal((await call('payments/webhook', { method: 'POST', body: { data: { orderId: o.orderId } } })).status, 200);
assert.equal((await call('me', { token: t2 })).data.profile.credits, c2 + 1, '중복 웹훅 무시');
ok('가상계좌: 입금 전 미반영, 웹훅은 토스에 재확인 후 반영, 중복 무시');

// ---- 승인 재시도: 이미 승인된 결제면 상태 조회로 반영 ----
o = (await call('payments/prepare', { token: t2, method: 'POST', body: { productId: 'single' } })).data;
await fetch('http://127.0.0.1:54401/v1/payments/confirm', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from('test_gsk_mock:').toString('base64'), 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentKey: 'pk_pre', orderId: o.orderId, amount: o.amount }) });
r = await call('payments/confirm', { token: t2, method: 'POST', body: { paymentKey: 'pk_pre', orderId: o.orderId, amount: o.amount } });
assert.equal(r.status, 200); assert.equal((await call('me', { token: t2 })).data.profile.credits, c2 + 2);
ok('승인 응답을 놓친 뒤 재시도해도 이중 반영 없이 정상 처리');

// ---- 리포트 공유 링크 ----
assert.equal((await call('share', { token: t2, method: 'POST', body: { reportId } })).status, 404);
r = await call('share', { token: t1, method: 'POST', body: { reportId } });
assert.equal(r.status, 200); assert.match(r.data.token, /^[A-Za-z0-9_-]{32}$/);
const shareTok = r.data.token;
r = await call('share?t=' + shareTok);
assert.equal(r.status, 200); assert.equal(r.data.report.grade, 'C'); assert.equal(r.data.report.query, undefined);
assert.equal((await call('reports?id=' + reportId, { token: t1 })).data.share.token, shareTok);
assert.equal((await call('share?t=' + 'a'.repeat(32))).status, 404);
assert.equal((await call('share?id=' + reportId, { token: t1, method: 'DELETE' })).status, 200);
assert.equal((await call('share?t=' + shareTok)).status, 404);
ok('공유 링크: 로그인 없이 열람, 검색어 숨김, 타인 생성 불가, 끄면 즉시 차단');

// ---- 2차 점검 반영 ----
// 초대 거절
const tz = await signup(`zed_${RUN}@test.com`);
assert.equal((await call('team', { token: t1, method: 'POST', body: { action: 'invite', email: `zed_${RUN}@test.com` } })).status, 200);
assert.ok((await call('me', { token: tz })).data.invite);
assert.equal((await call('team', { token: tz, method: 'POST', body: { action: 'decline' } })).status, 200);
assert.equal((await call('me', { token: tz })).data.invite, null);
ok('밑줄 이메일 초대 표시, 초대 거절');

// 체험 중에는 추가 묶음 구매 불가
const tt = await signup(`trial_${RUN}@test.com`);
assert.equal((await call('trial', { token: tt, method: 'POST' })).status, 200);
assert.equal((await call('me', { token: tt })).data.profile.isTrial, true);
r = await call('payments/prepare', { token: tt, method: 'POST', body: { productId: 'addon10_team' } });
assert.equal(r.status, 409);
ok('무료 체험 중에는 저가 추가 조회 묶음 구매 불가');

// 공유 링크: 유효한 동안은 같은 링크(기한 연장 없음), 신용평가 원자료 가림 함수
r = await call('share', { token: t1, method: 'POST', body: { reportId } });
const s1 = r.data;
r = await call('share', { token: t1, method: 'POST', body: { reportId } });
assert.equal(r.data.token, s1.token); assert.equal(new Date(r.data.expiresAt).getTime(), new Date(s1.expiresAt).getTime());
const { maskLicensed } = await import('../api/share.js');
const masked = maskLicensed({ query: 'x', credit: { score: 82, provider: 'Creditsafe' }, signals: [{ key: 'credit', level: 'warn', value: '45 / 100' }] });
assert.equal(masked.query, undefined); assert.equal(masked.credit.score, null); assert.match(masked.signals[0].value, /비공개/);
ok('공유 링크 재사용 시 기한 연장 없음, 유료 신용평가 원자료는 공유 화면에서 가림');

// 환불(취소) 웹훅 → 이용권 회수
const c3 = (await call('me', { token: t2 })).data.profile.credits;
o = (await call('payments/prepare', { token: t2, method: 'POST', body: { productId: 'single' } })).data;
await call('payments/confirm', { token: t2, method: 'POST', body: { paymentKey: 'pk_ref', orderId: o.orderId, amount: o.amount } });
assert.equal((await call('me', { token: t2 })).data.profile.credits, c3 + 1);
await fetch('http://127.0.0.1:54401/__cancel/' + o.orderId);
r = await call('payments/webhook', { method: 'POST', body: { eventType: 'PAYMENT_STATUS_CHANGED', data: { orderId: o.orderId } } });
assert.equal(r.data.state, 'revoked');
assert.equal((await call('me', { token: t2 })).data.profile.credits, c3);
ok('토스에서 환불하면 웹훅으로 크레딧 회수');
o = (await call('payments/prepare', { token: t2, method: 'POST', body: { productId: 'single' } })).data;
assert.equal((await call('payments/webhook', { method: 'POST', body: { data: { orderId: o.orderId } } })).status, 503);
ok('결제 조회 실패 시 웹훅이 오류를 돌려 토스가 다시 보내게 함');

// ---- 예약 작업 (팀 기준) ----
r = await fetch(`${APP}/api/cron/recheck`, { headers: { Authorization: 'Bearer test-cron' } }).then((x) => x.json());
assert.ok(r.checked >= 1 && r.failed === 0, JSON.stringify(r));
ok('예약 재평가: 시간 제한 안에서 처리, 실패 없음');

console.log(`\n${pass}개 시나리오 통과`);
