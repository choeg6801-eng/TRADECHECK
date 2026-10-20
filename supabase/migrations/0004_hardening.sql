-- 2차 점검 반영: 요금제·팀·환불·알림 안전장치
-- 0001 → 0002 → 0003 다음에 실행하세요. 여러 번 실행해도 안전합니다.

-- 1. 프로필: 무료 체험 여부, 결제한 하루 가치(요금제 변경 시 환산용)
alter table public.profiles add column if not exists is_trial boolean not null default false;
alter table public.profiles add column if not exists paid_daily_value numeric;

-- 2. 관심 거래처: 알림 발송 대기 표시 (발송에 성공해야 지움)
alter table public.watchlist add column if not exists alert_pending boolean not null default false;
alter table public.watchlist add column if not exists alerted_at timestamptz;

-- 3. 조회 한도를 누구 것으로 쓸지: 본인 유효 요금제 → (없으면) 활성 Team 소유자 → 본인
create or replace function public.payer_of(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when me.plan <> 'free' and me.plan_expires_at > now() then me.id
    when me.team_owner is not null and o.plan = 'team' and o.plan_expires_at > now() then me.team_owner
    else me.id end
  from public.profiles me left join public.profiles o on o.id = me.team_owner
  where me.id = p_user;
$$;

-- team_root 도 같은 기준 (본인 요금제를 쓰는 동안은 팀 기록 공유에서 빠짐)
create or replace function public.team_root(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when me.plan <> 'free' and me.plan_expires_at > now() and me.team_owner is not null then me.id
    when me.team_owner is not null and o.plan = 'team' and o.plan_expires_at > now() then me.team_owner
    else me.id end
  from public.profiles me left join public.profiles o on o.id = me.team_owner
  where me.id = p_user;
$$;

-- 4. 조회 차감 결과에 실제 차감 대상(payer)을 담아, 환불도 같은 대상에게 돌려줌
create or replace function public.consume_search(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  p public.profiles;
  v_payer uuid;
  v_plan text;
  v_quota int;
begin
  select * into me from public.profiles where id = p_user for update;
  if not found then
    insert into public.profiles (id) values (p_user) returning * into me;
  end if;
  v_payer := coalesce(public.payer_of(p_user), p_user);
  if v_payer = p_user then p := me;
  else select * into p from public.profiles where id = v_payer for update;
  end if;

  v_plan := case when p.plan <> 'free' and p.plan_expires_at > now() then p.plan else 'free' end;
  v_quota := case v_plan when 'starter' then 20 when 'team' then 150 else 0 end;

  if v_quota > 0 and p.period_start <= current_date - 30 then
    update public.profiles set period_start = current_date, period_used = 0 where id = v_payer;
    p.period_used := 0;
  end if;

  if v_quota > 0 and p.period_used < v_quota then
    update public.profiles set period_used = period_used + 1 where id = v_payer;
    return jsonb_build_object('ok', true, 'source', 'plan', 'payer', v_payer, 'plan', v_plan, 'remaining', v_quota - p.period_used - 1, 'credits', me.credits);
  end if;
  if me.credits > 0 then
    update public.profiles set credits = credits - 1 where id = p_user;
    return jsonb_build_object('ok', true, 'source', 'credit', 'payer', p_user, 'plan', v_plan, 'remaining', greatest(v_quota - p.period_used, 0), 'credits', me.credits - 1);
  end if;
  if v_payer <> p_user and p.credits > 0 then
    update public.profiles set credits = credits - 1 where id = v_payer;
    return jsonb_build_object('ok', true, 'source', 'owner_credit', 'payer', v_payer, 'plan', v_plan, 'remaining', 0, 'credits', 0);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'quota', 'plan', v_plan);
end $$;

create or replace function public.refund_search(p_user uuid, p_source text, p_payer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_payer uuid := coalesce(p_payer, public.payer_of(p_user), p_user);
begin
  if p_source = 'plan' then
    update public.profiles set period_used = greatest(period_used - 1, 0) where id = v_payer;
  elsif p_source = 'credit' then
    update public.profiles set credits = credits + 1 where id = p_user;
  elsif p_source = 'owner_credit' then
    update public.profiles set credits = credits + 1 where id = v_payer;
  end if;
end $$;

-- 5. 무료 체험: 이메일 인증을 마친 계정만, 체험 표시
create or replace function public.start_team_trial(p_user uuid, p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  v_exp timestamptz;
begin
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'unconfirmed');
  end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then insert into public.profiles (id) values (p_user) returning * into p; end if;
  if p.trial_used then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if p.plan <> 'free' and p.plan_expires_at > now() then return jsonb_build_object('ok', false, 'reason', 'paid'); end if;
  if p.team_owner is not null and public.payer_of(p_user) <> p_user then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  v_exp := now() + make_interval(days => p_days);
  update public.profiles
     set plan = 'team', plan_expires_at = v_exp, period_start = current_date, period_used = 0,
         trial_used = true, is_trial = true, paid_daily_value = 0, team_owner = null
   where id = p_user;
  return jsonb_build_object('ok', true, 'expires_at', v_exp);
end $$;

-- 6. 결제 반영: 실제로 낸 하루 가치로 남은 기간 환산 (체험 기간은 환산하지 않음), 본인 요금제를 사면 팀에서 빠짐
create or replace function public.apply_paid_order(
  p_order_id text, p_payment_key text, p_method text, p_raw jsonb,
  p_kind text, p_plan text, p_days int, p_credits int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  p public.profiles;
  v_bonus int := 0;
  v_daily numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;

  update public.orders
     set status = 'paid', payment_key = p_payment_key, method = p_method, raw = p_raw, approved_at = now(), error = null
   where id = p_order_id;

  select * into p from public.profiles where id = o.user_id for update;

  if p_kind = 'credit' then
    update public.profiles set credits = credits + coalesce(p_credits, 1) where id = o.user_id;
  elsif p_kind = 'plan' then
    v_daily := (o.amount / 1.1) / greatest(p_days, 1); -- 부가세 뺀 하루 가치
    if p.plan = p_plan and p.plan_expires_at > now() and not p.is_trial then
      update public.profiles set plan_expires_at = p.plan_expires_at + make_interval(days => p_days), paid_daily_value = v_daily, team_owner = null
       where id = o.user_id;
    elsif p.plan = p_plan and p.plan_expires_at > now() and p.is_trial then
      -- 체험 중 같은 요금제 결제: 체험 남은 기간 뒤로 이어서
      update public.profiles set plan_expires_at = p.plan_expires_at + make_interval(days => p_days), is_trial = false, paid_daily_value = v_daily, team_owner = null
       where id = o.user_id;
    else
      if p.plan <> 'free' and p.plan_expires_at > now() and not p.is_trial and coalesce(p.paid_daily_value, 0) > 0 then
        v_bonus := floor(extract(epoch from (p.plan_expires_at - now())) / 86400 * p.paid_daily_value / v_daily);
      end if;
      update public.profiles
         set plan = p_plan, plan_expires_at = now() + make_interval(days => p_days + v_bonus), period_start = current_date, period_used = 0,
             is_trial = false, paid_daily_value = v_daily, team_owner = null
       where id = o.user_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'bonusDays', v_bonus);
end $$;

-- 7. 결제 취소(환불) 반영: 이미 반영한 이용권·크레딧을 회수
create or replace function public.revoke_paid_order(p_order_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  v_kind text;
  v_credits int;
  v_days int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;
  if o.status = 'canceled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status <> 'paid' then
    update public.orders set status = 'canceled', error = p_reason where id = p_order_id;
    return jsonb_build_object('ok', true);
  end if;
  v_kind := case when o.product_id like 'starter_%' or o.product_id like 'team_%' then 'plan' else 'credit' end;
  v_credits := case o.product_id when 'single' then 1 when 'addon10_starter' then 10 when 'addon10_team' then 10 else 0 end;
  v_days := case when o.product_id like '%_year' then 365 when o.product_id like '%_month' then 30 else 0 end;
  if v_kind = 'credit' then
    update public.profiles set credits = greatest(credits - v_credits, 0) where id = o.user_id;
  else
    update public.profiles set plan_expires_at = greatest(now(), plan_expires_at - make_interval(days => v_days)) where id = o.user_id;
  end if;
  update public.orders set status = 'canceled', error = p_reason where id = p_order_id;
  return jsonb_build_object('ok', true, 'revoked', v_kind);
end $$;

-- 8. 팀 초대: 소유자 기준 하루 20건 제한, 남아 있던 옛 팀 연결은 정리
create or replace function public.invite_team_member(p_owner uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.profiles;
  v_email text := lower(trim(p_email));
  v_used int;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'reason', 'email'); end if;
  select * into o from public.profiles where id = p_owner for update;
  if not found or o.plan <> 'team' or o.plan_expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'plan'); end if;
  if o.team_owner is not null then
    if public.payer_of(p_owner) <> p_owner then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
    update public.profiles set team_owner = null where id = p_owner; -- 본인 Team 을 쓰는 중이면 옛 팀 연결 해제
  end if;
  if lower(o.email) = v_email then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.team_invites where owner_id = p_owner and lower(email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end if;
  if (select count(*) from public.team_invites where owner_id = p_owner and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
  select count(*) into v_used from (
    select id from public.profiles where team_owner = p_owner
    union all
    select id from public.team_invites where owner_id = p_owner and accepted_at is null
  ) s;
  if v_used >= public.team_seat_limit() - 1 then return jsonb_build_object('ok', false, 'reason', 'seats'); end if;
  insert into public.team_invites (owner_id, email) values (p_owner, v_email);
  return jsonb_build_object('ok', true);
end $$;

-- 9. 초대 수락: 인증된 이메일 기준, 본인 유료 요금제 사용 중이면 거절, 끝난 옛 팀 연결은 대체
create or replace function public.accept_team_invite(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  v_email text;
  inv public.team_invites;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'unconfirmed'); end if;
  select * into me from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_profile'); end if;
  if me.plan <> 'free' and me.plan_expires_at > now() and not me.is_trial then return jsonb_build_object('ok', false, 'reason', 'own_plan'); end if;
  if me.team_owner is not null and public.payer_of(p_user) = me.team_owner then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if exists (select 1 from public.profiles where team_owner = p_user) then return jsonb_build_object('ok', false, 'reason', 'owner'); end if;
  select i.* into inv from public.team_invites i join public.profiles o on o.id = i.owner_id
   where lower(i.email) = v_email and i.accepted_at is null and i.owner_id <> p_user
     and o.plan = 'team' and o.plan_expires_at > now() and o.team_owner is null
   order by i.created_at desc limit 1 for update of i;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_invite'); end if;
  -- 체험 중이었다면 체험을 끝내고 팀 요금제를 씀
  update public.profiles
     set team_owner = inv.owner_id,
         plan = case when is_trial then 'free' else plan end,
         plan_expires_at = case when is_trial then null else plan_expires_at end,
         is_trial = false
   where id = p_user;
  update public.team_invites set accepted_at = now(), accepted_by = p_user where id = inv.id;
  return jsonb_build_object('ok', true, 'owner', inv.owner_id);
end $$;

-- 초대 거절 (배너 닫기)
create or replace function public.decline_team_invite(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'no_profile'); end if;
  delete from public.team_invites where lower(email) = v_email and accepted_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 받은 초대 (활성 Team 소유자에게서 온 것만)
create or replace function public.pending_invite(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('id', i.id, 'ownerEmail', o.email)
      from public.team_invites i
      join public.profiles o on o.id = i.owner_id
      join auth.users u on u.id = p_user
     where lower(i.email) = lower(u.email) and i.accepted_at is null
       and o.plan = 'team' and o.plan_expires_at > now() and o.team_owner is null and o.id <> p_user
     order by i.created_at desc limit 1), 'null'::jsonb);
$$;

-- 10. 알림 대상: Team(소유자·멤버) 관심 거래처 + 발송 대기 중인 알림
create or replace function public.watchlist_due(p_limit int default 200)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'alert_pending')::boolean desc, x->>'checked_at' nulls first), '[]'::jsonb) from (
    select to_jsonb(w) || jsonb_build_object('email', p.email) as x
      from public.watchlist w
      join public.profiles p on p.id = w.user_id
      left join public.profiles o on o.id = p.team_owner
     where w.alert_pending
        or (p.plan = 'team' and p.plan_expires_at > now())
        or (public.payer_of(p.id) = p.team_owner and o.plan = 'team' and o.plan_expires_at > now())
     order by w.alert_pending desc, w.checked_at nulls first
     limit p_limit
  ) s;
$$;

-- 권한: 서버(service_role)만
do $$
declare f text;
begin
  foreach f in array array[
    'public.payer_of(uuid)', 'public.team_root(uuid)', 'public.consume_search(uuid)', 'public.refund_search(uuid, text, uuid)',
    'public.start_team_trial(uuid, int)', 'public.apply_paid_order(text, text, text, jsonb, text, text, int, int)',
    'public.revoke_paid_order(text, text)', 'public.invite_team_member(uuid, text)', 'public.accept_team_invite(uuid)',
    'public.decline_team_invite(uuid)', 'public.pending_invite(uuid)', 'public.watchlist_due(int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
