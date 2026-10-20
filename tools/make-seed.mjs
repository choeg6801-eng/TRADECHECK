// 실서비스 테스트용 시드 SQL 만들기 — 지금의 등급 엔진으로 리포트를 계산해 넣습니다.
// 사용: node tools/make-seed.mjs  →  supabase/seed_test_data.sql
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sample from '../lib/providers/sample.js';
import { buildReport } from '../lib/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
const now = Date.now();

async function rep(id, daysAgo) {
  const p = await sample.getProfile(id);
  const r = buildReport(p, { now: new Date(now - daysAgo * DAY), providerLabel: sample.PROVIDER_LABEL });
  delete r.id;
  return { id, daysAgo, r };
}
const sqlJson = (o) => '$json$' + JSON.stringify(o) + '$json$::jsonb';
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const OWNER = [['sakura-jp', 1], ['kestrel-nl', 2], ['nw-global-ae', 3], ['riyadh-sa', 4], ['warsaw-pl', 5], ['lagos-ng', 6], ['apex-ae', 7], ['sinoglobal-hk', 8]];
const MEMBER = [['helvetia-ch', 1], ['orion-in', 2], ['sahara-eg', 3]];
const ownerReps = await Promise.all(OWNER.map(([id, d]) => rep(id, d)));
const memberReps = await Promise.all(MEMBER.map(([id, d]) => rep(id, d)));
const ALL_IDS = [...OWNER, ...MEMBER].map(([id]) => lit(id)).join(',');

const insertRep = (who, x) => `  insert into public.reports (user_id, query, company_id, company_name, country, grade, risk_points, result, created_at)
  values (${who}, ${lit('[테스트] ' + x.r.company.name)}, ${lit(x.id)}, ${lit(x.r.company.name)}, ${lit(x.r.company.country)}, ${lit(x.r.grade)}, ${x.r.riskPoints}, ${sqlJson(x.r)}, now() - interval '${x.daysAgo} days')
  returning id into v_rep;
  v_ids := v_ids || jsonb_build_object(${lit(x.id)}, v_rep);
`;

const sql = `-- Trade Checker 테스트 데이터 (실서비스 모드용) — tools/make-seed.mjs 로 만든 파일입니다.
-- 모든 회사는 가상 데이터입니다. (DATA_PROVIDER=sample 상태에서 '다시 확인'까지 동작)
--
-- 사용법
--   1) 사이트에서 테스트 계정으로 회원가입하고 인증 메일 링크를 누릅니다.
--      팀 기능까지 보려면 두 번째 계정(팀원용)도 가입합니다. (없으면 비워 두세요)
--   2) 아래 v_email, v_member_email 을 바꿉니다.
--   3) Supabase → SQL Editor 에 붙여 넣고 Run. (migrations 0001~0004 를 먼저 실행해 두어야 합니다)
-- 다시 실행하면 이 스크립트가 넣은 데이터만 지우고 새로 넣습니다.
--
-- 넣는 내용
--   계정 1 (소유자): Team 유료 요금제 25일 남음 · 이번 주기 12/150건 사용 · 크레딧 12건
--                    조회 기록 8건 (A·B·C·C·D·D·F·F) · 관심 거래처 3곳 (1곳 등급 변동 B→C)
--                    공유 링크 1개 (Warsaw 리포트, 10일 남음) · 결제 내역 5건 (완료 3 · 입금 대기 1 · 환불 1)
--                    보낸 팀 초대 1건 (invitee.test@example.com, 대기 중)
--   계정 2 (팀원):   계정 1의 팀에 합류된 상태 · 조회 기록 3건 · 관심 거래처 1곳

do $$
declare
  v_email text := 'test1@example.com';          -- ← 계정 1 (소유자)
  v_member_email text := '';                     -- ← 계정 2 (팀원). 팀 기능을 안 볼 거면 비워 두세요
  v_uid uuid;
  v_mid uuid;
  v_rep uuid;
  v_ids jsonb := '{}'::jsonb;
  v_token text;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception '% 로 가입된 계정이 없습니다. 사이트에서 먼저 회원가입해 주세요.', v_email;
  end if;
  if coalesce(v_member_email, '') <> '' then
    select id into v_mid from auth.users where lower(email) = lower(v_member_email);
    if v_mid is null then raise exception '% 로 가입된 계정이 없습니다 (팀원용). 비워 두거나 먼저 가입해 주세요.', v_member_email; end if;
    if v_mid = v_uid then raise exception '두 계정은 서로 달라야 합니다.'; end if;
  end if;

  -- 이전 테스트 데이터 정리
  delete from public.watchlist where user_id in (v_uid, v_mid) and company_id in (${ALL_IDS});
  delete from public.orders where user_id = v_uid and id like 'TC-TEST-%';
  delete from public.reports where user_id in (v_uid, v_mid) and query like '[테스트]%';
  delete from public.team_invites where owner_id = v_uid and lower(email) in ('invitee.test@example.com', lower(coalesce(v_member_email, '')));

  -- 1. 계정 1: Team 유료 요금제
  insert into public.profiles (id, email) values (v_uid, v_email) on conflict (id) do nothing;
  update public.profiles
     set plan = 'team', plan_expires_at = now() + interval '25 days', is_trial = false, paid_daily_value = 6633.33,
         period_start = current_date - 5, period_used = 12, credits = 12, team_owner = null
   where id = v_uid;

  -- 2. 계정 1 조회 기록 8건
${ownerReps.map((x) => insertRep('v_uid', x)).join('\n')}
  -- 3. 관심 거래처 3곳 — Riyadh 는 B → C 로 바뀐 상태
  insert into public.watchlist (user_id, company_id, company_name, country, last_grade, prev_grade, last_report_id, checked_at, changed_at) values
    (v_uid, 'kestrel-nl', 'Kestrel Imports BV', '네덜란드', 'B', null, (v_ids->>'kestrel-nl')::uuid, now() - interval '2 hours', null),
    (v_uid, 'riyadh-sa', 'Riyadh Gulf Supplies Est.', '사우디아라비아', 'C', 'B', (v_ids->>'riyadh-sa')::uuid, now() - interval '1 day', now() - interval '1 day'),
    (v_uid, 'warsaw-pl', 'Warsaw Tech Components Sp. z o.o.', '폴란드', 'D', null, (v_ids->>'warsaw-pl')::uuid, now() - interval '2 days', null);

  -- 4. 공유 링크 (Warsaw 리포트, 10일 뒤 만료)
  v_token := substr(translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_'), 1, 32);
  update public.reports set share_token = v_token, share_expires_at = now() + interval '10 days' where id = (v_ids->>'warsaw-pl')::uuid;

  -- 5. 결제 내역 (테스트 기록일 뿐 실제 결제는 아닙니다)
  insert into public.orders (id, user_id, product_id, amount, status, payment_key, method, approved_at, created_at, raw, error) values
    ('TC-TEST-' || substr(md5(v_uid::text || 'a'), 1, 10), v_uid, 'team_month', 218900, 'paid', 'test_payment_key_1', '카드', now() - interval '5 days', now() - interval '5 days', null, null),
    ('TC-TEST-' || substr(md5(v_uid::text || 'b'), 1, 10), v_uid, 'addon10_team', 22000, 'paid', 'test_payment_key_2', '카드', now() - interval '3 days', now() - interval '3 days', null, null),
    ('TC-TEST-' || substr(md5(v_uid::text || 'c'), 1, 10), v_uid, 'single', 10890, 'paid', 'test_payment_key_3', '간편결제', now() - interval '2 days', now() - interval '2 days', null, null),
    ('TC-TEST-' || substr(md5(v_uid::text || 'd'), 1, 10), v_uid, 'single', 10890, 'waiting', 'test_payment_key_4', '가상계좌', null, now() - interval '1 day', jsonb_build_object('virtualAccount', jsonb_build_object('bankCode', '88', 'accountNumber', '56211012345678', 'dueDate', now() + interval '2 days')), null),
    ('TC-TEST-' || substr(md5(v_uid::text || 'e'), 1, 10), v_uid, 'single', 10890, 'canceled', 'test_payment_key_5', '카드', now() - interval '6 days', now() - interval '6 days', null, 'CANCELED');

  -- 6. 보낸 팀 초대 (대기 중)
  insert into public.team_invites (owner_id, email, created_at) values (v_uid, 'invitee.test@example.com', now() - interval '1 day');

  -- 7. 계정 2: 계정 1의 팀원
  if v_mid is not null then
    insert into public.profiles (id, email) values (v_mid, v_member_email) on conflict (id) do nothing;
    update public.profiles
       set team_owner = v_uid, plan = 'free', plan_expires_at = null, is_trial = false, credits = 3
     where id = v_mid;
    insert into public.team_invites (owner_id, email, created_at, accepted_at, accepted_by)
    values (v_uid, lower(v_member_email), now() - interval '4 days', now() - interval '4 days', v_mid);
${memberReps.map((x) => insertRep('v_mid', x)).join('\n')}
    insert into public.watchlist (user_id, company_id, company_name, country, last_grade, prev_grade, last_report_id, checked_at, changed_at) values
      (v_mid, 'sahara-eg', 'Sahara Polymer Trading Co.', '이집트', 'D', null, (v_ids->>'sahara-eg')::uuid, now() - interval '3 hours', null);
  end if;

  raise notice '테스트 데이터를 넣었습니다: % %', v_email, coalesce(nullif(v_member_email, ''), '(팀원 없음)');
  raise notice '공유 링크: https://내도메인/share.html?t=%', v_token;
end $$;
`;
writeFileSync(path.join(root, 'supabase', 'seed_test_data.sql'), sql);
console.log('saved supabase/seed_test_data.sql', (sql.length / 1024).toFixed(0) + 'KB');
