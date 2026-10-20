-- DB 함수 시나리오 점검 (모든 변경은 마지막에 되돌림)
--   psql -h /tmp/pgt -p 54329 -U postgres -d tc -v ON_ERROR_STOP=1 -f tests/sql_scenarios.sql
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-00000000f001','own@t.co',now()),('00000000-0000-0000-0000-00000000f002','paid_member@t.co',now()),
 ('00000000-0000-0000-0000-00000000f003','trial@t.co',now()),('00000000-0000-0000-0000-00000000f004','noconf@t.co',null),
 ('00000000-0000-0000-0000-00000000f005','tr2@t.co',now());
do $$
declare r jsonb; d numeric;
begin
  r := start_team_trial('00000000-0000-0000-0000-00000000f004', 14);
  assert r->>'reason' = 'unconfirmed', '인증 안 된 계정 체험 차단';
  r := start_team_trial('00000000-0000-0000-0000-00000000f001', 14);
  update profiles set is_trial = false, paid_daily_value = 6633 where id = '00000000-0000-0000-0000-00000000f001';
  update profiles set plan = 'starter', plan_expires_at = now() + interval '300 days', paid_daily_value = 1282 where id = '00000000-0000-0000-0000-00000000f002';
  r := invite_team_member('00000000-0000-0000-0000-00000000f001', 'paid_member@t.co');
  assert pending_invite('00000000-0000-0000-0000-00000000f002') <> 'null'::jsonb, '밑줄 이메일 초대 조회';
  r := accept_team_invite('00000000-0000-0000-0000-00000000f002');
  assert r->>'reason' = 'own_plan', '본인 유료 요금제 사용 중이면 합류 거절';
  r := start_team_trial('00000000-0000-0000-0000-00000000f003', 14);
  r := invite_team_member('00000000-0000-0000-0000-00000000f001', 'trial@t.co');
  r := accept_team_invite('00000000-0000-0000-0000-00000000f003');
  assert (r->>'ok')::boolean, '체험 중 사용자는 합류 가능(체험 종료)';
  assert payer_of('00000000-0000-0000-0000-00000000f003') = '00000000-0000-0000-0000-00000000f001', '합류 후 소유자 한도 사용';
  r := consume_search('00000000-0000-0000-0000-00000000f003');
  assert r->>'payer' = '00000000-0000-0000-0000-00000000f001', '차감 대상 기록';
  -- 체험 → 유료 전환 시 체험 기간은 환산하지 않음
  r := start_team_trial('00000000-0000-0000-0000-00000000f005', 14);
  insert into orders(id,user_id,product_id,amount,status) values ('TC-s1','00000000-0000-0000-0000-00000000f005','starter_month',53900,'ready');
  r := apply_paid_order('TC-s1','pk','카드','{}','plan','starter',30,0);
  assert (r->>'bonusDays')::int = 0, '체험 기간 환산 없음';
  -- 연간 Starter → Team 월간: 실제 낸 하루 가치로 환산
  insert into orders(id,user_id,product_id,amount,status) values ('TC-s2','00000000-0000-0000-0000-00000000f005','starter_year',514800,'ready');
  r := apply_paid_order('TC-s2','pk','카드','{}','plan','starter',365,0);
  insert into orders(id,user_id,product_id,amount,status) values ('TC-s3','00000000-0000-0000-0000-00000000f005','team_month',218900,'ready');
  r := apply_paid_order('TC-s3','pk','카드','{}','plan','team',30,0);
  assert (r->>'bonusDays')::int between 70 and 80, '연간 요금 기준 환산: ' || r::text;
  r := revoke_paid_order('TC-s3', 'CANCELED');
  assert r->>'revoked' = 'plan', '환불 시 기간 회수';
  raise notice 'SQL 시나리오 모두 통과';
end $$;
rollback;
